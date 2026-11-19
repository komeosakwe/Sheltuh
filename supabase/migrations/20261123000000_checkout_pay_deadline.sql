-- A card checkout's 15-minute pay deadline (owner request "Checkout screen
-- needs to timeout", 15 minutes; docs/architecture.md "Checkout pay deadline").
--
-- The deadline itself needs no column: it's the order's created_at plus the
-- API's window (CHECKOUT_PAY_MINUTES in lib/api/types.ts, passed in as
-- p_pay_window), the same for general admission and seated orders. Stripe's
-- own Checkout Session keeps Stripe's minimum (30 minutes and a little more)
-- as an outer bound. This file adds what the sweeper (GET
-- /api/cron/checkout-expiry, lib/server/handlers/checkout-expiry.ts) needs to
-- close overdue checkouts safely, from any number of runs at once:
--
--   * private.checkout_expiry_checks: one row per overdue pending order the
--     sweeper has looked at. A lease (lease_token, lease_expires_at) while one
--     run is asking Stripe to expire its session, so two runs never work on
--     the same order; `next_check_at` for when it may be looked at again
--     (null: never, its Stripe session is complete and the webhook settles
--     it; later after a Stripe error, backing off from 2 minutes to an hour);
--     `attempts` (errors so far) and `last_outcome`. A row is deleted once
--     its order is released, and swept by the claim once its order is no
--     longer pending, so the table only ever holds overdue pending orders.
--     Cascades with its order.
--   * private.claim_overdue_checkouts(p_pay_window, p_limit, p_lease):
--     leases up to p_limit pending card checkouts (not a guest's free
--     booking: no confirmation token, a total above 0) made at least
--     p_pay_window ago, oldest first, that no live lease, `never` or later
--     `next_check_at` holds back. The order rows are locked `for no key
--     update ... skip locked`, so a webhook fulfilling or failing an order
--     at that moment is skipped (not waited on), and two claimers never pick
--     the same order; the insert's `on conflict ... where` re-checks the
--     lease on the row's latest version, so an order a concurrent claimer
--     leased just before is never returned twice. Returns each order's id,
--     its Stripe session id (null for an order a failed checkout kept with
--     no session: nothing to expire) and the lease token. First it deletes
--     up to 100 rows whose order has left `pending` (skip locked).
--   * private.finish_checkout_expiry(p_order_id, p_lease_token, p_outcome):
--     records what Stripe said, in one transaction.
--       'expired'   the session can't be paid any more (Stripe expired it,
--                   now or before; or there was none): the order is released
--                   through private.release_checkout_order, the same atomic
--                   path a failed checkout attempt takes (failed, a seated
--                   order's holds cleared), and the row deleted. Done
--                   whoever holds the lease: Stripe has closed the session,
--                   so releasing is right and idempotent. Returns
--                   release_checkout_order's answer ('released', or the
--                   order's status when it wasn't pending: 'paid', ...).
--       'complete'  Stripe already has the payment (the session is
--                   complete): never touched again (next_check_at null).
--       'error'     Stripe couldn't be asked, or refused: looked at again
--                   after 2, 4, 8, 16, 32 minutes, then hourly.
--     'complete' and 'error' need the lease: 'recorded', or 'lost' when
--     another run has the row now (nothing changes).
--   * orders_pending_card_created_idx on public.orders (created_at) where
--     status = 'pending' and confirmation_token_hash is null: the claim's
--     filter and sort. Pending orders are a small share of all orders (a
--     checkout lasts 15 minutes; paid, failed and refunded orders are kept),
--     so the partial index stays small, and each run's claim walks it from
--     the oldest overdue order instead of scanning every order.
--
-- Paid, processing and settled orders are never touched: only `pending`
-- orders are claimed; Stripe is asked to expire the session before anything
-- is released, and a session Stripe reports complete is left to the webhook.
-- A payment Stripe still takes for an order this released (a form that was
-- mid-payment as the session expired) reaches the webhook's existing
-- "paid for an order that already failed" path: refunded in full, nothing
-- issued, no seat taken (lib/server/handlers/orders.ts,
-- refundPaymentForFailedOrder).
--
-- Lock order: the claim locks order rows (skip locked: it never waits for
-- one) and then check rows; the finish takes release_checkout_order's locks
-- (a seated order: the event's seat advisory lock, then the order; general
-- admission: the order) and then the check row. Nothing locks a check row
-- before an order row, and nothing else locks check rows, so there's no
-- cycle with fulfil_order, release_seat_holds or the checkout attempts.
--
-- Access model as everywhere else: RLS on with no policies, nothing granted
-- to anon or authenticated; both functions pin search_path, aren't security
-- definer, and have execute revoked from PUBLIC, anon and authenticated.
--
-- Additive and reversible: drop the two functions, the index and table
-- private.checkout_expiry_checks (it holds only lease bookkeeping for
-- overdue pending orders: nothing worth keeping). The previous app version
-- never touches any of them.

create table private.checkout_expiry_checks (
  order_id text primary key references public.orders (id) on delete cascade,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  -- Null: never again (the session is complete; the webhook settles the order).
  next_check_at timestamptz,
  last_outcome text check (last_outcome in ('complete', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_expiry_checks_lease check ((lease_token is null) = (lease_expires_at is null))
);

alter table private.checkout_expiry_checks enable row level security;
revoke all on private.checkout_expiry_checks from public, anon, authenticated;

create index orders_pending_card_created_idx on public.orders (created_at)
  where status = 'pending' and confirmation_token_hash is null;

create function private.claim_overdue_checkouts(p_pay_window interval, p_limit integer, p_lease interval)
returns table (claimed_order_id text, claimed_session_id text, claimed_lease_token uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_row record;
begin
  if p_pay_window is null or p_pay_window <= interval '0' or p_limit is null or p_limit < 1
     or p_lease is null or p_lease <= interval '0' then
    raise exception 'claim_overdue_checkouts: invalid arguments' using errcode = '22023';
  end if;

  -- Rows whose order has left pending (paid, failed, refunded: settled by the webhook or a release) are done.
  delete from private.checkout_expiry_checks c
   where c.order_id in (
     select s.order_id
       from private.checkout_expiry_checks s
       join public.orders o on o.id = s.order_id
      where o.status <> 'pending'
      limit 100
        for update of s skip locked);

  for v_row in
  with picked as (
    select o.id, o.stripe_checkout_session_id
      from public.orders o
     where o.status = 'pending'
       and o.confirmation_token_hash is null
       and o.total_cents > 0
       and o.created_at <= now() - p_pay_window
       and not exists (
         select 1 from private.checkout_expiry_checks c
          where c.order_id = o.id
            and (c.lease_expires_at > now() or c.next_check_at is null or c.next_check_at > now()))
     order by o.created_at, o.id
     limit p_limit
       for no key update of o skip locked
  ), claimed as (
    insert into private.checkout_expiry_checks as c (order_id, lease_token, lease_expires_at, next_check_at)
    select p.id, gen_random_uuid(), now() + p_lease, now() from picked p
    on conflict (order_id) do update
       set lease_token = excluded.lease_token, lease_expires_at = excluded.lease_expires_at, updated_at = now()
     where (c.lease_expires_at is null or c.lease_expires_at <= now())
       and c.next_check_at is not null and c.next_check_at <= now()
    returning c.order_id, c.lease_token
  )
  select cl.order_id, p.stripe_checkout_session_id, cl.lease_token
    from claimed cl join picked p on p.id = cl.order_id
  loop
    claimed_order_id := v_row.order_id;
    claimed_session_id := v_row.stripe_checkout_session_id;
    claimed_lease_token := v_row.lease_token;
    return next;
  end loop;
end;
$$;

create function private.finish_checkout_expiry(p_order_id text, p_lease_token uuid, p_outcome text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_result text;
begin
  if p_order_id is null or p_outcome is null or p_outcome not in ('expired', 'complete', 'error')
     or (p_outcome <> 'expired' and p_lease_token is null) then
    raise exception 'finish_checkout_expiry: invalid arguments' using errcode = '22023';
  end if;

  if p_outcome = 'expired' then
    -- The order's locks first (release_checkout_order), then the check row: the claim's order.
    v_result := private.release_checkout_order(p_order_id);
    delete from private.checkout_expiry_checks c where c.order_id = p_order_id;
    return v_result;
  end if;

  update private.checkout_expiry_checks c
     set lease_token = null, lease_expires_at = null, last_outcome = p_outcome, updated_at = now(),
         attempts = case when p_outcome = 'error' then c.attempts + 1 else c.attempts end,
         next_check_at = case
           when p_outcome = 'complete' then null
           else now() + least(interval '1 hour', interval '2 minutes' * power(2, least(c.attempts, 10))::integer)
         end
   where c.order_id = p_order_id and c.lease_token = p_lease_token;
  return case when found then 'recorded' else 'lost' end;
end;
$$;

revoke all on function private.claim_overdue_checkouts(interval, integer, interval) from public, anon, authenticated;
revoke all on function private.finish_checkout_expiry(text, uuid, text) from public, anon, authenticated;
