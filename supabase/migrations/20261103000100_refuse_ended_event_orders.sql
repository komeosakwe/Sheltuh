-- No new orders or seat holds for an event that has ended (docs/architecture.md,
-- "Payment flow", "Free tickets" and "Reserved seating").
--
-- "Ended" is the same everywhere: ends_at <= now() (events.ends_at is
-- not null; the waitlist, Who's Going, trending and follows use it too).
--
--   * orders_not_ended: a trigger refusing any new order for an ended event
--     (check_violation, constraint orders_not_ended: the API's 409 "This
--     event has ended."). Every way an order or hold is made inserts into
--     public.orders, so this covers them all, whoever the caller: the paid
--     general admission checkout (the API's own insert), private.hold_seats
--     (a paid seated checkout's order and holds), private.place_free_order,
--     private.place_free_seated_order, private.request_free_order (both
--     forms) and private.request_free_seated_order. It share-locks the event
--     row, the same lock orders_sheltuh_only takes on the same row next
--     (triggers fire in name order), so no new lock is added to any path, and
--     an edit of ends_at racing an order is decided one way or the other. A
--     refusal raises, so the whole call is undone, including any rate-limit
--     hit taken before the insert. Orders already made are untouched.
--   * private.confirm_free_order: as in 20261101000100_seat_holds.sql, plus
--     'ended' (the order is marked failed, nothing issued) when a guest's
--     link is confirmed after the event ended. The event is read before the
--     allowance (so 'ended' wins over the other refusals), and checked again
--     under the event's share lock that was already taken there, so the lock
--     order (seat lock, order, (event, person), event) is unchanged. A link
--     already confirmed stays 'already_confirmed'.
--
-- private.fulfil_order is NOT changed: a paid order's checkout session was
-- created before the end, and a payment Stripe confirms after it is still
-- honoured (the buyer has been charged). Only new orders and holds are
-- refused. Waitlist offers need nothing: private.notify_waitlist already
-- emails nobody for an ended event, and joining or confirming refuse it.
--
-- Access model as everywhere else: every function pins its search_path and
-- has execute revoked from PUBLIC, anon and authenticated.
--
-- Reversible: drop trigger orders_not_ended on public.orders and function
-- private.orders_not_ended(); restore private.confirm_free_order from
-- 20261101000100_seat_holds.sql. No table, column or data changes.

-- ---------------------------------------------------------------------------
-- Every new order: not for an ended event
-- ---------------------------------------------------------------------------

create function private.orders_not_ended() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ends_at timestamptz;
begin
  select e.ends_at into v_ends_at from public.events e where e.id = new.event_id for share;
  if v_ends_at <= now() then
    raise exception 'This event has ended.'
      using errcode = 'check_violation', constraint = 'orders_not_ended';
  end if;
  return new;
end;
$$;

create trigger orders_not_ended before insert on public.orders
  for each row execute function private.orders_not_ended();

-- ---------------------------------------------------------------------------
-- A guest's free order: not confirmed after the event ended
-- ---------------------------------------------------------------------------

-- As in 20261101000100_seat_holds.sql, plus 'ended': the event ended before
-- the link was confirmed (the order is marked failed, nothing issued).
-- Returns (result, confirmed_order_id): 'confirmed', 'already_confirmed',
-- 'expired_confirmed', 'not_found', 'expired', 'unavailable', 'ended',
-- 'person_event_limit', 'no_longer_free', 'seats_taken' or 'sold_out'.
create or replace function private.confirm_free_order(
  p_token_hash text, p_tickets jsonb, p_person_limit integer,
  out result text, out confirmed_order_id text)
language plpgsql
set search_path = ''
as $$
declare
  v_pre record;
  v_order public.orders;
  v_ends_at timestamptz;
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

  -- A plain read, so this refusal comes first; checked again under the event's share lock below.
  if exists (select 1 from public.events e where e.id = v_order.event_id and e.ends_at <= now()) then
    update public.orders set status = 'failed' where id = v_order.id;
    result := 'ended';
    return;
  end if;

  if private.lock_free_allowance(v_order.event_id, v_order.buyer_email_key) + jsonb_array_length(p_tickets)
       > p_person_limit then
    update public.orders set status = 'failed' where id = v_order.id;
    perform private.record_free_order_refusal('person_event_limit');
    result := 'person_event_limit';
    return;
  end if;

  select e.ends_at into v_ends_at from public.events e where e.id = v_order.event_id for share;
  if v_ends_at <= now() then
    update public.orders set status = 'failed' where id = v_order.id;
    result := 'ended';
    return;
  end if;
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
-- Grants (create or replace keeps them; restated so this file stands alone)
-- ---------------------------------------------------------------------------

-- Triggers don't need the caller to hold execute on their function.
revoke all on function private.orders_not_ended() from public, anon, authenticated;
revoke all on function private.confirm_free_order(text, jsonb, integer) from public, anon, authenticated;
