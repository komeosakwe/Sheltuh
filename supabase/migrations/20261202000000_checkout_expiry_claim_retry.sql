-- The checkout pay deadline's sweeper (20261123000000_checkout_pay_deadline.sql;
-- docs/architecture.md "Checkout pay deadline"): a claim that loses a race
-- to another claim's commit retries instead of answering "nothing overdue".
--
-- The race (READ COMMITTED, Postgres's default and the app's). A claim's
-- pick runs on a snapshot taken when its statement starts. If another claim
-- leases an order, and commits, after that snapshot but before this claim's
-- scan reaches the order, then: the order row is no longer locked, so `skip
-- locked` doesn't skip it; the other claim's checkout_expiry_checks row is
-- invisible to the snapshot, so the pick's `not exists` lets it through; and
-- the insert's `on conflict ... do update ... where` then checks the row's
-- latest (committed) version, finds a live lease and claims nothing. The
-- order is never returned twice (that's what the `where` is for), but the
-- claim returned no rows at all, and a sweeper worker
-- (lib/server/handlers/checkout-expiry.ts) reads an empty claim as "nothing
-- overdue" and stops the run, so other overdue checkouts waited for the next
-- cron run (2 minutes) instead of the run working "until nothing is
-- overdue".
--
-- Now private.claim_overdue_checkouts (same signature, same answer) counts
-- what its pick chose against what it claimed. When some picked order was
-- lost that way and fewer than p_limit are claimed, it picks again for the
-- rest in a new statement: a fresh snapshot, which sees the lease that beat
-- it, so it moves on to the next overdue order. At most 5 retries: each
-- lost order means another transaction changed its check row in the
-- meantime: another claim leased it, or a late finish_checkout_expiry
-- rescheduled or closed it (the pick's
-- filter and the insert's `where` are the same condition, and now() is
-- fixed for the transaction, so with no concurrent commit a pick never
-- loses), so the retries end; past 5 the claim answers what it has, and the
-- orders it lost are with the claims that won them. The lost orders' row
-- locks are held to the end of the claim's transaction (as before: one
-- statement, auto-committed by the app), which still never waits for an
-- order row (`skip locked`).
--
-- Everything else is copied from 20261123000000 unchanged: the arguments'
-- checks, the cleanup of up to 100 rows whose order has left pending (once
-- per call, before the first pick), the pick (filter, order, `for no key
-- update of o skip locked`), the insert and its `on conflict ... where`, and
-- the columns returned. The only change to the pick's statement is its
-- final select, which now left-joins the claimed rows to the picked ones (a
-- picked order with no claimed row is a lost race) and limits each retry to
-- what's still wanted. Lock order as before: order rows (never waited for),
-- then check rows. search_path pinned, not security definer, execute
-- revoked from PUBLIC, anon and authenticated (`create or replace` keeps
-- the grants; the revoke is repeated to be explicit).
--
-- No new table, column, index or grant. The previous app version calls the
-- function the same way and gets the same columns, so this can be applied
-- before or after the app. Reversible, not destructive: re-run the function
-- from 20261123000000_checkout_pay_deadline.sql (`create or replace` with
-- its body).

create or replace function private.claim_overdue_checkouts(p_pay_window interval, p_limit integer, p_lease interval)
returns table (claimed_order_id text, claimed_session_id text, claimed_lease_token uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_row record;
  -- This call's claims so far, and this round's picks and claims.
  v_claimed integer := 0;
  v_round_picked integer;
  v_round_claimed integer;
  -- Rounds after the first: only when a picked order was lost to another claim's commit.
  v_retries integer := 0;
  c_max_retries constant integer := 5;
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

  loop
    v_round_picked := 0;
    v_round_claimed := 0;

    -- One statement per round: under READ COMMITTED each round has a fresh snapshot.
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
       limit p_limit - v_claimed
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
    -- A picked order with no claimed row: another claim leased it after this round's snapshot.
    select p.id as order_id, p.stripe_checkout_session_id, cl.lease_token
      from picked p left join claimed cl on cl.order_id = p.id
    loop
      v_round_picked := v_round_picked + 1;
      continue when v_row.lease_token is null;
      v_round_claimed := v_round_claimed + 1;
      claimed_order_id := v_row.order_id;
      claimed_session_id := v_row.stripe_checkout_session_id;
      claimed_lease_token := v_row.lease_token;
      return next;
    end loop;

    v_claimed := v_claimed + v_round_claimed;
    -- Done: nothing lost this round (the pick found all it could), the limit reached, or out of retries.
    exit when v_round_claimed = v_round_picked or v_claimed >= p_limit or v_retries >= c_max_retries;
    v_retries := v_retries + 1;
  end loop;
end;
$$;

revoke all on function private.claim_overdue_checkouts(interval, integer, interval) from public, anon, authenticated;
