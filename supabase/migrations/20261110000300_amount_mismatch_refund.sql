-- A payment whose amount or currency isn't its order's is refunded
-- automatically (docs/architecture.md, "Payment flow"; docs/supabase-setup.md,
-- "Payment amount mismatch").
--
-- Sorts after 20261110000200_support_ticket_refund.sql and needs
-- 20261110000150_support_in_exceptions.sql (the amount_mismatch kind) and
-- 20261110000100_order_support.sql (support_cents). Apply it before the app
-- that calls private.fail_mismatched_order deploys: without it that app's
-- webhook fails (500, Stripe retries) on a mismatched payment; matching
-- payments are fulfilled as ever. The previous app keeps working against it
-- (it never calls the function).
--
-- Until now a paid Checkout Session whose amount_total or currency wasn't the
-- order's stored total in AUD left the order `pending` forever (its seats held
-- until the holds lapsed), with an amount_mismatch exception for an admin to
-- refund by hand. Now the webhook calls private.fail_mismatched_order, then
-- refunds the payment in full exactly as for a payment to a failed order
-- (lib/server/handlers/orders.ts, refundPaymentForFailedOrder: one refund per
-- order through Stripe's idempotency key and orders.stripe_refund_id,
-- reverse_transfer and refund_application_fee).
--
-- private.fail_mismatched_order(order, payment intent, Stripe event id,
-- details), in one transaction, only for an order still `pending`:
--   * the order becomes `failed`, with the payment intent recorded on it
--     (before Stripe is asked for the refund, so the refund's own
--     charge.refunded and refund.updated find the order: record_payment_refund
--     answers 'unchanged' for an order that isn't paid, and never holds the
--     refund as an early_charge_refunds row "before its payment was
--     recorded");
--   * a seated order's seat holds are released (as release_seat_holds does).
--     A general admission order held no stock (inventory is only taken in
--     fulfil_order), so nothing else is given back;
--   * a refund Stripe reported before this payment (an early_charge_refunds
--     row not yet applied) is marked applied to the order, and exceptions
--     about the payment not yet matched to an order are tied to it, as
--     fulfil_order_detailed does; the automatic refund repays the rest (or
--     finds the charge already refunded);
--   * an amount_mismatch payment exception is opened (or, if one is open,
--     updated) with the app's details (reason, amountChargedCents, currency)
--     plus the order's totalCents, supportCents and orderStatus 'failed', and
--     its ops alert queued (raise_payment_exception, within the daily cap).
-- Returns the order's status (null: no such order) and whether an alert was
-- queued. An order that isn't pending any more (a concurrent delivery got
-- there first) is left as it is and its status returned: the caller refunds
-- a `failed` one again, which Stripe's idempotency key makes a no-op.
--
-- Lock order as fulfil_order_detailed and record_payment_refund: the payment
-- intent's lock, then (seated) the event's seat lock, then the order row,
-- then the seats, then the exception and the platform's alert counter (in
-- raise_payment_exception).
--
-- An order that's `failed` no longer counts in
-- private.event_has_payable_orders (only paid, and pending with a session or
-- a confirmation link, do).
--
-- No new table, column or index: the function reads orders by primary key,
-- early_charge_refunds by its primary key (payment_intent_id) and
-- payment_exceptions by payment_exceptions_unmatched_idx (payment_intent_id).
--
-- Pins search_path = '', isn't security definer, and has execute revoked from
-- PUBLIC, anon and authenticated.
--
-- Additive. Reversible: deploy the previous app first (it leaves mismatched
-- orders pending), then drop function private.fail_mismatched_order(text,
-- text, text, jsonb). Orders it already failed and refunded stay so.

create function private.fail_mismatched_order(
  p_order_id text, p_payment_intent_id text, p_event_id text, p_details jsonb,
  out order_status public.order_status, out alert_queued boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_pre record;
  v_order public.orders;
  v_raised record;
begin
  alert_queued := false;
  if p_order_id is null or p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'fail_mismatched_order: invalid arguments' using errcode = '22023';
  end if;
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

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    return;
  end if;
  if v_order.status <> 'pending' then
    order_status := v_order.status;
    return;
  end if;

  update public.orders o
     set status = 'failed',
         stripe_payment_intent_id = coalesce(o.stripe_payment_intent_id, p_payment_intent_id)
   where o.id = p_order_id;

  if v_order.seat_ids is not null then
    perform 1 from public.event_seats s
     where s.event_id = v_order.event_id and s.hold_order_id = p_order_id
     order by s.id
       for update;
    update public.event_seats s set hold_order_id = null, hold_expires_at = null
     where s.event_id = v_order.event_id and s.hold_order_id = p_order_id;
  end if;

  if p_payment_intent_id is not null then
    -- Refunded (in part or in full) before this payment arrived: the automatic refund repays the rest.
    update private.early_charge_refunds r
       set applied_at = now(), applied_order_id = p_order_id
     where r.payment_intent_id = p_payment_intent_id and r.applied_at is null;
    -- A refund problem reported before the payment had an order: now it has one.
    update private.payment_exceptions e
       set order_id = p_order_id, details = e.details || jsonb_build_object('orderStatus', 'failed')
     where e.payment_intent_id = p_payment_intent_id and e.order_id is null;
  end if;

  select * into v_raised from private.raise_payment_exception(
    'amount_mismatch', p_order_id, p_payment_intent_id, null, p_event_id, null,
    jsonb_strip_nulls(p_details || jsonb_build_object(
      'totalCents', v_order.total_cents, 'supportCents', v_order.support_cents, 'orderStatus', 'failed')));
  alert_queued := v_raised.alert_queued;
  order_status := 'failed';
end;
$$;

revoke all on function private.fail_mismatched_order(text, text, text, jsonb) from public, anon, authenticated;
