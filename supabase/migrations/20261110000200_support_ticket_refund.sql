-- A "tickets only" refund of an order with Support Sheltüh voids its tickets
-- (docs/architecture.md, "Refunds made in Stripe"; docs/supabase-setup.md,
-- "Refunding a paid order").
--
-- Sorts after 20261110000150_support_in_exceptions.sql and needs
-- 20261110000100_order_support.sql (it reads public.orders.support_cents).
--
-- The runbook's "tickets only" recipe refunds total_cents - support_cents
-- (the buyer keeps nothing but what they gave Sheltüh). Stripe then reports
-- charge.refunded with refunded = false (the support is still on the charge),
-- which private.record_payment_refund treated as a partial refund: the order
-- stayed `paid` and its tickets still checked in. Now, for an order with
-- support (support_cents > 0), a cumulative amount refunded of at least
-- total_cents - support_cents is a refund of the tickets: the order is voided
-- exactly as for a full refund (`refunded`, each line's quantity_sold given
-- back, a seated order's seats freed, an open partial_refund exception
-- resolved automatically), and returns 'refunded' as a full refund does. What
-- Sheltüh kept is recorded:
--   * orders.amount_refunded_cents is the amount refunded (less than
--     total_cents), so `status = 'refunded' and amount_refunded_cents <
--     total_cents` is a tickets-only refund (the support kept is the
--     difference). A later refund of the support finds the order no longer
--     `paid` and changes nothing, as any refund of a voided order.
--   * an open partial_refund exception it resolves gets the note "Tickets
--     refunded in Stripe, Support Sheltüh kept: …" and supportKeptCents in
--     its details (a full refund's resolution is as before).
-- A smaller refund stays partial (the order `paid`, a partial_refund
-- exception), and orders without support are unchanged: only refunded =
-- true voids them. An amount alone can't tell a tickets-only refund from a
-- support-only one when support_cents >= total_cents - support_cents (support
-- at least the tickets' price and fees): such a "support only" refund voids
-- the tickets too (the runbook says so).
--
-- private.fulfil_order_detailed (a refund recorded before the payment, D2) is
-- unchanged: an early refund that isn't Stripe's full refund still issues the
-- tickets and opens a partial_refund exception for a person.
--
-- The 6-argument private.record_payment_refund is redefined (create or
-- replace: same signature and result, so every caller, the previous app
-- version and the 3-argument form included, resolves to it) from its latest
-- definition, 20261110000150_support_in_exceptions.sql, with only the change
-- above. It pins search_path = '', isn't security definer, and has execute
-- revoked from PUBLIC, anon and authenticated again. The previous app version
-- keeps working against it (it handles 'refunded' already).
--
-- No new table, column or index.
--
-- Reversible: recreate private.record_payment_refund from
-- 20261110000150_support_in_exceptions.sql with its revoke. Orders already
-- voided by a tickets-only refund stay voided (restoring tickets is a manual
-- decision).

-- As in 20261110000150_support_in_exceptions.sql, plus: an order with support
-- refunded by at least its total less the support is voided as a full refund.
create or replace function private.record_payment_refund(
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

  -- Refunded in full, or (an order with Support Sheltüh) everything but the support: the tickets
  -- are refunded, so the order is voided; the support Sheltüh kept is what's left unrefunded.
  if p_fully_refunded
     or (v_order.support_cents > 0 and p_amount_refunded_cents >= v_order.total_cents - v_order.support_cents) then
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
           resolution_note = case when p_fully_refunded
                                  then 'Refunded in full in Stripe: the order was voided.'
                                  else 'Tickets refunded in Stripe, Support Sheltüh kept: the order was voided.' end,
           stripe_event_id = coalesce(p_event_id, e.stripe_event_id),
           details = e.details || jsonb_build_object('amountRefundedCents', p_amount_refunded_cents, 'orderStatus', 'refunded')
                     || case when p_fully_refunded then '{}'::jsonb
                             else jsonb_build_object('supportKeptCents', greatest(v_order.total_cents - p_amount_refunded_cents, 0)) end
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
                       'supportCents', v_order.support_cents, 'orderStatus', 'paid'));
  result := 'partial';
end;
$$;

revoke all on function private.record_payment_refund(text, integer, boolean, text, text, text) from public, anon, authenticated;
