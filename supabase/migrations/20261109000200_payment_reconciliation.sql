-- Payment reconciliation (payment audit plan, items 1 and 2, with the ops
-- alerts; docs/architecture.md "Refunds made in Stripe").
--
-- Written as 20261104000000_payment_reconciliation.sql on the payments audit
-- branch and renamed when it was merged, so it sorts after every migration
-- production may already have. It builds on the latest definitions before
-- it: the outbox's kinds and private.lease_outbox_jobs from
-- 20261107000000_admin_review_emails.sql, private.purge_operational_data from
-- 20261108000000_account_invites.sql, private.fulfil_order and
-- private.record_payment_refund from 20261101000100_seat_holds.sql (no later
-- file changes either).
--
-- 1. A charge.refunded that arrives before its order's payment is recorded.
--    Until now it found no order (fulfil_order is what stores the payment
--    intent) and was dropped, so the order became `paid` with valid tickets
--    although the money had gone back. Now:
--
--    * private.lock_payment_intent: a transaction-scoped advisory lock per
--      payment intent, taken first (and only) by private.fulfil_order (paid
--      orders: free paths pass no payment intent and never take it),
--      private.record_payment_refund and private.record_refund_status. Lock
--      order everywhere: payment intent, then the event's seat lock, then the
--      order row (then what each already locked after it). A refund and its
--      own order's fulfilment therefore serialise: whichever commits second
--      sees the first.
--    * private.early_charge_refunds: one row per payment intent for a
--      charge.refunded that found no order, kept only when the charge's
--      transfer destination is one of our organisers' Stripe accounts (any
--      other payment writes nothing). Cumulative amount (greatest) and full
--      flag (OR-ed), so redeliveries and out-of-order deliveries converge.
--    * private.record_payment_refund (new 6-argument form: charge id,
--      destination and Stripe event id added): as before when the order is
--      found, plus a `partial_refund` payment exception for a partial refund
--      (auto-resolved by a later full refund); with no order but our
--      destination, the early row and result 'deferred'; otherwise
--      'not_found'. The 3-argument form delegates to it with no destination
--      (so it never defers), for the previous app version during the deploy
--      window.
--    * private.fulfil_order (same signature): after the pending check, an
--      unapplied early row for its payment intent is applied. Full: the order
--      becomes `refunded` (amount, payment intent and email recorded, seat
--      holds cleared): no inventory, no tickets, no ticket email (owner
--      decision D1). Partial: fulfilled as normal, then the amount recorded
--      and a `partial_refund` exception opened (D2).
--
-- 2. Refund progress that needs a person: private.payment_exceptions.
--    `kind`: refund_not_completed (a refund Stripe reports failed, canceled or
--    requires_action: keyed on the refund id), partial_refund (one open per
--    order) and manual_refund_required (an automatic refund we couldn't even
--    ask for: one open per order). open → resolved (by an admin with a note,
--    or automatically: a later `succeeded` for the same refund, or a full
--    refund for a partial one). An automatically resolved refund exception
--    reopens if the refund later fails; one an admin resolved stays resolved.
--    Events older than the last one applied to an exception are ignored
--    (Stripe doesn't guarantee delivery order), and so is a refund event
--    older than the newest one already recorded for the same refund
--    (private.refund_status_marks: one row per refund of ours, its latest
--    status and Stripe event time). So a `succeeded` delivered before an
--    older `requires_action` or `failed` leaves nothing open: the old one is
--    'stale'. (The app also asks Stripe for the refund's current status
--    before reporting a failure; this mark is what holds when Stripe can't
--    be reached.) Nothing here ever restores
--    tickets or asks Stripe for a refund (D4): an admin re-refunds in the
--    Stripe dashboard and resolves the exception.
--    `details` holds amounts and statuses only (no buyer data).
--    private.record_refund_status records a refund.updated / refund.failed /
--    charge.refund.updated (and the refund our own refund call returns): our
--    automatic refund's settlement on an oversold order (as the app did
--    before), then the exception raised or resolved. The refund's
--    metadata.orderId is trusted only when that order's payment intent is
--    the refund's own (otherwise the order is found by payment intent, as
--    for a dashboard refund). A refund of a payment with no order on record
--    (and no early row) writes nothing.
--
-- 3. Ops alerts: a new outbox kind, `ops_alert`, keyed on
--    payment_exception_id, queued when an exception is opened or reopened,
--    at most 20 per 24-hour window platform-wide (platform_rate_limits bucket
--    'ops_alerts'); the exception exists either way. The app emails it to
--    OPS_ALERT_EMAIL (short order reference, amounts, statuses and the Stripe
--    event id only). private.lease_outbox_jobs (same signature, as in
--    20261107000000_admin_review_emails.sql otherwise) leaves ops_alert jobs
--    alone unless asked for that kind, so an app version that can't send
--    them, during the deploy window, never leases one.
--    private.claim_email_outbox (the release before that) already claims only
--    the ticket, waitlist and follower kinds: unchanged.
--
-- 4. private.fulfil_order_detailed: fulfil_order's body, also reporting
--    whether it queued an ops alert (an early partial refund applied), so
--    the webhook drains the alert outbox only then. private.fulfil_order
--    (same signature, used by the free paths too) returns its status.
--
-- Retention (private.purge_operational_data, drop and create, as in
-- 20261108000000_account_invites.sql plus three more counts): early refund
-- rows and refund status marks 35 days after their
-- last update (Stripe retries for 3 days, dashboard resends reach 30 days
-- back), resolved exceptions 2 years after resolution; open exceptions are
-- never deleted (D11).
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated; every new or redefined function pins its search_path and
-- has execute revoked from PUBLIC, anon and authenticated.
--
-- Indexes:
--   * early_charge_refunds_pkey (payment_intent_id): the only lookup.
--     early_charge_refunds_applied_order_idx (partial) serves the orders
--     foreign key. No index on updated_at: the table only holds real refunds
--     made before their payment was recorded (rare), so the daily purge's
--     scan is tiny.
--   * payment_exceptions_refund_key (kind, refund_id), unique where a refund
--     id is set: the refund events' lookup and their idempotency.
--     payment_exceptions_open_order_key (kind, order_id), unique where open
--     and keyed on the order: one open partial or manual exception per order.
--     payment_exceptions_open_idx (opened_at, id) where open: the admin
--     list's default. payment_exceptions_resolved_idx (resolved_at desc, id)
--     where resolved: the resolved list and the purge.
--     payment_exceptions_order_idx (order_id): the orders foreign key and a
--     partial refund's auto-resolution. payment_exceptions_unmatched_idx
--     (payment_intent_id) where no order yet: fulfil_order's backfill.
--   * refund_status_marks_pkey (refund_id): the only lookup. No index on
--     updated_at: one row per refund of ours that Stripe sent a status event
--     for (rare next to orders), so the daily purge's scan is tiny.
--   * email_outbox_ops_alert_active_key (payment_exception_id), unique while
--     pending or sending (one alert waiting per exception), and
--     email_outbox_payment_exception_idx for the cascade.
--
-- Reversible, not destructive of anything but this migration's own data:
-- restore private.fulfil_order (plpgsql) and private.record_payment_refund
-- (3 args) from 20261101000100_seat_holds.sql, private.lease_outbox_jobs
-- from 20261107000000_admin_review_emails.sql and
-- private.purge_operational_data (drop and create) from
-- 20261108000000_account_invites.sql; delete the ops_alert outbox
-- jobs, restore the outbox's kind checks from
-- 20261107000000_admin_review_emails.sql and drop its payment_exception_id
-- column; drop the new functions (the 6-argument record_payment_refund and
-- fulfil_order_detailed included) and the three tables. Dropping
-- payment_exceptions discards the exception history (export it first);
-- orders already voided by an early refund stay `refunded`.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table private.early_charge_refunds (
  payment_intent_id text primary key check (char_length(payment_intent_id) between 1 and 255),
  charge_id text check (char_length(charge_id) between 1 and 255),
  -- The charge's transfer destination: always one of our organisers' accounts when written.
  destination_account_id text not null check (char_length(destination_account_id) between 1 and 255),
  -- Stripe's cumulative amount_refunded (the greatest seen).
  amount_refunded_cents integer not null check (amount_refunded_cents >= 0),
  -- The charge's `refunded` flag (true once seen).
  fully_refunded boolean not null,
  last_event_id text check (char_length(last_event_id) between 1 and 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set by fulfil_order when it acts on the row (once).
  applied_at timestamptz,
  applied_order_id text references public.orders (id) on delete set null
);

create index early_charge_refunds_applied_order_idx on private.early_charge_refunds (applied_order_id)
  where applied_order_id is not null;

create trigger early_charge_refunds_set_updated_at before update on private.early_charge_refunds
  for each row execute function public.set_updated_at();

alter table private.early_charge_refunds enable row level security;
revoke all on private.early_charge_refunds from public, anon, authenticated;

create table private.payment_exceptions (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    constraint payment_exceptions_kind_check check (kind in ('refund_not_completed', 'partial_refund', 'manual_refund_required')),
  status text not null default 'open'
    constraint payment_exceptions_status_check check (status in ('open', 'resolved')),
  -- Null only while a refund problem's payment isn't matched to an order yet
  -- (an early refund), or once the order is deleted.
  order_id text references public.orders (id) on delete set null,
  payment_intent_id text check (char_length(payment_intent_id) between 1 and 255),
  refund_id text check (char_length(refund_id) between 1 and 255),
  -- The latest Stripe event applied, and when Stripe created it (ordering).
  stripe_event_id text check (char_length(stripe_event_id) between 1 and 255),
  last_event_at timestamptz,
  -- Amounts and statuses only: never an address, a name or a Stripe secret.
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  -- When an ops alert was last queued for it (null: none, e.g. over the daily cap).
  alerted_at timestamptz,
  -- When it was opened (or last reopened).
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution in ('auto', 'admin')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolution_note text check (char_length(resolution_note) between 1 and 500),
  constraint payment_exceptions_resolved_state_check check (
    (status = 'open' and resolved_at is null and resolution is null and resolved_by is null and resolution_note is null)
    or (status = 'resolved' and resolved_at is not null and resolution is not null and resolution_note is not null)),
  -- A refund problem is keyed on its refund; the others on their order.
  constraint payment_exceptions_key_check check (
    case kind when 'refund_not_completed' then refund_id is not null
              else refund_id is null end)
);

create unique index payment_exceptions_refund_key on private.payment_exceptions (kind, refund_id)
  where refund_id is not null;
create unique index payment_exceptions_open_order_key on private.payment_exceptions (kind, order_id)
  where status = 'open' and refund_id is null;
create index payment_exceptions_open_idx on private.payment_exceptions (opened_at, id) where status = 'open';
create index payment_exceptions_resolved_idx on private.payment_exceptions (resolved_at desc, id) where status = 'resolved';
create index payment_exceptions_order_idx on private.payment_exceptions (order_id) where order_id is not null;
create index payment_exceptions_unmatched_idx on private.payment_exceptions (payment_intent_id)
  where order_id is null and payment_intent_id is not null;

create trigger payment_exceptions_set_updated_at before update on private.payment_exceptions
  for each row execute function public.set_updated_at();

alter table private.payment_exceptions enable row level security;
revoke all on private.payment_exceptions from public, anon, authenticated;

-- The newest Stripe refund event applied per refund of ours (its status and
-- creation time): an older event for the same refund, delivered later, is
-- stale. Statuses only; written by record_refund_status for events (never
-- for our own refund call's answer, which has no event time).
create table private.refund_status_marks (
  refund_id text primary key check (char_length(refund_id) between 1 and 255),
  status text not null check (char_length(status) between 1 and 40),
  last_event_at timestamptz not null,
  stripe_event_id text check (char_length(stripe_event_id) between 1 and 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger refund_status_marks_set_updated_at before update on private.refund_status_marks
  for each row execute function public.set_updated_at();

alter table private.refund_status_marks enable row level security;
revoke all on private.refund_status_marks from public, anon, authenticated;

-- The outbox's sixth kind: an ops alert about one payment exception. The
-- kinds and keys as in 20261107000000_admin_review_emails.sql, plus this one.
alter table private.email_outbox
  add column payment_exception_id uuid references private.payment_exceptions (id) on delete cascade,
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (
    kind in ('ticket_email', 'waitlist_available', 'organiser_new_events', 'event_review', 'organiser_review',
             'ops_alert')),
  drop constraint email_outbox_kind_key,
  -- Each kind has exactly its own key.
  add constraint email_outbox_kind_key check (
    case kind
      when 'ticket_email' then order_id is not null and waitlist_entry_id is null and follow_id is null
                               and event_id is null and organiser_id is null and payment_exception_id is null
      when 'waitlist_available' then waitlist_entry_id is not null and order_id is null and follow_id is null
                                     and event_id is null and organiser_id is null and payment_exception_id is null
      when 'organiser_new_events' then follow_id is not null and order_id is null and waitlist_entry_id is null
                                       and event_id is null and organiser_id is null and payment_exception_id is null
      when 'event_review' then event_id is not null and order_id is null and waitlist_entry_id is null
                               and follow_id is null and organiser_id is null and payment_exception_id is null
      when 'organiser_review' then organiser_id is not null and order_id is null and waitlist_entry_id is null
                                   and follow_id is null and event_id is null and payment_exception_id is null
      else payment_exception_id is not null and order_id is null and waitlist_entry_id is null and follow_id is null
           and event_id is null and organiser_id is null end);

create unique index email_outbox_ops_alert_active_key on private.email_outbox (payment_exception_id)
  where status in ('pending', 'sending');
create index email_outbox_payment_exception_idx on private.email_outbox (payment_exception_id)
  where payment_exception_id is not null;

-- ---------------------------------------------------------------------------
-- Locks and exceptions
-- ---------------------------------------------------------------------------

-- Serialises everything that reads or writes a payment intent's refund and
-- fulfilment state. Always the first lock taken.
create function private.lock_payment_intent(p_payment_intent_id text) returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('payment_intent:' || p_payment_intent_id, 0));
$$;

-- Opens (or updates) a payment exception and queues its ops alert. Returns
-- the exception's id and the outcome:
--   'opened'    new; an alert is queued (within the daily cap)
--   'reopened'  a refund exception resolved automatically (its refund had
--               succeeded) and now failing again; an alert is queued
--   'updated'   already open: details merged, latest event recorded
--   'unchanged' resolved by an admin: left resolved
--   'stale'     the event is older than the last one applied: ignored
-- p_event_created is the Stripe event's creation time (null when the status
-- came from our own API call, not an event: never treated as stale, and it
-- doesn't move the ordering mark).
-- refund_not_completed is keyed on p_refund_id; the other kinds on
-- p_order_id (one open per order). p_details is merged into the stored
-- details (amounts and statuses only). The caller holds the locks that
-- order the exception (the payment intent, or the order row).
-- alert_queued: whether this call queued an ops alert (opened or reopened,
-- within the daily cap), so the caller knows to drain the outbox.
create function private.raise_payment_exception(
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
  if p_kind is null or p_kind not in ('refund_not_completed', 'partial_refund', 'manual_refund_required')
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

-- An admin closes an open exception with a note (1–500 characters).
-- Returns 'resolved', 'not_open' (already resolved: a second admin) or
-- 'not_found'.
create function private.resolve_payment_exception(p_exception_id uuid, p_admin_id uuid, p_note text) returns text
language plpgsql
set search_path = ''
as $$
begin
  if p_admin_id is null or p_note is null or char_length(p_note) not between 1 and 500 then
    raise exception 'resolve_payment_exception: a note of 1 to 500 characters is required' using errcode = '22023';
  end if;
  update private.payment_exceptions e
     set status = 'resolved', resolution = 'admin', resolved_at = now(), resolved_by = p_admin_id,
         resolution_note = p_note
   where e.id = p_exception_id and e.status = 'open';
  if found then
    return 'resolved';
  end if;
  perform 1 from private.payment_exceptions e where e.id = p_exception_id;
  return case when found then 'not_open' else 'not_found' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

-- charge.refunded (see the header). p_amount_refunded_cents is the charge's
-- cumulative amount_refunded, p_fully_refunded its `refunded` flag,
-- p_destination_account_id its transfer_data.destination. Returns:
--   'refunded'   a paid order fully refunded: now `refunded`, inventory
--                released, seats freed, an open partial-refund exception
--                resolved
--   'partial'    a paid order partly refunded: amount recorded, still `paid`,
--                a partial_refund exception opened (or updated)
--   'unchanged'  found, but nothing to do (not paid, or a redelivery)
--   'deferred'   no order has this payment intent yet, but the destination
--                is one of our organisers': recorded for fulfil_order
--   'not_found'  no order, and not one of our payments: nothing written
-- and the order's id when found.
create function private.record_payment_refund(
  p_payment_intent_id text, p_amount_refunded_cents integer, p_fully_refunded boolean,
  p_charge_id text, p_destination_account_id text, p_event_id text,
  out result text, out order_id text
)
language plpgsql
set search_path = ''
as $$
declare
  v_pre record;
  v_order public.orders;
  v_line jsonb;
  v_raised record;
begin
  if p_amount_refunded_cents is null or p_amount_refunded_cents < 0 or p_fully_refunded is null then
    raise exception 'invalid refund amount or flag' using errcode = '22023';
  end if;
  if p_payment_intent_id is null then
    result := 'not_found';
    return;
  end if;

  perform private.lock_payment_intent(p_payment_intent_id);

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
    -- Before its payment is recorded (fulfil_order stores the payment intent):
    -- kept for fulfil_order, but only for a payment to one of our organisers.
    if p_destination_account_id is not null
       and (p_fully_refunded or p_amount_refunded_cents > 0)
       and exists (select 1 from public.organisers g where g.stripe_account_id = p_destination_account_id) then
      insert into private.early_charge_refunds as r
        (payment_intent_id, charge_id, destination_account_id, amount_refunded_cents, fully_refunded, last_event_id)
      values (p_payment_intent_id, p_charge_id, p_destination_account_id, p_amount_refunded_cents, p_fully_refunded, p_event_id)
      on conflict (payment_intent_id) do update
         set amount_refunded_cents = greatest(r.amount_refunded_cents, excluded.amount_refunded_cents),
             fully_refunded = r.fully_refunded or excluded.fully_refunded,
             charge_id = coalesce(excluded.charge_id, r.charge_id),
             last_event_id = coalesce(excluded.last_event_id, r.last_event_id);
      result := 'deferred';
    else
      result := 'not_found';
    end if;
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

    -- The rest refunded: an open partial-refund exception has nothing left to decide.
    update private.payment_exceptions e
       set status = 'resolved', resolution = 'auto', resolved_at = now(),
           resolution_note = 'Refunded in full in Stripe: the order was voided.',
           stripe_event_id = coalesce(p_event_id, e.stripe_event_id),
           details = e.details || jsonb_build_object('amountRefundedCents', p_amount_refunded_cents, 'orderStatus', 'refunded')
     where e.kind = 'partial_refund' and e.order_id = v_order.id and e.status = 'open' and e.refund_id is null;
    result := 'refunded';
    return;
  end if;

  if p_amount_refunded_cents <= v_order.amount_refunded_cents then
    result := 'unchanged';
    return;
  end if;
  update public.orders set amount_refunded_cents = p_amount_refunded_cents where id = v_order.id;
  select * into v_raised from private.raise_payment_exception(
    'partial_refund', v_order.id, p_payment_intent_id, null, p_event_id, null,
    jsonb_build_object('amountRefundedCents', p_amount_refunded_cents, 'totalCents', v_order.total_cents,
                       'orderStatus', 'paid'));
  result := 'partial';
end;
$$;

-- As in 20261101000100_seat_holds.sql (the previous app version's call,
-- during the deploy window): no destination, so it never defers.
create or replace function private.record_payment_refund(
  p_payment_intent_id text, p_amount_refunded_cents integer, p_fully_refunded boolean,
  out result text, out order_id text
)
language sql
set search_path = ''
as $$
  select r.result, r.order_id
    from private.record_payment_refund(p_payment_intent_id, p_amount_refunded_cents, p_fully_refunded,
                                       null::text, null::text, null::text) r;
$$;

-- A refund's status, from refund.updated, refund.failed or
-- charge.refund.updated (or the refund our own refund call returned).
-- p_order_id is the refund's metadata.orderId (only our automatic refunds
-- carry one): trusted only when that order's payment intent is the refund's
-- own (p_payment_intent_id); otherwise the order is found by payment
-- intent. For an event (p_event_created set), the refund's status mark
-- first: an event older than the newest already recorded for this refund is
-- 'stale' (nothing else written). Then our automatic refund of an oversold
-- order is recorded on it (its id; `refunded` once it succeeded), as the app
-- did before. Then:
--   failed, canceled, requires_action: a refund_not_completed exception for
--     p_refund_id (raise_payment_exception's outcome is the result)
--   succeeded: that exception, if open, resolved automatically ('resolved')
--     unless the event is no newer than the last applied ('unchanged')
--   anything else: 'unchanged'
-- p_event_created: the Stripe event's creation time; null when the status
-- came from our own refund call rather than an event (no mark, never stale).
-- 'not_found' (nothing written): no order, and no early refund row either,
-- for the payment. Returns the order's id and status when found, and
-- alert_queued (an ops alert was queued).
create function private.record_refund_status(
  p_refund_id text, p_payment_intent_id text, p_order_id text, p_status text, p_amount_cents integer,
  p_event_id text, p_event_created timestamptz,
  out result text, out order_id text, out order_status text, out alert_queued boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
  v_found boolean := false;
  v_ours boolean := false;
  v_order_id text;
  v_order_status text;
  v_raised record;
  v_newest boolean;
begin
  alert_queued := false;
  if p_refund_id is null or p_status is null then
    raise exception 'record_refund_status: refund id and status are required' using errcode = '22023';
  end if;
  if p_payment_intent_id is not null then
    perform private.lock_payment_intent(p_payment_intent_id);
  end if;

  -- Our automatic refund: its metadata names the order, but only an order paid with this very payment counts.
  if p_order_id is not null and p_payment_intent_id is not null then
    select * into v_order from public.orders o
     where o.id = p_order_id and o.stripe_payment_intent_id = p_payment_intent_id
       for update;
    v_found := found;
    v_ours := v_found;
  end if;
  if not v_found and p_payment_intent_id is not null then
    select * into v_order from public.orders o
     where o.stripe_payment_intent_id = p_payment_intent_id
     order by o.id
     limit 1
       for update;
    v_found := found;
  end if;

  if v_found then
    v_order_id := v_order.id;
    v_order_status := v_order.status::text;
  elsif p_payment_intent_id is null
        or not exists (select 1 from private.early_charge_refunds r where r.payment_intent_id = p_payment_intent_id) then
    -- Not one of our payments (or nothing to tie it to): nothing written.
    result := 'not_found';
    return;
  end if;
  order_id := v_order_id;

  -- Stripe doesn't guarantee delivery order: only the newest event per refund counts (a tie goes through: fail safe).
  -- Checked before anything else is written, so a stale event changes nothing at all.
  if p_event_created is not null then
    insert into private.refund_status_marks as m (refund_id, status, last_event_at, stripe_event_id)
    values (p_refund_id, p_status, p_event_created, p_event_id)
    on conflict (refund_id) do update
       set status = excluded.status, last_event_at = excluded.last_event_at, stripe_event_id = excluded.stripe_event_id
     where m.last_event_at <= excluded.last_event_at
    returning true into v_newest;
    if v_newest is null then
      result := 'stale';
      order_status := v_order_status;
      return;
    end if;
  end if;

  -- Our automatic refund of an oversold order: recorded on it (refunded once it succeeded), as before.
  if v_ours and v_order.status = 'oversold_refund_required' then
    update public.orders o
       set stripe_refund_id = p_refund_id,
           status = case when p_status = 'succeeded' then 'refunded'::public.order_status else o.status end
     where o.id = v_order.id
    returning o.status::text into v_order_status;
  end if;
  order_status := v_order_status;

  if p_status in ('failed', 'canceled', 'requires_action') then
    select * into v_raised from private.raise_payment_exception(
      'refund_not_completed', v_order_id, p_payment_intent_id, p_refund_id, p_event_id, p_event_created,
      jsonb_strip_nulls(jsonb_build_object(
        'refundStatus', p_status, 'refundAmountCents', p_amount_cents, 'orderStatus', v_order_status,
        'source', case when v_ours then 'sheltuh' else 'stripe' end)));
    result := v_raised.outcome;
    alert_queued := v_raised.alert_queued;
  elsif p_status = 'succeeded' then
    update private.payment_exceptions e
       set status = 'resolved', resolution = 'auto', resolved_at = now(),
           resolution_note = 'Stripe reported the refund succeeded.',
           stripe_event_id = coalesce(p_event_id, e.stripe_event_id),
           last_event_at = greatest(e.last_event_at, p_event_created),
           details = e.details || jsonb_build_object('refundStatus', p_status)
     where e.kind = 'refund_not_completed' and e.refund_id = p_refund_id and e.status = 'open'
       -- Strictly newer than the last event applied (a tie keeps it open: fail safe).
       and (e.last_event_at is null or p_event_created is null or p_event_created > e.last_event_at);
    result := case when found then 'resolved' else 'unchanged' end;
  else
    result := 'unchanged';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fulfilment
-- ---------------------------------------------------------------------------

-- fulfil_order's body: as in 20261101000100_seat_holds.sql, plus (paid
-- orders only: a payment intent is given) the payment intent's lock first, and, after the pending
-- check, an early refund recorded for the payment applied once: in full, the
-- order becomes `refunded` with nothing taken or issued (seat holds
-- cleared); in part, the order is fulfilled, then the amount recorded and a
-- partial_refund exception opened. A refund exception raised for the payment
-- before it had an order gets the order. order_status is 'refunded' in the
-- first case; otherwise fulfil_order's result as before (null: no such
-- order). alert_queued: an ops alert was queued (the partial case, within
-- the daily cap), so the caller drains the alert outbox only then.
create function private.fulfil_order_detailed(
  p_order_id text, p_buyer_email text, p_payment_intent_id text, p_tickets jsonb,
  out order_status public.order_status, out alert_queued boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_pre record;
  v_order public.orders;
  v_line jsonb;
  v_event_status public.event_status;
  v_taken integer;
  v_early private.early_charge_refunds;
  v_result public.order_status;
  v_raised record;
begin
  alert_queued := false;
  if p_payment_intent_id is not null then
    perform private.lock_payment_intent(p_payment_intent_id);
  end if;

  -- event_id and seat_ids never change: safe to read before the lock order starts.
  select o.event_id, o.seat_ids into v_pre from public.orders o where o.id = p_order_id;
  if not found then
    return;
  end if;
  if v_pre.seat_ids is not null then
    perform private.lock_event_seats(v_pre.event_id);
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return;
  end if;
  if v_order.status <> 'pending' then
    order_status := v_order.status;
    return;
  end if;

  if p_payment_intent_id is not null then
    select * into v_early from private.early_charge_refunds r
     where r.payment_intent_id = p_payment_intent_id and r.applied_at is null
       for update;
  end if;

  if v_early.payment_intent_id is not null and v_early.fully_refunded then
    -- Refunded in full before the payment was recorded (D1): nothing taken, issued or emailed.
    update public.orders
       set status = 'refunded',
           amount_refunded_cents = greatest(amount_refunded_cents, v_early.amount_refunded_cents),
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
    v_result := 'refunded';
  else
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
      v_result := 'paid';
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
      v_result := 'oversold_refund_required';
    end;
  end if;

  if v_early.payment_intent_id is not null then
    update private.early_charge_refunds r
       set applied_at = now(), applied_order_id = p_order_id
     where r.payment_intent_id = p_payment_intent_id;
    -- Partly refunded before the payment was recorded (D2): the tickets stand, a person decides.
    -- (An oversold order is refunded in full by the app anyway.)
    if v_result = 'paid' then
      update public.orders
         set amount_refunded_cents = greatest(amount_refunded_cents, v_early.amount_refunded_cents)
       where id = p_order_id;
      select * into v_raised from private.raise_payment_exception(
        'partial_refund', p_order_id, p_payment_intent_id, null, v_early.last_event_id, null,
        jsonb_build_object('amountRefundedCents', v_early.amount_refunded_cents, 'totalCents', v_order.total_cents,
                           'orderStatus', 'paid'));
      alert_queued := v_raised.alert_queued;
    end if;
    -- A refund problem reported before the payment had an order: now it has one.
    update private.payment_exceptions e
       set order_id = p_order_id, details = e.details || jsonb_build_object('orderStatus', v_result::text)
     where e.payment_intent_id = p_payment_intent_id and e.order_id is null;
  end if;
  order_status := v_result;
end;
$$;

-- As in 20261101000100_seat_holds.sql (same signature: the free paths and
-- the previous app version call it): fulfil_order_detailed's status.
create or replace function private.fulfil_order(
  p_order_id text, p_buyer_email text, p_payment_intent_id text, p_tickets jsonb
) returns public.order_status
language sql
set search_path = ''
as $$
  select f.order_status from private.fulfil_order_detailed(p_order_id, p_buyer_email, p_payment_intent_id, p_tickets) f;
$$;

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------

-- As in 20261107000000_admin_review_emails.sql (same signature and result:
-- every kind, every key), except that with no p_kind it leases every kind but
-- `ops_alert`: those only with p_kind = 'ops_alert' (which this release's app
-- asks for first, then the rest), so an app version that can't send them,
-- during the deploy window, never leases one (and fails it as an unknown
-- job). The lapsed-lease sweep follows the same rule. An ops alert has no
-- order, so p_order_id never matches one.
-- private.claim_email_outbox (the release before lease_outbox_jobs) already
-- leaves every kind but ticket, waitlist and follower emails alone: unchanged.
create or replace function private.lease_outbox_jobs(
  p_limit integer, p_lease interval, p_max_attempts integer, p_order_id text default null, p_kind text default null
) returns table (
  job_id bigint, job_kind text, job_order_id text, job_waitlist_entry_id uuid, job_follow_id uuid,
  job_event_id uuid, job_organiser_id uuid, job_lease_token uuid, job_attempts integer)
language plpgsql
set search_path = ''
as $$
begin
  update private.email_outbox o
     set status = 'failed', lease_token = null, lease_expires_at = null,
         last_error = coalesce(o.last_error, 'the last attempt never finished')
   where o.status = 'sending' and o.lease_expires_at <= now() and o.attempts >= p_max_attempts
     and (p_order_id is null or o.order_id = p_order_id)
     and (case when p_kind is null then o.kind <> 'ops_alert' else o.kind = p_kind end);

  return query
  with picked as (
    select o.id from private.email_outbox o
     where ((o.status = 'pending' and o.next_attempt_at <= now())
         or (o.status = 'sending' and o.lease_expires_at <= now()))
       and (p_order_id is null or o.order_id = p_order_id)
       and (case when p_kind is null then o.kind <> 'ops_alert' else o.kind = p_kind end)
     order by o.next_attempt_at, o.id
     limit p_limit
     for update skip locked
  )
  update private.email_outbox o
     set status = 'sending', lease_token = gen_random_uuid(), lease_expires_at = now() + p_lease,
         attempts = o.attempts + 1
    from picked
   where o.id = picked.id
  returning o.id, o.kind, o.order_id, o.waitlist_entry_id, o.follow_id, o.event_id, o.organiser_id,
            o.lease_token, o.attempts;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- As in 20261108000000_account_invites.sql, plus early refund rows and
-- refund status marks 35 days after their last update and resolved payment
-- exceptions 2 years after resolution (open ones are never deleted).
drop function private.purge_operational_data();

create function private.purge_operational_data(
  out unconfirmed_orders_deleted integer, out platform_rate_limits_deleted integer,
  out free_order_refusals_deleted integer, out email_jobs_deleted integer,
  out client_rate_limits_deleted integer, out account_invites_deleted integer,
  out early_charge_refunds_deleted integer, out payment_exceptions_deleted integer,
  out refund_status_marks_deleted integer)
language plpgsql
set search_path = ''
as $$
begin
  delete from public.orders o
   where o.confirmation_token_hash is not null and o.status in ('pending', 'failed')
     and o.created_at < now() - interval '7 days'
     and o.confirmation_expires_at < now() - interval '7 days';
  get diagnostics unconfirmed_orders_deleted = row_count;

  delete from private.platform_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics platform_rate_limits_deleted = row_count;

  delete from private.free_order_refusals
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '13 months')::date;
  get diagnostics free_order_refusals_deleted = row_count;

  delete from private.email_outbox j
   where (j.status = 'sent' and j.sent_at < now() - interval '90 days')
      or (j.status = 'failed' and j.updated_at < now() - interval '1 year');
  get diagnostics email_jobs_deleted = row_count;

  delete from private.client_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics client_rate_limits_deleted = row_count;

  delete from private.account_invites i
   where (i.status = 'accepted' and i.accepted_at < now() - interval '90 days')
      or (i.status = 'revoked' and i.revoked_at < now() - interval '90 days')
      or (i.status in ('pending', 'expired') and i.expires_at < now() - interval '90 days');
  get diagnostics account_invites_deleted = row_count;

  delete from private.early_charge_refunds r where r.updated_at < now() - interval '35 days';
  get diagnostics early_charge_refunds_deleted = row_count;

  delete from private.payment_exceptions e
   where e.status = 'resolved' and e.resolved_at < now() - interval '2 years';
  get diagnostics payment_exceptions_deleted = row_count;

  delete from private.refund_status_marks m where m.updated_at < now() - interval '35 days';
  get diagnostics refund_status_marks_deleted = row_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.lock_payment_intent(text) from public, anon, authenticated;
revoke all on function private.raise_payment_exception(text, text, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function private.resolve_payment_exception(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.record_payment_refund(text, integer, boolean, text, text, text) from public, anon, authenticated;
revoke all on function private.record_payment_refund(text, integer, boolean) from public, anon, authenticated;
revoke all on function private.record_refund_status(text, text, text, text, integer, text, timestamptz)
  from public, anon, authenticated;
revoke all on function private.fulfil_order_detailed(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.fulfil_order(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.lease_outbox_jobs(integer, interval, integer, text, text) from public, anon, authenticated;
revoke all on function private.purge_operational_data() from public, anon, authenticated;
