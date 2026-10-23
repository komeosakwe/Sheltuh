-- Reserved seating hardening (security review of 963ab62; docs/architecture.md,
-- "Reserved seating"). Redefines functions only: no table, column or data
-- changes.
--
--   * private.hold_seats counted a hold attempt (take_event_rate_limit,
--     bucket 'seat_holds') before deciding anything else, so refused attempts
--     (above all the held-seat cap, which a hoarder reaches first) used up
--     the event's 120 attempts per 10 minutes, and one anonymous client could
--     lock every buyer out. Now every refusal is decided first (not on sale,
--     map version, seats unavailable, lines and seats differ, the hold cap),
--     and only a hold that is about to be made takes a hit on the counter.
--     A window that is already used up is refused up front with a plain read
--     (nothing written), as take_event_rate_limit itself does. Results and
--     signature are unchanged.
--     Lock order unchanged: the event's seat advisory lock, the order (its
--     insert), the event (share), seats in id order; the counter's row
--     (private.event_rate_limits, bucket 'seat_holds', only ever written here
--     under the seat lock) comes last.
--   * private.write_seat_map and private.clear_seat_map refuse (check_violation,
--     constraint name event_seat_maps_no_orders: the API's 409) when the event
--     has any order, whatever its status, and private.replace_seat_map and
--     private.delete_seat_map say 'has_orders' before calling them. Callers
--     already made sure of it (an organiser's map is frozen at the first
--     approval, and admin_replace_seat_map and admin_set_event_ticketing check
--     for orders); this is defence in depth, so no future caller can rewrite
--     seats that a pending order holds or a paid one has sold.
--
-- orders_event_idx (event_id) serves the new "any order" checks.
--
-- Access model as everywhere else: every redefined function keeps its pinned
-- search_path and has execute revoked from PUBLIC, anon and authenticated.
--
-- Reversible: restore private.hold_seats from 20261101000100_seat_holds.sql,
-- and private.write_seat_map, private.clear_seat_map,
-- private.replace_seat_map and private.delete_seat_map from
-- 20261101000000_reserved_seating.sql. Nothing to undo in the data.

-- ---------------------------------------------------------------------------
-- Holds: refusals first, then the attempt counter
-- ---------------------------------------------------------------------------

-- Creates p_order_id (pending, with p_seat_ids) and holds its seats until
-- now() + p_hold, all or nothing. p_line_items and the totals are the API's
-- priced snapshot (prices from the database, a line per tier). Returns:
--   result 'held'               done: hold_expires_at is set
--          'rate_limited'       the event already had p_attempt_limit holds in
--                               this p_attempt_window: nothing written
--          'not_on_sale'        the event isn't published or is external
--          'version'            the map isn't version p_map_version (or is gone)
--          'seats_unavailable'  unavailable_seat_ids can't be had
--          'tier_mismatch'      the lines don't match the seats' tiers
--          'hold_cap'           the event already has too many seats held
--                               (more than the larger of p_cap_min and
--                               p_cap_share of its unblocked seats with these)
-- Every refusal writes nothing at all: only a hold counts towards
-- p_attempt_limit. An external event's order is refused by
-- orders_sheltuh_only (check_violation, the API's 409), and nothing is kept.
create or replace function private.hold_seats(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_subtotal_cents integer, p_buyer_fee_cents integer, p_total_cents integer, p_application_fee_cents integer,
  p_buyer_email text, p_tracking_code text, p_map_version integer, p_seat_ids text[], p_hold interval,
  p_attempt_limit integer, p_attempt_window interval, p_cap_min integer, p_cap_share numeric,
  out result text, out hold_expires_at timestamptz, out unavailable_seat_ids text[]
)
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_version integer;
  v_unavailable text[];
  v_held integer;
  v_sellable integer;
begin
  if p_seat_ids is null or cardinality(p_seat_ids) not between 1 and 10
     or cardinality(p_seat_ids) <> (select count(distinct x) from unnest(p_seat_ids) x) then
    raise exception 'between 1 and 10 distinct seats' using errcode = '22023';
  end if;

  perform private.lock_event_seats(p_event_id);
  -- A used-up window: refused with a plain read, before any work. Exact, since
  -- the counter is only ever written under the seat lock held here.
  if exists (select 1 from private.event_rate_limits r
              where r.event_id = p_event_id and r.bucket = 'seat_holds'
                and r.window_started_at > now() - p_attempt_window and r.hits >= p_attempt_limit) then
    result := 'rate_limited';
    return;
  end if;

  begin
    -- The order (orders_sheltuh_only share-locks the event row).
    insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
       buyer_fee_cents, total_cents, application_fee_cents, buyer_email, tracking_code, seat_ids)
    values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, p_subtotal_cents,
       p_buyer_fee_cents, p_total_cents, p_application_fee_cents, p_buyer_email,
       (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
       p_seat_ids);

    select e.status, e.ticketing_mode into v_event from public.events e where e.id = p_event_id for share;
    if v_event.status is distinct from 'published' or v_event.ticketing_mode is distinct from 'sheltuh' then
      raise exception 'not on sale' using errcode = 'SH404';
    end if;
    select m.version into v_version from public.event_seat_maps m where m.event_id = p_event_id;
    if v_version is distinct from p_map_version then
      raise exception 'map version' using errcode = 'SH412';
    end if;

    -- Seats in id order.
    perform 1 from public.event_seats s
     where s.event_id = p_event_id and s.id = any(p_seat_ids)
     order by s.id
       for update;
    v_unavailable := private.unavailable_seats(p_event_id, p_seat_ids, p_order_id);
    if cardinality(v_unavailable) > 0 then
      unavailable_seat_ids := v_unavailable;
      raise exception 'seats unavailable' using errcode = 'SH409';
    end if;
    if not private.order_seats_match(p_event_id, p_line_items, p_seat_ids) then
      raise exception 'lines and seats differ' using errcode = 'SH422';
    end if;

    -- Anti-hoarding: seats held right now (unexpired), against the larger of
    -- p_cap_min and p_cap_share of the unblocked seats (the seated tiers'
    -- capacity).
    select count(*)::integer into v_held from public.event_seats s
     where s.event_id = p_event_id and s.hold_order_id is not null and s.hold_expires_at > now();
    select coalesce(sum(t.quantity_available), 0)::integer into v_sellable
      from public.ticket_types t where t.event_id = p_event_id and t.seated;
    if v_held + cardinality(p_seat_ids) > greatest(p_cap_min, floor(v_sellable * p_cap_share)::integer) then
      raise exception 'hold cap' using errcode = 'SH429';
    end if;

    -- Every refusal is behind us: this is a real hold, and only it counts.
    if not private.take_event_rate_limit(p_event_id, 'seat_holds', p_attempt_limit, p_attempt_window) then
      raise exception 'hold attempts' using errcode = 'SH430';
    end if;

    update public.event_seats s
       set hold_order_id = p_order_id, hold_expires_at = now() + p_hold
     where s.event_id = p_event_id and s.id = any(p_seat_ids);
    hold_expires_at := now() + p_hold;
    result := 'held';
  exception
    -- Each undoes the order and anything locked or written in this block.
    when sqlstate 'SH404' then result := 'not_on_sale';
    when sqlstate 'SH412' then result := 'version';
    when sqlstate 'SH409' then result := 'seats_unavailable';
    when sqlstate 'SH422' then result := 'tier_mismatch';
    when sqlstate 'SH429' then result := 'hold_cap';
    when sqlstate 'SH430' then result := 'rate_limited';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Map writes: never while the event has orders
-- ---------------------------------------------------------------------------

-- As in 20261101000000_reserved_seating.sql, plus: refused (check_violation,
-- event_seat_maps_no_orders) when the event has any order. The caller holds
-- the seat lock and the event row.
create or replace function private.write_seat_map(p_event_id uuid, p_layout jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' or jsonb_typeof(p_layout -> 'sections') <> 'array' then
    raise exception 'invalid seat map layout' using errcode = '22023';
  end if;
  if exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id and m.layout = p_layout) then
    return 'unchanged';
  end if;
  if exists (select 1 from public.orders o where o.event_id = p_event_id) then
    raise exception 'An event with orders can''t have its seat map changed.'
      using errcode = 'check_violation', constraint = 'event_seat_maps_no_orders';
  end if;

  select count(*)::integer into v_count
    from jsonb_array_elements(p_layout -> 'sections') s (section)
   cross join lateral jsonb_array_elements(s.section -> 'rows') r (rw)
   cross join lateral jsonb_array_elements(r.rw -> 'seats') k (seat);

  -- Ticket types in id order (fulfil_order's order), before any seat.
  perform 1 from public.ticket_types t where t.event_id = p_event_id order by t.id for update;

  delete from public.event_seats s where s.event_id = p_event_id;
  insert into public.event_seat_maps (event_id, version, layout, seat_count)
  values (p_event_id, nextval('private.seat_map_versions')::integer, p_layout, v_count)
  on conflict (event_id) do update
     set version = excluded.version, layout = excluded.layout, seat_count = excluded.seat_count;

  insert into public.event_seats
    (event_id, id, position, section_label, row_label, seat_label, ticket_type_id, kind, blocked)
  select p_event_id,
         k.seat ->> 'id',
         (row_number() over (order by s.si, r.ri, k.ki))::integer - 1,
         s.section ->> 'label',
         r.rw ->> 'label',
         k.seat ->> 'label',
         k.seat ->> 'ticketTypeId',
         coalesce(k.seat ->> 'kind', 'standard'),
         coalesce((k.seat ->> 'blocked')::boolean, false)
    from jsonb_array_elements(p_layout -> 'sections') with ordinality as s (section, si)
   cross join lateral jsonb_array_elements(s.section -> 'rows') with ordinality as r (rw, ri)
   cross join lateral jsonb_array_elements(r.rw -> 'seats') with ordinality as k (seat, ki);

  -- At most 5 price tiers on a map (manager decision, docs/design/seating.md):
  -- buyers tell them apart by pattern, not colour.
  if (select count(distinct s.ticket_type_id) from public.event_seats s where s.event_id = p_event_id) > 5 then
    raise exception 'A seat map can use at most 5 ticket types.'
      using errcode = 'check_violation', constraint = 'event_seat_maps_max_tiers';
  end if;

  -- quantity_available is rewritten to itself so ticket_types_seated_capacity recomputes it.
  update public.ticket_types t
     set seated = exists (select 1 from public.event_seats s where s.event_id = t.event_id and s.ticket_type_id = t.id),
         quantity_available = t.quantity_available
   where t.event_id = p_event_id;
  return 'saved';
end;
$$;

-- As in 20261101000000_reserved_seating.sql, plus the same refusal when the
-- event has any order.
create or replace function private.clear_seat_map(p_event_id uuid) returns text
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id) then
    return 'unchanged';
  end if;
  if exists (select 1 from public.orders o where o.event_id = p_event_id) then
    raise exception 'An event with orders can''t have its seat map changed.'
      using errcode = 'check_violation', constraint = 'event_seat_maps_no_orders';
  end if;
  perform 1 from public.ticket_types t where t.event_id = p_event_id order by t.id for update;
  delete from public.event_seat_maps m where m.event_id = p_event_id;
  update public.ticket_types t set seated = false where t.event_id = p_event_id and t.seated;
  return 'deleted';
end;
$$;

-- As in 20261101000000_reserved_seating.sql, plus 'has_orders' (the event
-- has an order of any status: nothing written).
create or replace function private.replace_seat_map(p_event_id uuid, p_organiser_id uuid, p_layout jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
begin
  perform private.lock_event_seats(p_event_id);
  select e.status, e.ticketing_mode into v_event
    from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'frozen';
  end if;
  if v_event.ticketing_mode = 'external' then
    return 'external';
  end if;
  if exists (select 1 from public.orders o where o.event_id = p_event_id) then
    return 'has_orders';
  end if;
  return private.write_seat_map(p_event_id, p_layout);
end;
$$;

-- As in 20261101000000_reserved_seating.sql, plus 'has_orders'.
create or replace function private.delete_seat_map(p_event_id uuid, p_organiser_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_status public.event_status;
begin
  perform private.lock_event_seats(p_event_id);
  select e.status into v_status
    from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'frozen';
  end if;
  if exists (select 1 from public.orders o where o.event_id = p_event_id) then
    return 'has_orders';
  end if;
  return private.clear_seat_map(p_event_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (create or replace keeps them; restated so this file stands alone)
-- ---------------------------------------------------------------------------

revoke all on function private.hold_seats(text, uuid, uuid, text, jsonb, integer, integer, integer, integer, text, text,
  integer, text[], interval, integer, interval, integer, numeric) from public, anon, authenticated;
revoke all on function private.write_seat_map(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.clear_seat_map(uuid) from public, anon, authenticated;
revoke all on function private.replace_seat_map(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.delete_seat_map(uuid, uuid) from public, anon, authenticated;
