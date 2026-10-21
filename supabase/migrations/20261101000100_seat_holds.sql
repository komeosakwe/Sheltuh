-- Reserved seating, part 2: holds and sales (docs/SEATING_PLAN.md,
-- docs/architecture.md "Reserved seating"; part 1 is
-- 20261101000000_reserved_seating.sql).
--
--   * event_seats gains hold_order_id / hold_expires_at (a pending order's
--     hold) and sold_order_id (the paid order that owns it). One owner per
--     seat: never held and sold at once (event_seats_one_owner), never held
--     or sold while blocked (event_seats_blocked_unsold).
--   * orders.seat_ids: the seats a seated order is for (1 to 10, set when the
--     order is made, never changed). It's what fulfilment and refunds act on:
--     a hold can expire and go to someone else, the order still knows what it
--     asked for.
--   * tickets.seat_id: the ticket's seat. Its foreign key
--     (ticket_seats_sold_fkey: event, seat, order, ticket type) points at
--     event_seats (event_id, id, sold_order_id, ticket_type_id), so a ticket
--     can only name a seat sold to its own order, in its own tier; unique per
--     event (tickets_seat_key). A full refund clears the ticket's seat (and
--     then the seat's sale): the order's seat_ids keeps the history.
--   * private.hold_seats: a paid seated checkout's pending order and its
--     holds, in one step, all or nothing: under the event's seat lock, one
--     hit on the event's hold-attempt counter (take_event_rate_limit, bucket
--     'seat_holds': the API passes 120 per 10 minutes); then the order, the
--     event (published, Sheltüh-ticketed), the map version, every seat free
--     (unknown, sold, blocked or held by an unexpired hold: refused, with the
--     ids), the order's lines matching its seats' tiers, and the event's cap
--     on seats held at once (the larger of 20 and 30% of its unblocked
--     seats). Any refusal writes nothing but the attempt. Holds last p_hold
--     (35 minutes) and expire lazily: an expired hold is just free.
--   * private.release_seat_holds: a pending order marked failed and its holds
--     cleared (a Stripe error at checkout, the buyer cancelling, a Stripe
--     session expiring or an async payment failing).
--   * private.fulfil_order: a seated order takes its seats (free, or held by
--     itself, or held by an expired hold) with its inventory, and its
--     tickets get them; a seat gone elsewhere is the oversold path (refund),
--     which also clears the order's holds. Seated tiers are only ever sold
--     with seats: an order whose lines in seated tiers don't match its seats
--     exactly is refused the same way.
--   * private.record_payment_refund: a full refund of a seated order also
--     frees its seats (the ticket types' quantity_sold goes down as before,
--     so the waitlist is told as for any freed tickets).
--   * Free seated orders: private.place_free_seated_order (a member's own
--     verified email, issued at once through fulfil_order) and
--     private.request_free_seated_order (a guest: the pending order records
--     its seats but holds nothing until the emailed link is confirmed).
--     private.confirm_free_order now says 'seats_taken' when the seats went
--     to someone else in between.
--   * private.check_in_ticket also returns the ticket's seat (section, row,
--     seat, kind).
--
-- Lock order, everywhere: the event's seat advisory lock
-- (private.lock_event_seats), the order, the event, ticket types in id order,
-- seats in id order. Every function that changes a seated order's seats
-- takes the advisory lock before the order row (reading the order's event
-- first without a lock: event_id and seat_ids never change). A GA order
-- never takes it.
--
-- Access model as everywhere else: no new table; every new or redefined
-- function pins its search_path and has execute revoked from PUBLIC, anon
-- and authenticated.
--
-- Indexes: event_seats_hold_order_idx and event_seats_sold_order_idx
-- (partial, not null) serve the orders foreign keys and every "this order's
-- seats" lookup (release, refund, fulfilment); event_seats_active_holds_idx
-- (event_id, hold_expires_at) where held serves the hold cap's count.
-- tickets_seat_key (event_id, seat_id) also serves the seat lookups from
-- tickets.
--
-- Reversible: drop the functions added here; restore private.fulfil_order
-- from 20261014000000_email_outbox.sql, private.record_payment_refund from
-- 20261020000000_payment_refunds.sql, private.confirm_free_order from
-- 20261017000000_free_order_caps.sql and private.check_in_ticket from
-- 20261021130000_check_in_followups.sql (drop and create: its result columns
-- change); drop the new columns, constraints and indexes. Dropping
-- tickets.seat_id, orders.seat_ids and the event_seats sale columns discards
-- which seat each ticket was for: export them first if any seated event has
-- sold.

-- ---------------------------------------------------------------------------
-- Columns and constraints
-- ---------------------------------------------------------------------------

alter table public.event_seats
  add column hold_order_id text references public.orders (id) on delete set null,
  add column hold_expires_at timestamptz,
  add column sold_order_id text references public.orders (id),
  add constraint event_seats_one_owner check (sold_order_id is null or hold_order_id is null),
  add constraint event_seats_hold_expiry check (hold_order_id is null or hold_expires_at is not null),
  add constraint event_seats_blocked_unsold check (not blocked or (sold_order_id is null and hold_order_id is null)),
  add constraint event_seats_sold_ticket_key unique (event_id, id, sold_order_id, ticket_type_id);

create index event_seats_hold_order_idx on public.event_seats (hold_order_id) where hold_order_id is not null;
create index event_seats_sold_order_idx on public.event_seats (sold_order_id) where sold_order_id is not null;
create index event_seats_active_holds_idx on public.event_seats (event_id, hold_expires_at) where hold_order_id is not null;

alter table public.orders
  add column seat_ids text[],
  add constraint orders_seat_ids_check check (seat_ids is null or cardinality(seat_ids) between 1 and 10);

alter table public.tickets
  add column seat_id text,
  add constraint tickets_seat_key unique (event_id, seat_id),
  add constraint ticket_seats_sold_fkey foreign key (event_id, seat_id, order_id, ticket_type_id)
    references public.event_seats (event_id, id, sold_order_id, ticket_type_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The ids among p_seat_ids that p_order_id can't have: not a seat of the
-- event, blocked, sold, or held by another order's unexpired hold. Sorted.
create function private.unavailable_seats(p_event_id uuid, p_seat_ids text[], p_order_id text) returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.id order by x.id), '{}'::text[])
    from unnest(p_seat_ids) as x (id)
    left join public.event_seats s on s.event_id = p_event_id and s.id = x.id
   where s.id is null or s.blocked or s.sold_order_id is not null
      or (s.hold_order_id is not null and s.hold_order_id is distinct from p_order_id and s.hold_expires_at > now());
$$;

-- Whether an order's lines match its seats: for every seated ticket type,
-- the line's quantity is exactly the number of the order's seats in that
-- tier; every seat is one of the event's, in a tier the order has a line
-- for; no seat twice. With no seats, no line may be for a seated tier.
create function private.order_seats_match(p_event_id uuid, p_line_items jsonb, p_seat_ids text[]) returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_seat_ids is null or cardinality(p_seat_ids) = (select count(distinct x) from unnest(p_seat_ids) x))
     and coalesce(cardinality(p_seat_ids), 0)
           = (select count(*) from public.event_seats s where s.event_id = p_event_id and s.id = any(coalesce(p_seat_ids, '{}'::text[])))
     and not exists (
       select 1
         from (select li.value ->> 'ticketTypeId' as tier, sum((li.value ->> 'quantity')::integer)::integer as qty
                 from jsonb_array_elements(p_line_items) li
                 join public.ticket_types t on t.event_id = p_event_id and t.id = li.value ->> 'ticketTypeId'
                where t.seated
                group by 1) l
         full join (select s.ticket_type_id as tier, count(*)::integer as n
                      from public.event_seats s
                     where s.event_id = p_event_id and s.id = any(coalesce(p_seat_ids, '{}'::text[]))
                     group by 1) k using (tier)
        where l.qty is distinct from k.n);
$$;

-- ---------------------------------------------------------------------------
-- Holding seats (a paid seated checkout)
-- ---------------------------------------------------------------------------

-- Creates p_order_id (pending, with p_seat_ids) and holds its seats until
-- now() + p_hold, all or nothing. p_line_items and the totals are the API's
-- priced snapshot (prices from the database, a line per tier). Returns:
--   result 'held'               done: hold_expires_at is set
--          'rate_limited'       over p_attempt_limit hold attempts per
--                               p_attempt_window for the event: nothing written
--          'not_on_sale'        the event isn't published or is external
--          'version'            the map isn't version p_map_version (or is gone)
--          'seats_unavailable'  unavailable_seat_ids can't be had
--          'tier_mismatch'      the lines don't match the seats' tiers
--          'hold_cap'           the event already has too many seats held
--                               (more than the larger of p_cap_min and
--                               p_cap_share of its unblocked seats with these)
-- Every refusal but 'rate_limited' leaves only the attempt counted. An
-- external event's order is refused by orders_sheltuh_only (check_violation,
-- the API's 409), and nothing is kept.
create function private.hold_seats(
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
  if not private.take_event_rate_limit(p_event_id, 'seat_holds', p_attempt_limit, p_attempt_window) then
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
  end;
end;
$$;

-- Releases p_order_id's holds and marks it failed, if it's still pending.
-- Returns 'released', 'not_found', or the order's status when it isn't
-- pending ('paid', 'failed', ...): then nothing changes.
create function private.release_seat_holds(p_order_id text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_order record;
begin
  select o.event_id into v_event_id from public.orders o where o.id = p_order_id;
  if not found then
    return 'not_found';
  end if;
  perform private.lock_event_seats(v_event_id);
  select o.status, o.seat_ids into v_order from public.orders o where o.id = p_order_id for update;
  if v_order.status <> 'pending' then
    return v_order.status::text;
  end if;
  update public.orders set status = 'failed' where id = p_order_id;
  if v_order.seat_ids is not null then
    perform 1 from public.event_seats s
     where s.event_id = v_event_id and s.hold_order_id = p_order_id
     order by s.id
       for update;
    update public.event_seats s set hold_order_id = null, hold_expires_at = null
     where s.event_id = v_event_id and s.hold_order_id = p_order_id;
  end if;
  return 'released';
end;
$$;

-- ---------------------------------------------------------------------------
-- Fulfilment
-- ---------------------------------------------------------------------------

-- As in 20261014000000_email_outbox.sql (inventory, tickets, paid, the
-- ticket email; sold out or unpublished: oversold_refund_required), plus
-- seats: a seated order takes the event's seat lock before the order row,
-- every seat must be one it can have (free, held by itself, or an expired
-- hold), its lines must match its seats (and no order may buy a seated tier
-- without seats), and each ticket gets one of its tier's seats. The oversold
-- path also clears the order's holds.
create or replace function private.fulfil_order(
  p_order_id text, p_buyer_email text, p_payment_intent_id text, p_tickets jsonb
) returns public.order_status
language plpgsql
set search_path = ''
as $$
declare
  v_pre record;
  v_order public.orders;
  v_line jsonb;
  v_event_status public.event_status;
  v_taken integer;
begin
  -- event_id and seat_ids never change: safe to read before the lock order starts.
  select o.event_id, o.seat_ids into v_pre from public.orders o where o.id = p_order_id;
  if not found then
    return null;
  end if;
  if v_pre.seat_ids is not null then
    perform private.lock_event_seats(v_pre.event_id);
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return null;
  end if;
  if v_order.status <> 'pending' then
    return v_order.status;
  end if;

  begin
    select status into v_event_status from public.events where id = v_order.event_id for share;
    if v_event_status is distinct from 'published' then
      raise exception 'event % is not published', v_order.event_id using errcode = 'SH409';
    end if;

    -- Fixed lock order across concurrent orders avoids deadlocks.
    for v_line in
      select value from jsonb_array_elements(v_order.line_items) order by value ->> 'ticketTypeId'
    loop
      update public.ticket_types
      set quantity_sold = quantity_sold + (v_line ->> 'quantity')::integer
      where event_id = v_order.event_id
        and id = v_line ->> 'ticketTypeId'
        and quantity_sold + (v_line ->> 'quantity')::integer <= quantity_available;

      if not found then
        raise exception 'sold out: %', v_line ->> 'ticketTypeId' using errcode = 'SH409';
      end if;
    end loop;

    -- Seated tiers are sold only with their seats.
    if (v_order.seat_ids is not null
        or exists (select 1 from public.ticket_types t where t.event_id = v_order.event_id and t.seated))
       and not private.order_seats_match(v_order.event_id, v_order.line_items, v_order.seat_ids) then
      raise exception 'order % lines and seats differ', p_order_id using errcode = 'SH409';
    end if;

    if v_order.seat_ids is null then
      insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name)
      select t ->> 'ticketCode', p_order_id, v_order.event_id, t ->> 'ticketTypeId', t ->> 'ticketTypeName'
      from jsonb_array_elements(p_tickets) t;
    else
      perform 1 from public.event_seats s
       where s.event_id = v_order.event_id and s.id = any(v_order.seat_ids)
       order by s.id
         for update;
      update public.event_seats s
         set sold_order_id = p_order_id, hold_order_id = null, hold_expires_at = null
       where s.event_id = v_order.event_id and s.id = any(v_order.seat_ids)
         and not s.blocked and s.sold_order_id is null
         and (s.hold_order_id is null or s.hold_order_id = p_order_id or s.hold_expires_at <= now());
      get diagnostics v_taken = row_count;
      if v_taken <> cardinality(v_order.seat_ids) then
        raise exception 'seats of order % are taken', p_order_id using errcode = 'SH409';
      end if;

      -- The n-th ticket of a tier (as sent) gets the n-th seat of that tier (map order).
      insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name, seat_id)
      select t.ticket ->> 'ticketCode', p_order_id, v_order.event_id, t.ticket ->> 'ticketTypeId',
             t.ticket ->> 'ticketTypeName', k.id
        from (select x.ticket, row_number() over (partition by x.ticket ->> 'ticketTypeId' order by x.ord) as n
                from jsonb_array_elements(p_tickets) with ordinality as x (ticket, ord)) t
        left join (select s.id, s.ticket_type_id, row_number() over (partition by s.ticket_type_id order by s.position) as n
                     from public.event_seats s
                    where s.event_id = v_order.event_id and s.sold_order_id = p_order_id) k
          on k.ticket_type_id = t.ticket ->> 'ticketTypeId' and k.n = t.n;
    end if;

    update public.orders
    set status = 'paid',
        buyer_email = coalesce(p_buyer_email, buyer_email),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;

    -- The ticket email, committed with the payment: it can't be lost, and a
    -- redelivered webhook never reaches here (the order isn't pending).
    if coalesce(p_buyer_email, v_order.buyer_email) is not null then
      insert into private.email_outbox (kind, order_id) values ('ticket_email', p_order_id)
      on conflict (order_id, kind) do nothing;
    end if;
    return 'paid';
  exception when sqlstate 'SH409' then
    -- Everything in this block (partial reservations included) is rolled back.
    update public.orders
    set status = 'oversold_refund_required',
        buyer_email = coalesce(p_buyer_email, buyer_email),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;
    if v_order.seat_ids is not null then
      perform 1 from public.event_seats s
       where s.event_id = v_order.event_id and s.hold_order_id = p_order_id
       order by s.id
         for update;
      update public.event_seats s set hold_order_id = null, hold_expires_at = null
       where s.event_id = v_order.event_id and s.hold_order_id = p_order_id;
    end if;
    return 'oversold_refund_required';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

-- As in 20261020000000_payment_refunds.sql, plus: a full refund of a seated
-- order frees its seats (the tickets' seat first, then the seats' sale, in id
-- order), after the seat lock (taken before the order row).
create or replace function private.record_payment_refund(
  p_payment_intent_id text, p_amount_refunded_cents integer, p_fully_refunded boolean,
  out result text, out order_id text
)
language plpgsql
set search_path = ''
as $$
declare
  v_pre record;
  v_order public.orders;
  v_line jsonb;
begin
  if p_amount_refunded_cents is null or p_amount_refunded_cents < 0 or p_fully_refunded is null then
    raise exception 'invalid refund amount or flag' using errcode = '22023';
  end if;

  select o.event_id, o.seat_ids into v_pre from public.orders o
   where o.stripe_payment_intent_id = p_payment_intent_id
   order by o.id
   limit 1;
  if found and v_pre.seat_ids is not null then
    perform private.lock_event_seats(v_pre.event_id);
  end if;

  select * into v_order from public.orders o
   where o.stripe_payment_intent_id = p_payment_intent_id
   order by o.id
   limit 1
   for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  order_id := v_order.id;

  if v_order.status <> 'paid' then
    result := 'unchanged';
    return;
  end if;

  if p_fully_refunded then
    for v_line in
      select value from jsonb_array_elements(v_order.line_items) order by value ->> 'ticketTypeId'
    loop
      update public.ticket_types
         set quantity_sold = greatest(quantity_sold - (v_line ->> 'quantity')::integer, 0)
       where event_id = v_order.event_id
         and id = v_line ->> 'ticketTypeId';
    end loop;

    if v_order.seat_ids is not null then
      update public.tickets t set seat_id = null where t.order_id = v_order.id and t.seat_id is not null;
      perform 1 from public.event_seats s
       where s.event_id = v_order.event_id and s.sold_order_id = v_order.id
       order by s.id
         for update;
      update public.event_seats s set sold_order_id = null
       where s.event_id = v_order.event_id and s.sold_order_id = v_order.id;
    end if;

    update public.orders
       set status = 'refunded',
           amount_refunded_cents = greatest(amount_refunded_cents, p_amount_refunded_cents)
     where id = v_order.id;
    result := 'refunded';
    return;
  end if;

  if p_amount_refunded_cents <= v_order.amount_refunded_cents then
    result := 'unchanged';
    return;
  end if;
  update public.orders set amount_refunded_cents = p_amount_refunded_cents where id = v_order.id;
  result := 'partial';
end;
$$;

-- ---------------------------------------------------------------------------
-- Free seated orders
-- ---------------------------------------------------------------------------

-- private.place_free_order (20261014000100_free_order_protection.sql) for a
-- seated order: the event's seat lock first, then the same steps with the
-- order's seats recorded, so fulfil_order takes them. Returns 'paid',
-- 'person_event_limit', 'member_daily_limit', 'seats_unavailable' (a seat
-- is gone: nothing written) or 'sold_out'.
create function private.place_free_seated_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_user_id uuid, p_tickets jsonb,
  p_person_limit integer, p_daily_limit integer, p_daily_window interval, p_seat_ids text[]
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_key text := private.email_key(p_buyer_email);
  v_quantity integer := jsonb_array_length(p_tickets);
begin
  if p_seat_ids is null or cardinality(p_seat_ids) = 0 then
    raise exception 'seats required' using errcode = '22023';
  end if;
  perform private.lock_event_seats(p_event_id);
  if private.lock_free_allowance(p_event_id, v_key) + v_quantity > p_person_limit then
    perform private.record_free_order_refusal('person_event_limit');
    return 'person_event_limit';
  end if;

  begin
    if not private.take_rate_limit(p_user_id, 'free_claims', p_daily_limit, p_daily_window) then
      raise exception 'daily free claims' using errcode = 'SH429';
    end if;
    insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
       buyer_fee_cents, total_cents, application_fee_cents, buyer_email, buyer_email_key, tracking_code, seat_ids)
    values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, 0, 0, 0, 0,
       p_buyer_email, v_key,
       (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
       p_seat_ids);
    if private.fulfil_order(p_order_id, null, null, p_tickets) is distinct from 'paid' then
      raise exception 'sold out' using errcode = 'SH409';
    end if;
  exception
    when sqlstate 'SH429' then
      perform private.record_free_order_refusal('member_daily_limit');
      return 'member_daily_limit';
    when sqlstate 'SH409' then
      if cardinality(private.unavailable_seats(p_event_id, p_seat_ids, p_order_id)) > 0 then
        return 'seats_unavailable';
      end if;
      return 'sold_out';
  end;
  return 'paid';
end;
$$;

-- private.request_free_order (15 arguments, 20261017000000_free_order_caps.sql),
-- then the order's seats recorded on it, in one step. Nothing is held: the
-- seats are only taken if they're still free when the link is confirmed.
create function private.request_free_seated_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_token_hash text, p_ttl interval,
  p_address_limit integer, p_address_window interval, p_platform_limit integer, p_platform_window interval,
  p_platform_daily_limit integer, p_platform_daily_window interval, p_seat_ids text[]
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_result text;
begin
  if p_seat_ids is null or cardinality(p_seat_ids) = 0 then
    raise exception 'seats required' using errcode = '22023';
  end if;
  v_result := private.request_free_order(
    p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items,
    p_buyer_email, p_tracking_code, p_token_hash, p_ttl,
    p_address_limit, p_address_window, p_platform_limit, p_platform_window,
    p_platform_daily_limit, p_platform_daily_window);
  if v_result = 'requested' then
    update public.orders set seat_ids = p_seat_ids where id = p_order_id;
  end if;
  return v_result;
end;
$$;

-- As in 20261017000000_free_order_caps.sql, plus: a seated order takes the
-- event's seat lock before the order row, and when its seats have gone to
-- someone else since the link was sent the result is 'seats_taken' (the
-- order is marked failed, nothing issued) instead of 'sold_out'.
create or replace function private.confirm_free_order(
  p_token_hash text, p_tickets jsonb, p_person_limit integer,
  out result text, out confirmed_order_id text)
language plpgsql
set search_path = ''
as $$
declare
  v_pre record;
  v_order public.orders;
begin
  select o.event_id, o.seat_ids into v_pre from public.orders o where o.confirmation_token_hash = p_token_hash;
  if found and v_pre.seat_ids is not null then
    perform private.lock_event_seats(v_pre.event_id);
  end if;

  select * into v_order from public.orders o where o.confirmation_token_hash = p_token_hash for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  if v_order.confirmation_expires_at <= now() then
    result := case when v_order.status = 'paid' then 'expired_confirmed' else 'expired' end;
    return;
  end if;
  if v_order.status = 'paid' then
    result := 'already_confirmed';
    confirmed_order_id := v_order.id;
    return;
  end if;
  if v_order.status <> 'pending' then
    result := 'unavailable';
    return;
  end if;

  if private.lock_free_allowance(v_order.event_id, v_order.buyer_email_key) + jsonb_array_length(p_tickets)
       > p_person_limit then
    update public.orders set status = 'failed' where id = v_order.id;
    perform private.record_free_order_refusal('person_event_limit');
    result := 'person_event_limit';
    return;
  end if;

  perform 1 from public.events e where e.id = v_order.event_id for share;
  if exists (
    select 1
      from jsonb_array_elements(v_order.line_items) li
      left join public.ticket_types t on t.event_id = v_order.event_id and t.id = li.value ->> 'ticketTypeId'
     where t.id is null or t.price_cents <> 0
  ) then
    update public.orders set status = 'failed' where id = v_order.id;
    result := 'no_longer_free';
    return;
  end if;

  if private.fulfil_order(v_order.id, null, null, p_tickets) is distinct from 'paid' then
    -- Nothing was charged, so there's nothing to refund.
    update public.orders set status = 'failed' where id = v_order.id;
    result := case when v_order.seat_ids is not null
                        and cardinality(private.unavailable_seats(v_order.event_id, v_order.seat_ids, v_order.id)) > 0
                   then 'seats_taken' else 'sold_out' end;
    return;
  end if;
  result := 'confirmed';
  confirmed_order_id := v_order.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check-in: the ticket's seat
-- ---------------------------------------------------------------------------

drop function private.check_in_ticket(uuid, uuid, uuid, text, uuid, integer, interval);

-- As in 20261021130000_check_in_followups.sql, plus the ticket's seat
-- (seat_section, seat_row, seat_label, seat_kind; null for a ticket without
-- one), whenever the ticket is described (every result but invalid).
create function private.check_in_ticket(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_code text, p_request_id uuid,
  p_limit integer, p_window interval,
  out result text, out check_in_id uuid, out admission_id uuid, out ticket_type_name text, out ticket_number integer,
  out ticket_count integer, out code_last4 text, out first_checked_in_at timestamptz, out other_event_title text,
  out seat_section text, out seat_row text, out seat_label text, out seat_kind text
)
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
  v_order_id text;
  v_ticket_event uuid;
  v_ticket_organiser uuid;
  v_status public.order_status;
  v_checked_in_at timestamptz;
  v_log record;
  v_seen record;
begin
  if p_event_id is null or p_organiser_id is null or p_actor_id is null or p_request_id is null then
    raise exception 'missing argument' using errcode = '22023';
  end if;

  -- 1. The organiser's own event.
  perform 1 from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id for key share;
  if not found then
    result := 'not_found';
    return;
  end if;

  -- 2. The caller's allowance. Over it: nothing logged.
  if not private.take_rate_limit(p_actor_id, 'check_in', p_limit, p_window) then
    result := 'rate_limited';
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ticket_check_in:' || p_event_id::text || ':' || p_request_id::text, 0));

  -- 3. Only a well-formed code of one of this organiser's tickets goes any
  --    further. Unknown and someone else's are the same: no code.
  if p_code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' then
    select t.code, t.order_id, t.event_id, e.organiser_id
      into v_code, v_order_id, v_ticket_event, v_ticket_organiser
      from public.tickets t
      join public.events e on e.id = t.event_id
     where t.code = p_code;
    if v_ticket_organiser is distinct from p_organiser_id then
      v_code := null;
      v_order_id := null;
      v_ticket_event := null;
    end if;
  end if;

  -- 4. A retried request gets its original result back, if it's for the same code.
  select c.id, c.public_id, c.result, c.ticket_code, c.created_at into v_log
    from public.ticket_check_ins c
   where c.event_id = p_event_id and c.request_id = p_request_id;

  if found then
    if v_log.ticket_code is distinct from v_code then
      result := 'conflict';
      return;
    end if;
    result := v_log.result;
    check_in_id := v_log.public_id;
    if v_log.result = 'admitted' then
      first_checked_in_at := v_log.created_at;
      admission_id := v_log.public_id;
    elsif v_log.result = 'already_checked_in' then
      select c.id, c.public_id, c.created_at into v_seen
        from public.ticket_check_ins c
       where c.ticket_code = v_log.ticket_code and c.result = 'admitted' and c.id < v_log.id
       order by c.id desc
       limit 1;
      if found then
        first_checked_in_at := v_seen.created_at;
        if exists (select 1 from public.tickets t where t.code = v_log.ticket_code and t.checked_in_at is not null)
           and not exists (select 1 from public.ticket_check_ins c
                            where c.ticket_code = v_log.ticket_code and c.result = 'admitted' and c.id > v_seen.id) then
          admission_id := v_seen.public_id;
        end if;
      end if;
    end if;
  else
    if v_code is null then
      result := 'invalid';
    elsif v_ticket_event <> p_event_id then
      result := 'other_event';
    else
      select o.status into v_status from public.orders o where o.id = v_order_id for share;
      select t.checked_in_at into v_checked_in_at from public.tickets t where t.code = v_code for update;

      if v_status is distinct from 'paid' then
        result := 'not_admissible';
      elsif v_checked_in_at is not null then
        result := 'already_checked_in';
        first_checked_in_at := v_checked_in_at;
        select c.public_id into admission_id
          from public.ticket_check_ins c
         where c.ticket_code = v_code and c.result = 'admitted'
         order by c.id desc
         limit 1;
      else
        update public.tickets set checked_in_at = now() where code = v_code;
        result := 'admitted';
        first_checked_in_at := now();
      end if;
    end if;

    insert into public.ticket_check_ins (event_id, ticket_code, actor_user_id, request_id, result)
    values (p_event_id, v_code, p_actor_id, p_request_id, result)
    returning public_id into check_in_id;
    if result = 'admitted' then
      admission_id := check_in_id;
    end if;
  end if;

  if v_code is null then
    return;
  end if;

  select x.ticket_type_name, x.n, x.total, right(x.code, 4)
    into ticket_type_name, ticket_number, ticket_count, code_last4
    from (select t.code, t.ticket_type_name,
                 (row_number() over (order by t.ticket_type_id, t.code))::integer as n,
                 (count(*) over ())::integer as total
            from public.tickets t
           where t.order_id = (select t2.order_id from public.tickets t2 where t2.code = v_code)) x
   where x.code = v_code;

  -- The seat, so the door can say where to go.
  select s.section_label, s.row_label, s.seat_label, s.kind
    into seat_section, seat_row, seat_label, seat_kind
    from public.tickets t
    join public.event_seats s on s.event_id = t.event_id and s.id = t.seat_id
   where t.code = v_code;

  if result = 'other_event' then
    select e.title into other_event_title
      from public.tickets t join public.events e on e.id = t.event_id
     where t.code = v_code;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.unavailable_seats(uuid, text[], text) from public, anon, authenticated;
revoke all on function private.order_seats_match(uuid, jsonb, text[]) from public, anon, authenticated;
revoke all on function private.hold_seats(text, uuid, uuid, text, jsonb, integer, integer, integer, integer, text, text,
  integer, text[], interval, integer, interval, integer, numeric) from public, anon, authenticated;
revoke all on function private.release_seat_holds(text) from public, anon, authenticated;
revoke all on function private.fulfil_order(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.record_payment_refund(text, integer, boolean) from public, anon, authenticated;
revoke all on function private.place_free_seated_order(text, uuid, uuid, text, jsonb, text, text, uuid, jsonb, integer,
  integer, interval, text[]) from public, anon, authenticated;
revoke all on function private.request_free_seated_order(text, uuid, uuid, text, jsonb, text, text, text, interval, integer,
  interval, integer, interval, integer, interval, text[]) from public, anon, authenticated;
revoke all on function private.confirm_free_order(text, jsonb, integer) from public, anon, authenticated;
revoke all on function private.check_in_ticket(uuid, uuid, uuid, text, uuid, integer, interval) from public, anon, authenticated;
