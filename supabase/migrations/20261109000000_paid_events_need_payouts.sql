-- Paid events need payouts (owner request, 26 Oct 2026: "organisers have to
-- set up payments before listing paid events"; docs/architecture.md,
-- "Payouts before paid events"). Checkout already refuses an organiser
-- without a ready Stripe Connect account (lib/server/handlers/orders.ts), but
-- nothing stopped a paid event being submitted and published first, leaving
-- buyers at a dead end. Now, whatever the code does:
--
--   * events_paid_tickets_need_payouts (trigger on public.events): an event
--     with a paid Sheltüh ticket type (price_cents > 0) can't move to
--     pending_review or published while its organiser's payouts_enabled is
--     false. That covers the organiser's submit and resubmit, an admin's
--     approval, and an admin's publish (private.admin_create_event /
--     admin_edit_event). Moving to draft or rejected (unpublish, reject,
--     takedown) is never refused.
--   * ticket_types_paid_need_payouts (trigger on public.ticket_types): while
--     the event is pending_review or published, a new paid ticket type, or a
--     free one made paid, is refused the same way. An existing paid type
--     keeps its price (or changes it) whatever payouts says: payouts going
--     off later is checkout's guard, not this one.
--   * private.submit_event: the organiser's submit (draft or rejected →
--     pending_review) in one step, returning 'payouts_required' instead of
--     raising, so the API answers 409 without relying on the error text.
--
-- Not refused: drafts (create and edit freely); free events; external
-- ticketing (no ticket types at all: ticket_types_sheltuh_only).
-- Platform-managed organisers (no owner) can't onboard to Stripe, so their
-- payouts are always off (organisers_platform_no_payouts) and they already
-- can't have a paid ticket type (ticket_types_platform_free_only), so the
-- rule changes nothing for them; a legacy paid type from before that rule
-- can't be submitted or published either, which is right, since nobody can
-- be paid for it. The ticket-type trigger leaves them to
-- ticket_types_platform_free_only, so its message is the one they see.
--
-- Locks: every caller that moves an event to pending_review or published
-- share-locks the organiser row first, then the event (private.submit_event
-- here; the admin approval's guard in lib/server/handlers/admin.ts;
-- admin_create_event; admin_edit_event), so a concurrent Stripe re-sync of
-- payouts_enabled (an update of the organiser row) waits for, or is seen by,
-- the check. The triggers read the organiser without locking it, so they
-- never take the organiser after the event (private.suspend_organiser locks
-- the organiser, then events). An edit of a draft's ticket types locks the
-- event row (edit_event_draft), as submit_event does before checking them.
--
-- No new index: the checks are by primary key (organisers, events) and the
-- ticket_types (event_id, id) key.
--
-- Access model as everywhere else: no new table; every new function pins its
-- search_path, has execute revoked from PUBLIC, anon and authenticated, and
-- is not security definer.
--
-- Additive, no data change: existing pending or published paid events of an
-- organiser without payouts are left as they are (checkout still refuses
-- them). Reversible: drop the two triggers, then the functions
-- private.events_paid_tickets_need_payouts,
-- private.ticket_types_paid_need_payouts and private.submit_event (the API's
-- submit then needs its previous version, which called
-- private.transition_event directly).

-- ---------------------------------------------------------------------------
-- The rule, as triggers
-- ---------------------------------------------------------------------------

create function private.events_paid_tickets_need_payouts() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ticketing_mode = 'sheltuh'
     and exists (select 1 from public.ticket_types t where t.event_id = new.id and t.price_cents > 0)
     and not exists (select 1 from public.organisers o where o.id = new.organiser_id and o.payouts_enabled) then
    raise exception 'An event with paid tickets can''t be submitted or published until its organiser has set up payouts.'
      using errcode = 'check_violation', constraint = 'events_paid_tickets_need_payouts';
  end if;
  return new;
end;
$$;

create trigger events_paid_tickets_need_payouts before update of status on public.events
  for each row
  when (new.status in ('pending_review', 'published') and new.status is distinct from old.status)
  execute function private.events_paid_tickets_need_payouts();

-- Every ticket type write comes through private.replace_ticket_types, an
-- upsert: this BEFORE INSERT trigger sees the new price even when the row
-- then updates an existing one, so "newly paid" is judged against the stored
-- row; the BEFORE UPDATE it then fires compares with old.price_cents.
create function private.ticket_types_paid_need_payouts() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_newly_paid boolean;
begin
  if new.price_cents = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_newly_paid := old.price_cents = 0;
  else
    v_newly_paid := not exists (select 1 from public.ticket_types t
                                 where t.event_id = new.event_id and t.id = new.id and t.price_cents > 0);
  end if;
  if v_newly_paid
     and exists (
       select 1 from public.events e join public.organisers o on o.id = e.organiser_id
        where e.id = new.event_id
          and e.status in ('pending_review', 'published')
          and o.owner_user_id is not null
          and not o.payouts_enabled
     ) then
    raise exception 'A submitted or published event can''t get a paid ticket type until its organiser has set up payouts.'
      using errcode = 'check_violation', constraint = 'ticket_types_paid_need_payouts';
  end if;
  return new;
end;
$$;

create trigger ticket_types_paid_need_payouts before insert or update of price_cents on public.ticket_types
  for each row execute function private.ticket_types_paid_need_payouts();

-- ---------------------------------------------------------------------------
-- The organiser's submit
-- ---------------------------------------------------------------------------

-- Moves p_organiser_id's event p_event_id from draft or rejected to
-- pending_review, logged 'submitted' by p_actor_id (private.transition_event;
-- the admins' review email is queued by its trigger). Locks the organiser
-- (share), then the event. Returns:
--   'submitted'         done
--   'not_found'         no such event, or not p_organiser_id's
--   'not_submittable'   not draft or rejected
--   'payouts_required'  Sheltüh-ticketed with a paid ticket type, and the
--                       organiser's payouts aren't enabled: nothing written
create function private.submit_event(p_event_id uuid, p_organiser_id uuid, p_actor_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_payouts boolean;
  v_event record;
begin
  select o.payouts_enabled into v_payouts from public.organisers o where o.id = p_organiser_id for share;
  if not found then
    return 'not_found';
  end if;
  select e.status, e.ticketing_mode into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_submittable';
  end if;
  if not v_payouts and v_event.ticketing_mode = 'sheltuh'
     and exists (select 1 from public.ticket_types t where t.event_id = p_event_id and t.price_cents > 0) then
    return 'payouts_required';
  end if;

  if not private.transition_event(p_event_id, array['draft', 'rejected']::public.event_status[], 'pending_review',
                                  'submitted', p_actor_id, null, p_organiser_id) then
    raise exception 'submit_event: the locked event could not be submitted';
  end if;
  return 'submitted';
end;
$$;

revoke all on function private.events_paid_tickets_need_payouts() from public, anon, authenticated;
revoke all on function private.ticket_types_paid_need_payouts() from public, anon, authenticated;
revoke all on function private.submit_event(uuid, uuid, uuid) from public, anon, authenticated;
