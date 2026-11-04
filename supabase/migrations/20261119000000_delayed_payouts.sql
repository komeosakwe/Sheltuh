-- Delayed payouts: organisers are paid about 2 days after their event ends
-- (owner decision; docs/architecture.md, "Delayed payouts").
--
-- Today every paid checkout is a Stripe destination charge: the organiser's
-- share moves to their connected account the moment the buyer pays. This adds
-- the other way, "separate charges and transfers": the platform keeps the whole
-- charge, and one Stripe transfer per paid order is sent by a job once
-- events.ends_at + 48 hours has passed (lib/server/order-transfers.ts, called
-- by GET /api/cron/payouts). Economics are unchanged: the platform still pays
-- Stripe's processing fee, and the transfer is total_cents - support_cents -
-- application_fee_cents, the very columns a destination charge's
-- application_fee_amount was made from (lib/fees.ts is untouched). Support
-- Sheltuh and the booking fee never leave the platform.
--
-- Sorts after 20261117000000_ticket_release_lock.sql. Needs
-- 20261109000200_payment_reconciliation.sql (private.payment_exceptions,
-- private.raise_payment_exception, private.lock_payment_intent) and
-- 20261109000300_email_outbox_health.sql (private.cron_runs).
--
-- What this adds:
--
--   * public.orders.payout_method ('destination' | 'transfer', default
--     'destination'). Every existing order, and every order made while the app's
--     DELAYED_PAYOUTS switch is off, stays 'destination' and is NEVER
--     transferred by this feature (the money already went with the charge). It
--     can only change while the order is pending (orders_payout_method_frozen):
--     the app sets 'transfer' just before it creates the Stripe session, and
--     nothing can flip a paid order either way.
--   * private.order_transfers: one row per order that is (or was) transferred,
--     order_id unique, so an order is transferred at most once whatever runs
--     twice. amount_cents is a snapshot (a trigger checks it equals the order's
--     total - support - application fee and refuses a row for an order that
--     isn't a paid 'transfer' order, and forbids changing it later). Statuses:
--     sending (leased to a worker), retry (waiting for next_attempt_at), sent
--     (stripe_transfer_id recorded, unique), held (a person decides: partial
--     refund, dispute, rejected by the account), failed (five attempts used),
--     cancelled (refunded in full, or an admin's cancel). key_version is part of
--     the Stripe idempotency key; it only goes up after Stripe definitely
--     rejected a request. A row an admin cancelled can still end up with a
--     transfer in Stripe (a worker whose request Stripe accepted after the
--     cancel): it stays cancelled but records the transfer id and sent_at
--     ("cancelled but paid") and opens a transfer_reversal_required exception,
--     because the organiser may be paid twice (by it and by hand).
--   * private.due_transfer_orders(p_delay): the one definition of "due": paid,
--     payout_method 'transfer', nothing refunded (not even in part), event still
--     published and ended at least p_delay ago, organiser approved with payouts
--     enabled, a positive share.
--   * private.claim_due_transfers: leases due transfers (lazily creating the row
--     for a newly due order) with `skip locked`, like claim_email_jobs.
--   * private.finish_order_transfer: records an outcome. Lease-checked, except
--     that 'sent' is always recorded (a transfer exists in Stripe whoever holds
--     the lease) and, under the order's lock, re-checks the order: refunded
--     meanwhile means a transfer_reversal_required exception, and so does a
--     transfer that lands on a row an admin cancelled.
--   * private.begin_transfer_create: the worker's last step before it asks Stripe
--     to create the transfer. Under the order's lock it re-checks the order and
--     the lease and sets order_transfers.create_started, which never goes back:
--     it is the proof that a create request may have reached Stripe.
--   * private.flag_transfer_after_refund: called after a refund is recorded.
--     A row whose create can't have reached Stripe (create_started false) is
--     cancelled (full refund) or held (partial). A row whose create may have
--     reached Stripe (the response was lost, the worker died) is never
--     cancelled: the organiser may hold the money, so it is held and a
--     transfer_reversal_required exception (reason refunded_outcome_unknown) asks
--     an admin to check Stripe (the admin cancel asks Stripe first). A sent row
--     opens the same kind of exception (Stripe never claws a transfer back by
--     itself): an owner action, docs/supabase-setup.md.
--   * private.admin_transfer_action: an admin's retry / release / cancel, with
--     the expected current status guarded (a lost race is a 409). The app asks
--     Stripe for an existing transfer before it cancels
--     (lib/server/handlers/payouts.ts) and adopts one it finds.
--   * Two payment exception kinds, transfer_failed and
--     transfer_reversal_required (payment_exceptions_kind_check and
--     raise_payment_exception, as 20261110000150 did for amount_mismatch), and
--     'payouts' as a cron_runs name.
--
-- Lock order (always): the payment intent's advisory lock, then the order row,
-- then the transfer row. claim_due_transfers takes queued transfer rows
-- (`skip locked`) and, to make the row of a newly due order, one advisory lock
-- that serialises such claimers, then that order's row (`skip locked`), then
-- the new transfer row.
--
-- Indexes (new filters and sorts): orders_transfer_paid_idx, a partial index
-- on (event_id) for the paid 'transfer' orders only (empty until the switch is
-- on), which the claim and the payouts reports read; order_transfers_due_idx
-- (retry rows by next_attempt_at) and order_transfers_leased_idx (sending rows
-- by lease) for the claim, both partial and small; order_transfers_status_idx
-- (status, created_at desc, id desc) for the admin list. The claim finds newly
-- due orders from the events side (ended, published) and anti-joins to
-- order_transfers.order_id (its unique key); every ended event's orders get a
-- row once, so that scan grows with the number of published events, which is
-- small for years at launch volumes.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated; every function pins search_path = '', is not security
-- definer, and has execute revoked from PUBLIC, anon and authenticated.
--
-- Additive: no existing row changes (new column with a default; checks widened).
-- The previous app version keeps working against this file: it never reads the
-- new column or table, and creates 'destination' orders.
--
-- Reversible: deploy the previous app; resolve or delete exceptions of the two
-- new kinds; drop the functions, triggers and private.order_transfers (that
-- discards the transfer history: export it first if any 'transfer' order was
-- paid); restore cron_runs' name check and payment_exceptions_kind_check;
-- recreate raise_payment_exception from 20261110000150_support_in_exceptions.sql
-- with its revoke; drop the column public.orders.payout_method (destructive if
-- any order is 'transfer': money was held for it; reverse those first).

-- ---------------------------------------------------------------------------
-- How an order's organiser share is paid
-- ---------------------------------------------------------------------------

alter table public.orders
  add column payout_method text not null default 'destination'
    constraint orders_payout_method_check check (payout_method in ('destination', 'transfer'));

-- Paid 'transfer' orders by event: what the claim, the admin totals and the
-- organiser's payouts report read. Partial: empty while DELAYED_PAYOUTS is off.
create index orders_transfer_paid_idx on public.orders (event_id)
  where payout_method = 'transfer' and status = 'paid';

-- The method is chosen once, while the order is pending (before any Stripe
-- session exists); after that it can't change, so a destination order (already
-- paid out by Stripe) can never become a transferable one, or the reverse. The
-- order must also still be pending afterwards, so one UPDATE that sets the
-- status (paid) together with the method can't slip through either.
create function private.orders_payout_method_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' or new.status <> 'pending' then
    raise exception 'orders.payout_method of a non-pending order cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger orders_payout_method_frozen before update of payout_method on public.orders
  for each row when (old.payout_method is distinct from new.payout_method)
  execute function private.orders_payout_method_frozen();

-- ---------------------------------------------------------------------------
-- Payment exception kinds and cron run names
-- ---------------------------------------------------------------------------

alter table private.payment_exceptions
  drop constraint payment_exceptions_kind_check,
  add constraint payment_exceptions_kind_check
    check (kind in ('refund_not_completed', 'partial_refund', 'manual_refund_required', 'amount_mismatch',
                    'transfer_failed', 'transfer_reversal_required'));

alter table private.cron_runs
  drop constraint cron_runs_name_check,
  add constraint cron_runs_name_check check (name in ('email_outbox', 'payouts'));

-- ---------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------

create table private.order_transfers (
  id bigint generated always as identity primary key,
  -- Restrict: an order with a transfer is a financial record and is never deleted.
  order_id text not null references public.orders (id) on delete restrict,
  -- The organiser's account when the row was made; a retry only goes there.
  destination_account_id text not null check (char_length(destination_account_id) between 1 and 255),
  -- What the organiser is sent: total - support - application fee, fixed when the row is made.
  amount_cents integer not null check (amount_cents > 0),
  status text not null
    constraint order_transfers_status_check check (status in ('sending', 'retry', 'sent', 'held', 'failed', 'cancelled')),
  -- Attempts made, counted when a worker takes the row.
  attempts integer not null default 0 check (attempts >= 0),
  -- Part of the Stripe idempotency key (order-transfer-<order>-<key_version>).
  key_version integer not null default 1 check (key_version >= 1),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  stripe_transfer_id text check (char_length(stripe_transfer_id) between 1 and 255),
  -- A short machine code (lower case and underscores), never a Stripe message.
  last_error text check (char_length(last_error) <= 100),
  -- A create request may have reached Stripe: set by begin_transfer_create just before the worker calls Stripe,
  -- and never cleared (a lost response, a timeout or a dead worker leave no other trace). False proves that
  -- Stripe was never asked, so a row refunded in full can be cancelled; true means "ask Stripe first".
  create_started boolean not null default false,
  -- Set with stripe_transfer_id. A cancelled row has both only when a transfer reached Stripe after an
  -- admin cancelled it (finish_order_transfer): the organiser has been paid, so it is not "never sent".
  sent_at timestamptz,
  last_admin_action text check (last_admin_action in ('retry', 'release', 'cancel')),
  last_admin_id uuid references auth.users (id) on delete set null,
  last_admin_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_transfers_order_key unique (order_id),
  constraint order_transfers_stripe_transfer_key unique (stripe_transfer_id),
  constraint order_transfers_lease_only_while_sending
    check ((status = 'sending') = (lease_token is not null and lease_expires_at is not null)),
  constraint order_transfers_sent_state
    check ((stripe_transfer_id is null) = (sent_at is null)
           and (status <> 'sent' or stripe_transfer_id is not null)
           and (stripe_transfer_id is null or status in ('sent', 'cancelled')))
);

create index order_transfers_due_idx on private.order_transfers (next_attempt_at, id) where status = 'retry';
create index order_transfers_leased_idx on private.order_transfers (lease_expires_at) where status = 'sending';
create index order_transfers_status_idx on private.order_transfers (status, created_at desc, id desc);

create trigger order_transfers_set_updated_at before update on private.order_transfers
  for each row execute function public.set_updated_at();

alter table private.order_transfers enable row level security;
revoke all on private.order_transfers from public, anon, authenticated;

-- A transfer exists only for a paid 'transfer' order, for exactly its share,
-- and its order and amount never change. Even a bug in the claim can't make a
-- row for a destination order (whose money Stripe already moved) or for the
-- wrong amount.
create function private.order_transfers_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if tg_op = 'UPDATE' then
    if new.order_id is distinct from old.order_id or new.amount_cents is distinct from old.amount_cents
       or new.destination_account_id is distinct from old.destination_account_id then
      raise exception 'order_transfers: the order, amount and destination cannot change' using errcode = '23514';
    end if;
    return new;
  end if;
  select * into v_order from public.orders o where o.id = new.order_id;
  if not found or v_order.payout_method <> 'transfer' or v_order.status <> 'paid' then
    raise exception 'order_transfers: % is not a paid transfer order', new.order_id using errcode = '23514';
  end if;
  if new.amount_cents <> v_order.total_cents - v_order.support_cents - v_order.application_fee_cents then
    raise exception 'order_transfers: the amount is not the order''s share' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger order_transfers_guard before insert or update on private.order_transfers
  for each row execute function private.order_transfers_guard();

-- ---------------------------------------------------------------------------
-- Exceptions (the two new kinds)
-- ---------------------------------------------------------------------------

-- As in 20261110000150_support_in_exceptions.sql, plus the transfer_failed and
-- transfer_reversal_required kinds (keyed on their order, as partial_refund).
create or replace function private.raise_payment_exception(
  p_kind text, p_order_id text, p_payment_intent_id text, p_refund_id text,
  p_event_id text, p_event_created timestamptz, p_details jsonb,
  out exception_id uuid, out outcome text, out alert_queued boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_ex private.payment_exceptions;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
begin
  alert_queued := false;
  if p_kind is null or p_kind not in ('refund_not_completed', 'partial_refund', 'manual_refund_required', 'amount_mismatch',
                          'transfer_failed', 'transfer_reversal_required')
     or (p_kind = 'refund_not_completed') <> (p_refund_id is not null)
     or (p_refund_id is null and p_order_id is null)
     or jsonb_typeof(v_details) <> 'object' then
    raise exception 'raise_payment_exception: invalid arguments' using errcode = '22023';
  end if;

  if p_refund_id is not null then
    insert into private.payment_exceptions as e
      (kind, order_id, payment_intent_id, refund_id, stripe_event_id, last_event_at, details)
    values (p_kind, p_order_id, p_payment_intent_id, p_refund_id, p_event_id, p_event_created, v_details)
    on conflict (kind, refund_id) where refund_id is not null do nothing
    returning e.id into exception_id;
    if exception_id is not null then
      outcome := 'opened';
    else
      select * into v_ex from private.payment_exceptions e
       where e.kind = p_kind and e.refund_id = p_refund_id
         for update;
      exception_id := v_ex.id;
      if p_event_created < v_ex.last_event_at then
        outcome := 'stale';
        return;
      end if;
      if v_ex.status = 'open' then
        update private.payment_exceptions e
           set details = e.details || v_details,
               stripe_event_id = coalesce(p_event_id, e.stripe_event_id),
               last_event_at = greatest(e.last_event_at, p_event_created),
               order_id = coalesce(e.order_id, p_order_id),
               payment_intent_id = coalesce(e.payment_intent_id, p_payment_intent_id)
         where e.id = v_ex.id;
        outcome := 'updated';
        return;
      elsif v_ex.resolution = 'auto' then
        update private.payment_exceptions e
           set status = 'open', resolution = null, resolved_at = null, resolved_by = null, resolution_note = null,
               opened_at = now(),
               details = e.details || v_details,
               stripe_event_id = coalesce(p_event_id, e.stripe_event_id),
               last_event_at = greatest(e.last_event_at, p_event_created),
               order_id = coalesce(e.order_id, p_order_id),
               payment_intent_id = coalesce(e.payment_intent_id, p_payment_intent_id)
         where e.id = v_ex.id;
        outcome := 'reopened';
      else
        outcome := 'unchanged';
        return;
      end if;
    end if;
  else
    select * into v_ex from private.payment_exceptions e
     where e.kind = p_kind and e.order_id = p_order_id and e.status = 'open' and e.refund_id is null
       for update;
    if not found then
      insert into private.payment_exceptions as e
        (kind, order_id, payment_intent_id, stripe_event_id, last_event_at, details)
      values (p_kind, p_order_id, p_payment_intent_id, p_event_id, p_event_created, v_details)
      on conflict do nothing
      returning e.id into exception_id;
      if exception_id is not null then
        outcome := 'opened';
      else
        -- Opened by a concurrent call since the read above.
        select * into v_ex from private.payment_exceptions e
         where e.kind = p_kind and e.order_id = p_order_id and e.status = 'open' and e.refund_id is null
           for update;
      end if;
    end if;
    if outcome is null then
      exception_id := v_ex.id;
      update private.payment_exceptions e
         set details = e.details || v_details,
             stripe_event_id = coalesce(p_event_id, e.stripe_event_id),
             last_event_at = greatest(e.last_event_at, p_event_created),
             payment_intent_id = coalesce(e.payment_intent_id, p_payment_intent_id)
       where e.id = v_ex.id;
      outcome := 'updated';
      return;
    end if;
  end if;

  -- 'opened' or 'reopened': an alert, within the platform's daily cap.
  if private.take_platform_rate_limit('ops_alerts', 20, interval '24 hours') then
    insert into private.email_outbox (kind, payment_exception_id) values ('ops_alert', exception_id)
    on conflict do nothing;
    alert_queued := found;
    update private.payment_exceptions e set alerted_at = now() where e.id = exception_id;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- What is due
-- ---------------------------------------------------------------------------

-- The orders whose organiser share may be sent now: paid, 'transfer', nothing
-- refunded (a partial refund holds it for a person: nothing is inferred from an
-- amount, as in 20261111000300_refund_no_inference.sql), the event still
-- published (an unpublished or rejected one is held) and ended at least
-- p_delay ago, the organiser approved with payouts on, and a positive share
-- (an organiser-absorbs ticket of A$1 leaves 46c; a fee larger than the price
-- would leave nothing to send). destination_account_id is the organiser's
-- account now. Stable, plain SQL: the claim reads it twice.
create function private.due_transfer_orders(p_delay interval)
returns table (
  order_id text, event_id uuid, event_ends_at timestamptz, destination_account_id text,
  payment_intent_id text, total_cents integer, amount_cents integer)
language sql
stable
set search_path = ''
as $$
  select o.id, o.event_id, e.ends_at, g.stripe_account_id, o.stripe_payment_intent_id, o.total_cents,
         o.total_cents - o.support_cents - o.application_fee_cents
    from public.events e
    join public.orders o on o.event_id = e.id
    join public.organisers g on g.id = o.organiser_id
   where e.status = 'published' and e.ends_at <= now() - p_delay
     and o.payout_method = 'transfer' and o.status = 'paid' and o.amount_refunded_cents = 0
     and o.stripe_payment_intent_id is not null
     and o.total_cents - o.support_cents - o.application_fee_cents > 0
     and g.status = 'approved' and g.payouts_enabled and g.stripe_account_id is not null;
$$;

-- ---------------------------------------------------------------------------
-- Workers
-- ---------------------------------------------------------------------------

-- Leases up to p_limit due transfers for p_lease, counting an attempt on each:
-- first the ones already queued (retry and past next_attempt_at, or sending and
-- past lease_expires_at: its worker died), then a row made on the spot for
-- each newly due order (already leased, attempt 1). A queued row is claimed
-- only while its order is still due (so a refund, an unpublished event or an
-- organiser whose payouts went off stops it) and its destination is still the
-- organiser's account. A lease that expired on the last allowed attempt
-- (p_max_attempts) ends as failed with a transfer_failed exception: that attempt
-- may have made the transfer, so a person checks Stripe before retrying (the
-- worker also looks for an existing transfer before it creates one). `skip
-- locked` and the unique order_id: concurrent workers never take the same row,
-- and never make two rows for one order.
create function private.claim_due_transfers(
  p_limit integer, p_lease interval, p_max_attempts integer, p_delay interval default interval '48 hours'
) returns table (
  transfer_id bigint, transfer_order_id text, transfer_lease_token uuid, transfer_attempts integer,
  transfer_amount_cents integer, transfer_key_version integer, transfer_destination text,
  transfer_payment_intent_id text, transfer_event_id uuid, transfer_total_cents integer)
language plpgsql
set search_path = ''
as $$
declare
  v_left integer := p_limit;
  v_row record;
  v_raised record;
begin
  if p_limit is null or p_limit < 1 or p_lease is null or p_max_attempts is null or p_max_attempts < 1
     or p_delay is null then
    raise exception 'claim_due_transfers: invalid arguments' using errcode = '22023';
  end if;

  for v_row in
    update private.order_transfers t
       set status = 'failed', lease_token = null, lease_expires_at = null, last_error = 'last_attempt_unfinished'
     where t.status = 'sending' and t.lease_expires_at <= now() and t.attempts >= p_max_attempts
    returning t.order_id, t.amount_cents
  loop
    select * into v_raised from private.raise_payment_exception(
      'transfer_failed', v_row.order_id,
      (select o.stripe_payment_intent_id from public.orders o where o.id = v_row.order_id), null, null, null,
      jsonb_build_object('reason', 'last_attempt_unfinished', 'transferAmountCents', v_row.amount_cents));
  end loop;

  for v_row in
    with picked as (
      select t.id
        from private.order_transfers t
        join private.due_transfer_orders(p_delay) d
          on d.order_id = t.order_id and d.destination_account_id = t.destination_account_id
       where (t.status = 'retry' and t.next_attempt_at <= now())
          or (t.status = 'sending' and t.lease_expires_at <= now())
       order by t.next_attempt_at, t.id
       limit v_left
         for update of t skip locked
    ), claimed as (
      update private.order_transfers t
         set status = 'sending', lease_token = gen_random_uuid(), lease_expires_at = now() + p_lease,
             attempts = t.attempts + 1
        from picked
       where t.id = picked.id
      returning t.id, t.order_id, t.lease_token, t.attempts, t.amount_cents, t.key_version, t.destination_account_id
    )
    select c.*, o.stripe_payment_intent_id as payment_intent_id, o.event_id, o.total_cents
      from claimed c join public.orders o on o.id = c.order_id
  loop
    transfer_id := v_row.id; transfer_order_id := v_row.order_id; transfer_lease_token := v_row.lease_token;
    transfer_attempts := v_row.attempts; transfer_amount_cents := v_row.amount_cents;
    transfer_key_version := v_row.key_version; transfer_destination := v_row.destination_account_id;
    transfer_payment_intent_id := v_row.payment_intent_id; transfer_event_id := v_row.event_id;
    transfer_total_cents := v_row.total_cents;
    v_left := v_left - 1;
    return next;
  end loop;

  if v_left > 0 then
    -- New rows are made one claimer at a time: each statement below then sees the rows the previous claimer
    -- committed, so two workers never pick the same order (the unique key would make one of them come away
    -- empty-handed while work remains). Held for this function's transaction only.
    perform pg_advisory_xact_lock(hashtextextended('claim_due_transfers', 0));
    for v_row in
      with picked as (
        -- The order rows are locked (skipping any a refund holds), and the basic conditions re-checked on
        -- their latest version: a refund that committed first excludes the order, and one that comes next
        -- waits until this row exists, so flag_transfer_after_refund then finds it.
        select o.id as order_id
          from public.orders o
          join public.events e on e.id = o.event_id
         where o.payout_method = 'transfer' and o.status = 'paid' and o.amount_refunded_cents = 0
           and o.id in (select d.order_id from private.due_transfer_orders(p_delay) d)
           and not exists (select 1 from private.order_transfers t where t.order_id = o.id)
         order by e.ends_at, o.id
         limit v_left
           for update of o skip locked
      ), due as (
        select d.*
          from private.due_transfer_orders(p_delay) d
          join picked on picked.order_id = d.order_id
      ), made as (
        insert into private.order_transfers
          (order_id, destination_account_id, amount_cents, status, attempts, key_version, lease_token, lease_expires_at)
        select d.order_id, d.destination_account_id, d.amount_cents, 'sending', 1, 1, gen_random_uuid(), now() + p_lease
          from due d
        on conflict (order_id) do nothing
        returning id, order_id, lease_token, attempts, amount_cents, key_version, destination_account_id
      )
      select m.*, d.payment_intent_id, d.event_id, d.total_cents
        from made m join due d on d.order_id = m.order_id
    loop
      transfer_id := v_row.id; transfer_order_id := v_row.order_id; transfer_lease_token := v_row.lease_token;
      transfer_attempts := v_row.attempts; transfer_amount_cents := v_row.amount_cents;
      transfer_key_version := v_row.key_version; transfer_destination := v_row.destination_account_id;
      transfer_payment_intent_id := v_row.payment_intent_id; transfer_event_id := v_row.event_id;
      transfer_total_cents := v_row.total_cents;
      return next;
    end loop;
  end if;
end;
$$;

-- Records a leased transfer's outcome. p_outcome:
--   'sent'   the transfer exists in Stripe (p_stripe_transfer_id): always
--            recorded, whoever holds the lease (a transfer is a fact). Under the
--            order's lock the order is checked again: refunded since (in full
--            or in part) opens a transfer_reversal_required exception, and an
--            open transfer_failed exception is resolved. A row already sent with
--            another transfer id is a duplicate: 'duplicate', and the same
--            exception kind. On a row an admin cancelled, the row stays
--            cancelled but records the transfer ('cancelled_paid') and a
--            transfer_reversal_required exception (reason transfer_after_cancel)
--            asks the owner to reverse the transfer or the payment made by hand.
--   'retry'  failed, try again after p_retry_in (default 1 hour); p_bump_key
--            moves the idempotency key on (Stripe definitely rejected this one);
--            p_alert opens a transfer_failed exception (and its ops alert).
--   'held'   a person decides (reason in p_error).
--   'failed' out of attempts: a transfer_failed exception.
-- The three non-sent outcomes need the worker still to hold the lease
-- ('lease_lost' otherwise, nothing changed). result is the outcome, or
-- 'lease_lost' / 'duplicate' / 'cancelled_paid' / 'not_found'. alert_queued: an ops alert was queued.
create function private.finish_order_transfer(
  p_id bigint, p_lease_token uuid, p_outcome text, p_error text, p_retry_in interval,
  p_stripe_transfer_id text, p_bump_key boolean, p_alert boolean,
  out result text, out alert_queued boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_order_id text;
  v_pre record;
  v_order public.orders;
  v_t private.order_transfers;
  v_raised record;
begin
  alert_queued := false;
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'held', 'failed')
     or (p_outcome = 'sent') <> (p_stripe_transfer_id is not null) then
    raise exception 'finish_order_transfer: invalid arguments' using errcode = '22023';
  end if;

  select t.order_id into v_order_id from private.order_transfers t where t.id = p_id;
  if not found then
    result := 'not_found';
    return;
  end if;
  -- payment intent, then order, then transfer (never changes once set, so safe to read first)
  select o.stripe_payment_intent_id into v_pre from public.orders o where o.id = v_order_id;
  if v_pre.stripe_payment_intent_id is not null then
    perform private.lock_payment_intent(v_pre.stripe_payment_intent_id);
  end if;
  select * into v_order from public.orders o where o.id = v_order_id for share;
  select * into v_t from private.order_transfers t where t.id = p_id for update;

  if p_outcome = 'sent' then
    if v_t.status = 'cancelled' and v_t.last_error = 'cancelled_by_admin' then
      -- An admin cancelled the row (so they would pay the organiser by hand), yet a transfer exists in Stripe: a
      -- worker's request that Stripe accepted after the cancel. The row stays cancelled (the admin's decision is
      -- on record) but keeps the transfer, and the owner is told to reverse it (or the hand payment).
      if v_t.stripe_transfer_id is null then
        update private.order_transfers t
           set stripe_transfer_id = p_stripe_transfer_id, sent_at = now()
         where t.id = p_id;
        select * into v_raised from private.raise_payment_exception(
          'transfer_reversal_required', v_order_id, v_order.stripe_payment_intent_id, null, null, null,
          jsonb_build_object('reason', 'transfer_after_cancel', 'transferAmountCents', v_t.amount_cents,
                             'totalCents', v_order.total_cents, 'orderStatus', v_order.status::text));
        alert_queued := v_raised.alert_queued;
        result := 'cancelled_paid';
      elsif v_t.stripe_transfer_id = p_stripe_transfer_id then
        result := 'cancelled_paid';
      else
        select * into v_raised from private.raise_payment_exception(
          'transfer_reversal_required', v_order_id, v_order.stripe_payment_intent_id, null, null, null,
          jsonb_build_object('reason', 'duplicate_transfer', 'transferAmountCents', v_t.amount_cents,
                             'totalCents', v_order.total_cents, 'orderStatus', v_order.status::text));
        alert_queued := v_raised.alert_queued;
        result := 'duplicate';
      end if;
      return;
    end if;
    if v_t.status = 'sent' then
      if v_t.stripe_transfer_id = p_stripe_transfer_id then
        result := 'sent';
      else
        select * into v_raised from private.raise_payment_exception(
          'transfer_reversal_required', v_order_id, v_order.stripe_payment_intent_id, null, null, null,
          jsonb_build_object('reason', 'duplicate_transfer', 'transferAmountCents', v_t.amount_cents,
                             'totalCents', v_order.total_cents, 'orderStatus', v_order.status::text));
        alert_queued := v_raised.alert_queued;
        result := 'duplicate';
      end if;
      return;
    end if;
    update private.order_transfers t
       set status = 'sent', stripe_transfer_id = p_stripe_transfer_id, sent_at = now(),
           lease_token = null, lease_expires_at = null, last_error = null
     where t.id = p_id;
    if v_order.status <> 'paid' or v_order.amount_refunded_cents > 0 then
      select * into v_raised from private.raise_payment_exception(
        'transfer_reversal_required', v_order_id, v_order.stripe_payment_intent_id, null, null, null,
        jsonb_build_object('reason', 'refunded_after_transfer', 'transferAmountCents', v_t.amount_cents,
                           'amountRefundedCents', v_order.amount_refunded_cents, 'totalCents', v_order.total_cents,
                           'orderStatus', v_order.status::text));
      alert_queued := v_raised.alert_queued;
    end if;
    update private.payment_exceptions e
       set status = 'resolved', resolution = 'auto', resolved_at = now(), resolution_note = 'The transfer was sent.'
     where e.kind = 'transfer_failed' and e.order_id = v_order_id and e.status = 'open' and e.refund_id is null;
    result := 'sent';
    return;
  end if;

  if v_t.status <> 'sending' or v_t.lease_token is distinct from p_lease_token then
    result := 'lease_lost';
    return;
  end if;

  if p_outcome = 'retry' then
    update private.order_transfers t
       set status = 'retry', next_attempt_at = now() + coalesce(p_retry_in, interval '1 hour'),
           key_version = t.key_version + case when coalesce(p_bump_key, false) then 1 else 0 end,
           lease_token = null, lease_expires_at = null, last_error = left(p_error, 100)
     where t.id = p_id;
  elsif p_outcome = 'held' then
    update private.order_transfers t
       set status = 'held', lease_token = null, lease_expires_at = null, last_error = left(p_error, 100)
     where t.id = p_id;
  else
    update private.order_transfers t
       set status = 'failed', lease_token = null, lease_expires_at = null, last_error = left(p_error, 100)
     where t.id = p_id;
  end if;
  if p_outcome = 'failed' or (p_outcome = 'retry' and coalesce(p_alert, false)) then
    select * into v_raised from private.raise_payment_exception(
      'transfer_failed', v_order_id, v_order.stripe_payment_intent_id, null, null, null,
      jsonb_strip_nulls(jsonb_build_object('reason', left(p_error, 40), 'transferAmountCents', v_t.amount_cents,
                                           'totalCents', v_order.total_cents, 'orderStatus', v_order.status::text)));
    alert_queued := v_raised.alert_queued;
  end if;
  result := p_outcome;
end;
$$;

-- The worker's last step before it asks Stripe to create the transfer: under
-- the payment intent's lock and the order's lock (the order in the same lock
-- order as a refund's record and flag_transfer_after_refund), it checks the
-- order is still paid and not refunded, even in part, and the row still leased
-- to this worker and not past its lease, and only then sets create_started.
-- Because create_started is set here, in the same transaction as the check, a
-- refund either is seen here (nothing is created) or finds create_started true
-- (flag_transfer_after_refund then knows a create may have reached Stripe).
-- result: 'ok' (go ahead), 'order_not_found', 'refunded' (not paid, or refunded
-- in part or in full), 'lease_lost' (not this worker's row any more),
-- 'lapsed' (its lease has run out: another worker may take it any moment), or
-- 'not_found'. Anything but 'ok' changes nothing.
create function private.begin_transfer_create(p_id bigint, p_lease_token uuid, out result text)
language plpgsql
set search_path = ''
as $$
declare
  v_order_id text;
  v_pre record;
  v_order public.orders;
  v_t private.order_transfers;
begin
  select t.order_id into v_order_id from private.order_transfers t where t.id = p_id;
  if not found then
    result := 'not_found';
    return;
  end if;
  select o.stripe_payment_intent_id into v_pre from public.orders o where o.id = v_order_id;
  if v_pre.stripe_payment_intent_id is not null then
    perform private.lock_payment_intent(v_pre.stripe_payment_intent_id);
  end if;
  select * into v_order from public.orders o where o.id = v_order_id for share;
  if not found then
    result := 'order_not_found';
    return;
  end if;
  select * into v_t from private.order_transfers t where t.id = p_id for update;
  if v_order.status <> 'paid' or v_order.amount_refunded_cents > 0 then
    result := 'refunded';
  elsif v_t.status <> 'sending' or v_t.lease_token is distinct from p_lease_token then
    result := 'lease_lost';
  elsif v_t.lease_expires_at <= now() then
    result := 'lapsed';
  else
    update private.order_transfers t set create_started = true where t.id = p_id;
    result := 'ok';
  end if;
end;
$$;

-- After a refund is recorded (charge.refunded, any delivery of it: this is
-- idempotent). Looks only at a 'transfer' order with a refund on record:
--   its transfer not sent yet (sending, retry, held or failed):
--     refunded in part: held (a person decides);
--     refunded in full and create_started is false (no create request can have
--       reached Stripe: begin_transfer_create is what sets it, before every
--       Stripe create, and it refuses a refunded order): cancelled;
--     refunded in full and create_started is true: NOT cancelled. A request may
--       have been accepted by Stripe whose response was lost (or its worker died
--       before recording it), so the organiser may hold the money, and a
--       cancelled row is skipped by the claim and by the admin's look at Stripe,
--       which would hide it for good. The row is held ('refunded_outcome_unknown';
--       a worker's late 'sent' is still recorded) and a transfer_reversal_required
--       exception (reason refunded_outcome_unknown, with an ops alert) tells an
--       admin to check Stripe: the admin cancel asks Stripe first, records a
--       transfer it finds as sent (and the same exception becomes
--       refunded_after_transfer: reverse it) and, when Stripe has none, cancels
--       the row and resolves the exception (admin_transfer_action);
--   its transfer sent (or one that reached Stripe after an admin cancelled the
--     row: cancelled but paid): Stripe never takes a transfer back by itself, so a
--     transfer_reversal_required exception (and an ops alert) asks the owner to
--     reverse it (docs/supabase-setup.md, "Reversing a transfer after a late refund");
--   cancelled already, or no row: nothing.
-- result: 'cancelled' | 'held' | 'unknown' (held, outcome unknown: exception
-- opened) | 'flagged' | 'unchanged' | 'none'.
create function private.flag_transfer_after_refund(
  p_payment_intent_id text, p_event_id text, out result text, out alert_queued boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
  v_t private.order_transfers;
  v_raised record;
  v_full boolean;
begin
  alert_queued := false;
  result := 'none';
  if p_payment_intent_id is null then
    return;
  end if;
  perform private.lock_payment_intent(p_payment_intent_id);
  select * into v_order from public.orders o
   where o.stripe_payment_intent_id = p_payment_intent_id and o.payout_method = 'transfer'
   order by o.id
   limit 1
     for share;
  if not found then
    return;
  end if;
  v_full := v_order.status = 'refunded';
  if not v_full and v_order.amount_refunded_cents = 0 then
    return;
  end if;
  select * into v_t from private.order_transfers t where t.order_id = v_order.id for update;
  if not found then
    return;
  end if;

  if v_t.status in ('sending', 'retry', 'held', 'failed') then
    if v_full and not v_t.create_started then
      update private.order_transfers t
         set status = 'cancelled', lease_token = null, lease_expires_at = null, last_error = 'refunded'
       where t.id = v_t.id;
      result := 'cancelled';
    elsif v_full then
      if v_t.status = 'held' and v_t.last_error = 'refunded_outcome_unknown' then
        result := 'unchanged';
      else
        update private.order_transfers t
           set status = 'held', lease_token = null, lease_expires_at = null, last_error = 'refunded_outcome_unknown'
         where t.id = v_t.id;
        select * into v_raised from private.raise_payment_exception(
          'transfer_reversal_required', v_order.id, p_payment_intent_id, null, p_event_id, null,
          jsonb_build_object('reason', 'refunded_outcome_unknown', 'transferAmountCents', v_t.amount_cents,
                             'amountRefundedCents', v_order.amount_refunded_cents, 'totalCents', v_order.total_cents,
                             'orderStatus', v_order.status::text));
        alert_queued := v_raised.alert_queued;
        result := 'unknown';
      end if;
    elsif v_t.status = 'held' and v_t.last_error in ('partly_refunded', 'refunded_outcome_unknown') then
      result := 'unchanged';
    else
      update private.order_transfers t
         set status = 'held', lease_token = null, lease_expires_at = null, last_error = 'partly_refunded'
       where t.id = v_t.id;
      result := 'held';
    end if;
  elsif v_t.status = 'sent' or (v_t.status = 'cancelled' and v_t.stripe_transfer_id is not null) then
    select * into v_raised from private.raise_payment_exception(
      'transfer_reversal_required', v_order.id, p_payment_intent_id, null, p_event_id, null,
      jsonb_build_object('reason', 'refunded_after_transfer', 'transferAmountCents', v_t.amount_cents,
                         'amountRefundedCents', v_order.amount_refunded_cents, 'totalCents', v_order.total_cents,
                         'orderStatus', v_order.status::text));
    alert_queued := v_raised.alert_queued;
    result := 'flagged';
  else
    result := 'unchanged';
  end if;
end;
$$;

-- An admin's action on one transfer (the expected current status is part of
-- the update, so two admins, or an admin and a worker, can't both win):
--   'retry'    failed or waiting for a retry: due now, with a fresh set of attempts
--   'release'  held: due now, with a fresh set of attempts
--   'cancel'   held, waiting or failed: never sent (the organiser is paid by hand).
--              Only after the app has asked Stripe whether a transfer already
--              exists (lib/server/handlers/payouts.ts adopts one it finds):
--              this function can't see Stripe, and a cancel that follows an
--              unknown outcome could otherwise lead to a second payment. A
--              transfer that appears after all ends as 'cancelled_paid'
--              (finish_order_transfer). A cancel also resolves the open
--              transfer_reversal_required exception of reason
--              refunded_outcome_unknown (a refund in full while the transfer's
--              outcome was unknown, flag_transfer_after_refund): Stripe was asked
--              and has no transfer, so nothing is left to reverse.
-- A retry or release is refused ('not_payable') when the order has been
-- refunded since: the claim wouldn't send it anyway. Other results:
-- 'ok', 'not_found', 'in_progress' (a worker has it), 'conflict' (not in a
-- status this action applies to). new_status is the transfer's status afterwards.
create function private.admin_transfer_action(
  p_id bigint, p_action text, p_admin_id uuid, out result text, out new_status text)
language plpgsql
set search_path = ''
as $$
declare
  v_order_id text;
  v_pre record;
  v_order public.orders;
  v_t private.order_transfers;
  v_status text;
begin
  if p_action is null or p_action not in ('retry', 'release', 'cancel') or p_admin_id is null then
    raise exception 'admin_transfer_action: invalid arguments' using errcode = '22023';
  end if;
  select t.order_id into v_order_id from private.order_transfers t where t.id = p_id;
  if not found then
    result := 'not_found';
    return;
  end if;
  select o.stripe_payment_intent_id into v_pre from public.orders o where o.id = v_order_id;
  if v_pre.stripe_payment_intent_id is not null then
    perform private.lock_payment_intent(v_pre.stripe_payment_intent_id);
  end if;
  select * into v_order from public.orders o where o.id = v_order_id for share;
  select * into v_t from private.order_transfers t where t.id = p_id for update;
  new_status := v_t.status;

  -- A worker holds it right now. One whose lease has lapsed (its worker died, and the order isn't due any
  -- more so nobody takes it over) counts as waiting for a retry.
  if v_t.status = 'sending' and v_t.lease_expires_at > now() then
    result := 'in_progress';
    return;
  end if;
  v_status := case when v_t.status = 'sending' then 'retry' else v_t.status end;
  if not (v_status = any (case p_action when 'retry' then array['failed', 'retry']
                                          when 'release' then array['held']
                                          else array['held', 'retry', 'failed'] end)) then
    result := 'conflict';
    return;
  end if;
  if p_action <> 'cancel' and (v_order.status <> 'paid' or v_order.amount_refunded_cents > 0) then
    result := 'not_payable';
    return;
  end if;

  if p_action = 'cancel' then
    update private.order_transfers t
       set status = 'cancelled', lease_token = null, lease_expires_at = null, last_error = 'cancelled_by_admin',
           last_admin_action = p_action, last_admin_id = p_admin_id, last_admin_at = now()
     where t.id = p_id;
    new_status := 'cancelled';
    -- The app asked Stripe before calling this, and it has no transfer for the order: the refunded-while-unknown
    -- exception (flag_transfer_after_refund) is answered.
    update private.payment_exceptions e
       set status = 'resolved', resolution = 'admin', resolved_at = now(), resolved_by = p_admin_id,
           resolution_note = 'Cancelled: Stripe has no transfer for the order.'
     where e.kind = 'transfer_reversal_required' and e.order_id = v_order_id and e.status = 'open'
       and e.refund_id is null and e.details ->> 'reason' = 'refunded_outcome_unknown';
  else
    update private.order_transfers t
       set status = 'retry', lease_token = null, lease_expires_at = null, attempts = 0, next_attempt_at = now(),
           last_error = null, last_admin_action = p_action, last_admin_id = p_admin_id, last_admin_at = now()
     where t.id = p_id;
    new_status := 'retry';
  end if;
  result := 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.raise_payment_exception(text, text, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function private.orders_payout_method_frozen() from public, anon, authenticated;
revoke all on function private.order_transfers_guard() from public, anon, authenticated;
revoke all on function private.due_transfer_orders(interval) from public, anon, authenticated;
revoke all on function private.claim_due_transfers(integer, interval, integer, interval) from public, anon, authenticated;
revoke all on function private.finish_order_transfer(bigint, uuid, text, text, interval, text, boolean, boolean)
  from public, anon, authenticated;
revoke all on function private.begin_transfer_create(bigint, uuid) from public, anon, authenticated;
revoke all on function private.flag_transfer_after_refund(text, text) from public, anon, authenticated;
revoke all on function private.admin_transfer_action(bigint, text, uuid) from public, anon, authenticated;
