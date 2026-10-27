-- Per-event refund policy (owner request: organisers choose "No
-- change-of-mind refunds" or "Refunds up to X days before", and buyers see it
-- before paying; docs/architecture.md, "Refund policy"). Data and display
-- only: refunds stay manual, made in Stripe ("Refunds made in Stripe").
--
--   * public.events.refund_policy: 'no_change_of_mind' (the default) or
--     'days_before'; refund_days: 1–30 for 'days_before', null otherwise
--     (check constraints events_refund_policy_check, events_refund_days_check).
--     Existing events get 'no_change_of_mind', which is what the /refunds page
--     already says (refunds only for a cancelled or significantly changed
--     event, or as the Australian Consumer Law otherwise requires).
--   * private.create_event_draft, edit_event_draft and admin_edit_event read
--     p_fields' refundPolicy and refundDays (already validated by
--     lib/server/event-input.ts; the constraints hold whatever is sent).
--     Without refundPolicy, create uses the default and the edits keep the
--     stored policy, so a caller from before this migration (the deploy
--     window) changes nothing. Same signatures; every function pins its
--     search_path and has execute revoked again.
--   * Buyers keep what they bought under: an edit that makes the policy of an
--     event with paid orders, or pending ones that can still be paid
--     (private.event_has_payable_orders: a card order whose Stripe Checkout
--     Session is recorded, or a guest's free order waiting on its emailed
--     link), less generous (private.refund_policy_tightens:
--     days_before → no_change_of_mind, or more days' notice) is refused
--     ('refund_policy_tightened', nothing written) by both admin_edit_event
--     (any status) and edit_event_draft (a draft that was published and sold
--     before it was unpublished). Loosening is allowed. The check runs with the
--     event row locked (for no key update), and every order insert share-locks
--     the event row first (orders_sheltuh_only, orders_not_ended), as does
--     recording a card order's session (private.finish_checkout_attempt,
--     20261109000400_checkout_attempts.sql), so an order can't become payable
--     between the check and the write. A pending card order with no session
--     (being set up, or kept after Stripe didn't answer) doesn't count: nobody
--     can pay it yet, and its payment page, once it can, reads the policy as it
--     is then. Counting it would let one unanswered Stripe call block an
--     organiser's edit until the daily purge fails the order (2 days).
--   * admin_edit_event logs a policy change in its 'edited' entry
--     (changes.refundPolicy, changes.refundDays: old and new).
--
-- private.update_event_draft (the earlier boolean form, kept for the deploy
-- window and no longer called) doesn't write the policy, so it keeps the
-- stored one: no change needed. admin_create_event goes through
-- create_event_draft. admin_set_event_ticketing doesn't touch it.
--
-- No index: the columns are never filtered or sorted on; the orders check is
-- by event (orders_event_idx).
--
-- Additive. The two columns are added with a constant default (no table
-- rewrite in Postgres 11+); validating the checks scans public.events once
-- under the ALTER's lock. Reversible: restore the three functions from
-- 20261022000000_external_ticketing.sql (create_event_draft),
-- 20261101000000_reserved_seating.sql (edit_event_draft) and
-- 20261022000100_admin_event_authoring.sql (admin_edit_event), drop
-- private.refund_policy_tightens and private.event_has_payable_orders, then drop the two columns (which loses the
-- policies organisers chose; the app needs its previous version first, since
-- it reads the columns).

alter table public.events
  add column refund_policy text not null default 'no_change_of_mind',
  add column refund_days integer;

alter table public.events
  add constraint events_refund_policy_check check (refund_policy in ('no_change_of_mind', 'days_before')),
  -- coalesce: with null days, `refund_days between 1 and 30` is null, which a
  -- check constraint would let through.
  add constraint events_refund_days_check check (
    case when refund_policy = 'days_before' then coalesce(refund_days between 1 and 30, false)
         else refund_days is null end
  );

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

-- Whether p_event_id has orders a tightened refund policy would break faith
-- with: paid ones, and pending ones that can still be paid (a card order whose
-- Checkout Session is recorded, or a guest's free order waiting on its emailed
-- link). A pending card order with no session can't be paid (yet): its
-- payment page answers 409 until the session is recorded, then shows the
-- policy as it is. By event (orders_event_idx).
create function private.event_has_payable_orders(p_event_id uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
     where o.event_id = p_event_id
       and (o.status = 'paid'
            or (o.status = 'pending'
                and (o.stripe_checkout_session_id is not null or o.confirmation_token_hash is not null))));
$$;

-- Whether changing an event's policy from (p_old_policy, p_old_days) to
-- (p_new_policy, p_new_days) is worse for a buyer: the change-of-mind refund
-- window would close earlier. A 'days_before' window closes p_days before the
-- event (fewer days is more generous); 'no_change_of_mind' has none at all.
-- So: days_before → no_change_of_mind, or more days, tightens;
-- no_change_of_mind → days_before, fewer days, or the same, doesn't.
-- lib/refund-policy.ts (tightensRefundPolicy) is the same rule for the UI;
-- tests/server/refund-policy.test.ts checks they agree.
create function private.refund_policy_tightens(
  p_old_policy text, p_old_days integer, p_new_policy text, p_new_days integer
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when p_new_policy = 'days_before' then p_new_days else 2147483647 end
       > case when p_old_policy = 'days_before' then p_old_days else 2147483647 end;
$$;

-- ---------------------------------------------------------------------------
-- Creating
-- ---------------------------------------------------------------------------

-- As in 20261022000000_external_ticketing.sql, plus refundPolicy (default
-- 'no_change_of_mind') and refundDays (null unless sent).
create or replace function private.create_event_draft(
  p_organiser_id uuid, p_slug text, p_fields jsonb, p_ticket_types jsonb
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
begin
  insert into public.events
    (organiser_id, slug, title, description, category, venue_name, venue_address, suburb, starts_at, ends_at,
     ticketing_mode, external_ticket_url, external_free, is_free, refund_policy, refund_days)
  values (
    p_organiser_id,
    p_slug,
    p_fields ->> 'title',
    p_fields ->> 'description',
    (p_fields ->> 'category')::public.event_category,
    p_fields ->> 'venueName',
    p_fields ->> 'venueAddress',
    p_fields ->> 'suburb',
    (p_fields ->> 'startsAt')::timestamptz,
    (p_fields ->> 'endsAt')::timestamptz,
    v_mode,
    p_fields ->> 'externalTicketUrl',
    v_free,
    v_mode = 'external' and v_free,
    coalesce(p_fields ->> 'refundPolicy', 'no_change_of_mind'),
    (p_fields ->> 'refundDays')::integer
  )
  returning id into v_id;

  perform private.replace_ticket_types(v_id, p_ticket_types);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The organiser's edit
-- ---------------------------------------------------------------------------

-- As in 20261101000000_reserved_seating.sql, plus the refund policy: with
-- refundPolicy in p_fields, refundPolicy and refundDays (null if absent) are
-- saved; without it, the stored policy is kept. One more result:
--   'refund_policy_tightened'  the edit would make the policy less generous
--                              (private.refund_policy_tightens) and the event
--                              has pending or paid orders (it was published,
--                              then unpublished): nothing written
create or replace function private.edit_event_draft(
  p_event_id uuid, p_organiser_id uuid, p_fields jsonb, p_ticket_types jsonb
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_url text := p_fields ->> 'externalTicketUrl';
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
  v_refund_policy text;
  v_refund_days integer;
begin
  select e.status, e.ticketing_mode, e.external_ticket_url, e.refund_policy, e.refund_days into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if (v_event.ticketing_mode is distinct from v_mode or v_event.external_ticket_url is distinct from v_url)
     and exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'ticketing_frozen';
  end if;

  if p_fields ? 'refundPolicy' then
    v_refund_policy := p_fields ->> 'refundPolicy';
    v_refund_days := (p_fields ->> 'refundDays')::integer;
  else
    v_refund_policy := v_event.refund_policy;
    v_refund_days := v_event.refund_days;
  end if;
  if private.refund_policy_tightens(v_event.refund_policy, v_event.refund_days, v_refund_policy, v_refund_days)
     and private.event_has_payable_orders(p_event_id) then
    return 'refund_policy_tightened';
  end if;

  if v_mode = 'external' then
    perform private.clear_seat_map(p_event_id);
    perform private.replace_ticket_types(p_event_id, '[]'::jsonb);
  end if;

  update public.events set
    title = p_fields ->> 'title',
    description = p_fields ->> 'description',
    category = (p_fields ->> 'category')::public.event_category,
    venue_name = p_fields ->> 'venueName',
    venue_address = p_fields ->> 'venueAddress',
    suburb = p_fields ->> 'suburb',
    starts_at = (p_fields ->> 'startsAt')::timestamptz,
    ends_at = (p_fields ->> 'endsAt')::timestamptz,
    ticketing_mode = v_mode,
    external_ticket_url = v_url,
    external_free = v_free,
    is_free = case when v_mode = 'external' then v_free else is_free end,
    refund_policy = v_refund_policy,
    refund_days = v_refund_days
  where id = p_event_id;

  if v_mode <> 'external' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;
  return 'updated';
end;
$$;

-- ---------------------------------------------------------------------------
-- An admin's edit
-- ---------------------------------------------------------------------------

-- As in 20261022000100_admin_event_authoring.sql, plus the refund policy
-- (refundPolicy and refundDays as edit_event_draft reads them: kept when
-- refundPolicy isn't sent). A change is logged in the 'edited' entry
-- (refundPolicy, refundDays: old and new). One more refusal, decided with the
-- others before anything is written:
--   'refund_policy_tightened'  the edit would make the policy less generous
--                              (private.refund_policy_tightens) and the event
--                              has pending or paid orders
create or replace function private.admin_edit_event(
  p_event_id uuid, p_admin_id uuid, p_expected_updated_at timestamptz,
  p_fields jsonb, p_ticket_types jsonb, p_publish boolean, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_organiser_id uuid;
  v_org record;
  v_event record;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_url text := p_fields ->> 'externalTicketUrl';
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
  v_refund_policy text;
  v_refund_days integer;
  v_ticketing_changed boolean;
  v_publish boolean;
  v_old jsonb;
  v_new jsonb;
  v_details jsonb;
  v_ticketing_result text;
begin
  select e.organiser_id into v_organiser_id from public.events e where e.id = p_event_id;
  if not found then
    return 'not_found';
  end if;
  -- Organiser (share), then event, as event approval and suspend_organiser.
  select o.status, o.owner_user_id into v_org from public.organisers o where o.id = v_organiser_id for share;
  select e.* into v_event from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  if date_trunc('milliseconds', v_event.updated_at) is distinct from date_trunc('milliseconds', p_expected_updated_at)
     or v_event.organiser_id <> v_organiser_id then
    return 'stale';
  end if;

  if p_fields ? 'refundPolicy' then
    v_refund_policy := p_fields ->> 'refundPolicy';
    v_refund_days := (p_fields ->> 'refundDays')::integer;
  else
    v_refund_policy := v_event.refund_policy;
    v_refund_days := v_event.refund_days;
  end if;

  v_ticketing_changed := v_event.ticketing_mode is distinct from v_mode
    or v_event.external_ticket_url is distinct from v_url
    or v_event.external_free is distinct from v_free;
  v_publish := coalesce(p_publish, false) and v_event.status <> 'published';

  -- Every other field, old and new, in the API's names. Ticket types in the
  -- request's shape (an empty description left out), in display order.
  v_old := jsonb_build_object(
    'title', v_event.title,
    'description', v_event.description,
    'category', v_event.category::text,
    'venueName', v_event.venue_name,
    'venueAddress', v_event.venue_address,
    'suburb', v_event.suburb,
    'startsAt', v_event.starts_at,
    'endsAt', v_event.ends_at,
    'refundPolicy', v_event.refund_policy,
    'refundDays', v_event.refund_days,
    'ticketTypes', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', t.id, 'name', t.name, 'description', t.description, 'priceCents', t.price_cents,
               'feePolicy', t.fee_policy::text, 'quantityAvailable', t.quantity_available)) order by t.position)
        from public.ticket_types t where t.event_id = p_event_id), '[]'::jsonb));
  v_new := jsonb_build_object(
    'title', p_fields ->> 'title',
    'description', p_fields ->> 'description',
    'category', p_fields ->> 'category',
    'venueName', p_fields ->> 'venueName',
    'venueAddress', p_fields ->> 'venueAddress',
    'suburb', p_fields ->> 'suburb',
    'startsAt', (p_fields ->> 'startsAt')::timestamptz,
    'endsAt', (p_fields ->> 'endsAt')::timestamptz,
    'refundPolicy', v_refund_policy,
    'refundDays', v_refund_days,
    'ticketTypes', case when v_mode = 'external' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', x.e ->> 'id', 'name', x.e ->> 'name', 'description', nullif(x.e ->> 'description', ''),
               'priceCents', (x.e ->> 'priceCents')::integer, 'feePolicy', x.e ->> 'feePolicy',
               'quantityAvailable', (x.e ->> 'quantityAvailable')::integer)) order by x.ord)
        from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)), '[]'::jsonb) end);
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k)), '{}'::jsonb)
    into v_details
    from jsonb_object_keys(v_new) k
   where (v_old -> k) is distinct from (v_new -> k);

  if v_details = '{}'::jsonb and not v_ticketing_changed and not v_publish then
    return 'unchanged';
  end if;

  -- Refusals, before anything is written.
  if v_org.owner_user_id is null and v_mode = 'sheltuh'
     and exists (select 1 from jsonb_array_elements(p_ticket_types) t where (t ->> 'priceCents')::integer > 0) then
    return 'platform_paid';
  end if;
  if v_mode = 'external' and v_event.ticketing_mode <> 'external'
     and exists (select 1 from public.orders o where o.event_id = p_event_id) then
    return 'has_orders';
  end if;
  if private.refund_policy_tightens(v_event.refund_policy, v_event.refund_days, v_refund_policy, v_refund_days)
     and private.event_has_payable_orders(p_event_id) then
    return 'refund_policy_tightened';
  end if;
  if (v_event.ticketing_mode is distinct from v_mode or v_event.external_ticket_url is distinct from v_url)
     and p_reason is null
     and exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'reason_required';
  end if;
  if v_publish and v_org.status <> 'approved' then
    return 'organiser_not_approved';
  end if;

  -- Ticketing first: switching to external deletes the ticket types, and
  -- switching back leaves none for replace_ticket_types to add below.
  if v_ticketing_changed then
    v_ticketing_result := private.admin_set_event_ticketing(p_event_id, p_admin_id, v_mode, v_url, v_free, p_reason);
    if v_ticketing_result <> 'updated' then
      raise exception 'admin_edit_event: unexpected ticketing result %', v_ticketing_result;
    end if;
  end if;

  if v_details - 'ticketTypes' <> '{}'::jsonb then
    update public.events set
      title = p_fields ->> 'title',
      description = p_fields ->> 'description',
      category = (p_fields ->> 'category')::public.event_category,
      venue_name = p_fields ->> 'venueName',
      venue_address = p_fields ->> 'venueAddress',
      suburb = p_fields ->> 'suburb',
      starts_at = (p_fields ->> 'startsAt')::timestamptz,
      ends_at = (p_fields ->> 'endsAt')::timestamptz,
      refund_policy = v_refund_policy,
      refund_days = v_refund_days
    where id = p_event_id;
  end if;
  if v_mode = 'sheltuh' and v_details ? 'ticketTypes' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;

  if v_details <> '{}'::jsonb then
    insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
    values (p_event_id, 'edited', p_admin_id, p_reason, v_details);
  end if;

  if v_publish then
    if not private.transition_event(p_event_id, array['draft', 'pending_review', 'rejected']::public.event_status[],
                                    'published', 'approved', p_admin_id) then
      raise exception 'admin_edit_event: the event could not be published';
    end if;
  end if;
  return 'updated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.refund_policy_tightens(text, integer, text, integer) from public, anon, authenticated;
revoke all on function private.event_has_payable_orders(uuid) from public, anon, authenticated;
revoke all on function private.create_event_draft(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.edit_event_draft(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.admin_edit_event(uuid, uuid, timestamptz, jsonb, jsonb, boolean, text)
  from public, anon, authenticated;
