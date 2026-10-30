-- "Release more tickets" (docs/architecture.md, "Releasing more tickets"): an
-- organiser raises the quantity of one general admission ticket type of their
-- own published, not-yet-ended, Sheltüh-ticketed event. Until now only an
-- admin (private.admin_edit_event) could change a published event.
--
--   * private.release_tickets: one atomic step. It locks the organiser (for
--     share), the event (for no key update) and the ticket type (for
--     update), in that order (fulfil_order locks the event and then ticket
--     types, and suspend_organiser the organiser and then events, so no
--     cycle), rechecks every rule under the locks, raises
--     quantity_available, bumps the event's updated_at (an admin's edit made
--     from an older version is then stale, so it can't lower the number
--     again unseen) and appends an `edited` entry to event_moderation_log
--     ({"ticketTypes": {old, new}}: only the changed tier, as
--     [{id, name, quantityAvailable}] before and after, so a log that every
--     event read aggregates stays small), under a per-organiser hourly cap
--     (take_rate_limit 'ticket_releases') and a per-event daily cap
--     (take_event_rate_limit 'ticket_releases'). It changes nothing else:
--     not the price, the fee policy, the name, nor quantity_sold.
--   * No new table, enum value, trigger or grant. The waitlist needs no new
--     code: raising quantity_available on a ticket type with more tickets
--     left than before fires ticket_types_waitlist_release_update (deferred
--     to commit, 20261024000000_waitlist.sql), which runs
--     private.notify_waitlist on the final state, once per person per 12
--     hours whichever path raised the number.
--   * The upper bound (p_max) comes from the caller (lib/server/handlers/
--     ticket-release.ts, MAX_TICKETS_PER_TYPE): creating a ticket type has
--     none beyond a whole number of at least 1.
--
-- Results: 'released' (done), 'not_found' (no such event for this organiser,
-- the organiser isn't the actor, or no such ticket type), 'not_approved' (the
-- organiser isn't approved any more), 'not_published', 'ended', 'external',
-- 'seated' (a seated tier's capacity is its seats: the seat map sets it),
-- 'not_increase' (p_quantity isn't above the current quantity: `total` is
-- the current one), 'too_many' (above p_max), 'rate_limited' (the organiser's
-- hourly allowance or the event's daily one). A null actor is 'not_found' (a
-- platform-managed organiser has no owner: a null actor must never match it);
-- a null quantity, cap or limit is a programming error and raises. `total` and
-- `sold` are the ticket type's quantities after the call (or as they stand
-- for a refusal that read them).
--
-- Access model as everywhere else: not SECURITY DEFINER (the API connects as
-- the owner), search_path pinned, execute revoked from PUBLIC, anon and
-- authenticated.
--
-- Reversible, not destructive: drop the function. The `edited` entries it
-- wrote stay in the log (harmless: the log's `edited` action exists already),
-- and so do the quantities.

create function private.release_tickets(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_ticket_type_id text,
  p_quantity integer, p_max integer, p_limit integer, p_window interval,
  p_event_limit integer, p_event_window interval,
  out result text, out total integer, out sold integer
)
language plpgsql
set search_path = ''
as $$
declare
  v_org record;
  v_event record;
  v_ticket record;
  v_old jsonb;
  v_new jsonb;
begin
  if p_actor_id is null then
    result := 'not_found';
    return;
  end if;
  if p_quantity is null or p_max is null or p_limit is null or p_window is null
     or p_event_limit is null or p_event_window is null then
    raise exception 'release_tickets: a quantity, cap or limit is missing';
  end if;

  select o.status::text as status, o.owner_user_id
    into v_org
    from public.organisers o where o.id = p_organiser_id for share;
  if not found or v_org.owner_user_id is distinct from p_actor_id then
    result := 'not_found';
    return;
  end if;
  if v_org.status <> 'approved' then
    result := 'not_approved';
    return;
  end if;

  select e.status::text as status, e.ends_at, e.ticketing_mode
    into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    result := 'not_found';
    return;
  end if;
  if v_event.status <> 'published' then
    result := 'not_published';
    return;
  end if;
  if v_event.ends_at <= now() then
    result := 'ended';
    return;
  end if;
  if v_event.ticketing_mode <> 'sheltuh' then
    result := 'external';
    return;
  end if;

  select t.name, t.quantity_available, t.quantity_sold, t.seated
    into v_ticket
    from public.ticket_types t
   where t.event_id = p_event_id and t.id = p_ticket_type_id
     for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  total := v_ticket.quantity_available;
  sold := v_ticket.quantity_sold;
  if v_ticket.seated then
    result := 'seated';
    return;
  end if;
  if p_quantity <= v_ticket.quantity_available then
    result := 'not_increase';
    return;
  end if;
  if p_quantity > p_max then
    result := 'too_many';
    return;
  end if;
  -- Last, so only a release that would happen uses a slot: the event's first
  -- (a plain read once it's over the limit), then the organiser's.
  if not private.take_event_rate_limit(p_event_id, 'ticket_releases', p_event_limit, p_event_window) then
    result := 'rate_limited';
    return;
  end if;
  if not private.take_rate_limit(p_actor_id, 'ticket_releases', p_limit, p_window) then
    result := 'rate_limited';
    return;
  end if;

  v_old := jsonb_build_array(jsonb_build_object(
             'id', p_ticket_type_id, 'name', v_ticket.name, 'quantityAvailable', v_ticket.quantity_available));

  update public.ticket_types t
     set quantity_available = p_quantity
   where t.event_id = p_event_id and t.id = p_ticket_type_id;

  v_new := jsonb_build_array(jsonb_build_object(
             'id', p_ticket_type_id, 'name', v_ticket.name, 'quantityAvailable', p_quantity));

  -- events_set_updated_at sets the time.
  update public.events set updated_at = now() where id = p_event_id;
  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_actor_id,
          jsonb_build_object('ticketTypes', jsonb_build_object('old', v_old, 'new', v_new)));

  total := p_quantity;
  result := 'released';
end;
$$;

revoke all on function private.release_tickets(uuid, uuid, uuid, text, integer, integer, integer, interval, integer, interval)
  from public, anon, authenticated;
