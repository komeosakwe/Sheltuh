-- Support Sheltüh (docs/architecture.md, "Support Sheltüh"): an optional
-- amount a buyer adds to a paid checkout, which goes entirely to Sheltüh, the
-- platform.
--
--   * public.orders.support_cents: the amount (integer cents), 0 for none.
--     orders_support_cents_check: 0 to 50000 (A$500; lib/support.ts
--     SUPPORT_MAX_CENTS; the API also refuses 1 to 99).
--     orders_support_paid_only: only an order with a paid ticket carries any
--     (subtotal_cents > 0). Free orders never go through Stripe.
--     orders_support_in_total: an order with support has
--     total_cents = subtotal_cents + buyer_fee_cents + support_cents, so
--     total_cents stays what the buyer pays (what Stripe charges). Orders
--     without support are left as they were (every existing row has 0, so
--     the constraint is checked and valid at once, and no older row can ever
--     fail a later update because of it).
--     subtotal_cents, buyer_fee_cents and application_fee_cents (the booking
--     fee) keep their meaning: support is never in them. The Checkout
--     Session's application_fee_amount is application_fee_cents +
--     support_cents (lib/server/checkout-attempts.ts), so the organiser's
--     transfer (total - application fee) is exactly what it would be
--     without support. Organiser-facing money (analytics, tracking links)
--     reads total_cents - support_cents.
--   * private.hold_seats gains p_support_cents (integer, default 0, last
--     input), stored on the seated order it creates in the same step. A new
--     argument means a new signature, so the 18-argument form is dropped and
--     the 19-argument one created in the same transaction: the previous app
--     version's 18-argument call resolves to it (the default fills
--     p_support_cents), so it keeps working during the deploy window.
--     Otherwise identical to 20261102000000_seating_hardening.sql (results,
--     locks, lock order, refusals writing nothing).
--
-- The general admission paid order is inserted by the API itself
-- (lib/server/handlers/orders.ts, one statement), which now names the
-- column; the free order functions don't (they take the default, 0).
--
-- No index: support_cents is never filtered or sorted on.
--
-- Access model as everywhere else: hold_seats pins search_path = '' and has
-- execute revoked from PUBLIC, anon and authenticated.
--
-- Apply before the app that writes support_cents deploys (its general
-- admission insert and its 19-argument hold_seats call fail without it). The
-- previous app keeps working against it.
--
-- Additive. Adding a not-null column with a constant default is a catalogue
-- change (no table rewrite); the two constraints scan public.orders once
-- under the ALTER's ACCESS EXCLUSIVE lock (brief at pre-launch volumes).
-- Reversible: deploy the previous app first, then drop the three constraints
-- and the column (losing the support amounts recorded, which Stripe still
-- has on each payment), drop the 19-argument private.hold_seats and restore
-- the 18-argument one from 20261102000000_seating_hardening.sql with its
-- revoke.

alter table public.orders
  add column support_cents integer not null default 0
    constraint orders_support_cents_check check (support_cents >= 0 and support_cents <= 50000);

alter table public.orders
  add constraint orders_support_paid_only check (support_cents = 0 or subtotal_cents > 0),
  add constraint orders_support_in_total
    check (support_cents = 0 or total_cents = subtotal_cents + buyer_fee_cents + support_cents);

-- ---------------------------------------------------------------------------
-- Seated holds: the order carries its support amount
-- ---------------------------------------------------------------------------

drop function private.hold_seats(text, uuid, uuid, text, jsonb, integer, integer, integer, integer, text, text,
  integer, text[], interval, integer, interval, integer, numeric);

-- As in 20261102000000_seating_hardening.sql, plus p_support_cents (the
-- order's support_cents; p_total_cents already includes it). Creates
-- p_order_id (pending, with p_seat_ids) and holds its seats until
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
-- orders_sheltuh_only (check_violation, the API's 409), and nothing is kept;
-- a support amount the orders constraints refuse is a check_violation too
-- (the API never sends one).
create function private.hold_seats(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_subtotal_cents integer, p_buyer_fee_cents integer, p_total_cents integer, p_application_fee_cents integer,
  p_buyer_email text, p_tracking_code text, p_map_version integer, p_seat_ids text[], p_hold interval,
  p_attempt_limit integer, p_attempt_window interval, p_cap_min integer, p_cap_share numeric,
  p_support_cents integer default 0,
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
       buyer_fee_cents, total_cents, application_fee_cents, buyer_email, tracking_code, seat_ids, support_cents)
    values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, p_subtotal_cents,
       p_buyer_fee_cents, p_total_cents, p_application_fee_cents, p_buyer_email,
       (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
       p_seat_ids, coalesce(p_support_cents, 0));

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

revoke all on function private.hold_seats(text, uuid, uuid, text, jsonb, integer, integer, integer, integer, text, text,
  integer, text[], interval, integer, interval, integer, numeric, integer) from public, anon, authenticated;
