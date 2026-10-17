-- Refunds made outside the app (QR check-in plan, step B0).
--
-- Until now Stripe's `charge.refunded` was ignored: a payment refunded in the
-- Stripe dashboard left its order `paid`, its tickets valid and its inventory
-- taken. Now the webhook (lib/server/handlers/orders.ts) passes every
-- `charge.refunded` to private.record_payment_refund:
--
--   * Full refund of a `paid` order: the order becomes `refunded`, the amount
--     is recorded, and its inventory is released (each line item's quantity
--     comes off its ticket type's quantity_sold, the exact reverse of
--     fulfil_order). The ticket rows are kept (history, and the tickets FK
--     that stops a sold ticket type being deleted), but a refunded order's
--     tickets are void: the API no longer returns their codes and the ticket
--     email refuses an order that isn't paid.
--   * Partial refund of a `paid` order: only orders.amount_refunded_cents is
--     recorded. The order stays `paid` and its tickets stay valid; the API
--     logs it for manual follow-up.
--   * Anything else (pending, failed, the automatic oversold refund path,
--     already refunded) is left alone: 'unchanged'. Oversold orders keep
--     their own path (refund.updated / refund.failed by refund id).
--
-- Idempotent: Stripe redelivers webhooks, and charge.refunded carries the
-- charge's cumulative amount_refunded, so a delivery that doesn't increase
-- the recorded amount (or finds the order already refunded) changes nothing.
--
-- Locks: the order row first (for update), then its ticket types in
-- ticketTypeId order, the same order as fulfil_order, so a refund and a
-- fulfilment of another order for the same event can't deadlock. Two
-- deliveries of one refund serialise on the order row; the second sees
-- `refunded` and changes nothing, so inventory is released exactly once.
--
-- Index: orders_stripe_payment_intent_idx, partial (only orders that reached
-- Stripe payment have a payment intent; free and pending ones don't), serves
-- the webhook's only lookup, by payment intent. Not unique, deliberately:
-- the column has never been constrained, and a violation would make the
-- payment webhook fail. A Checkout Session (one per order) has one payment
-- intent, so a match is one order in practice; if there were ever two, the
-- function acts on the lowest order id, deterministically.
--
-- Access model as everywhere else: caller's rights (not security definer),
-- search_path pinned, execute revoked from PUBLIC, anon and authenticated.
--
-- Reversible, not destructive: drop function private.record_payment_refund,
-- drop index public.orders_stripe_payment_intent_idx, and drop column
-- public.orders.amount_refunded_cents (that discards the recorded refund
-- amounts; the Stripe dashboard still has them). Orders already marked
-- `refunded` by this function stay refunded. Adding the column with a
-- constant default doesn't rewrite the table.

alter table public.orders
  add column amount_refunded_cents integer not null default 0
    constraint orders_amount_refunded_cents_check check (amount_refunded_cents >= 0);

create index orders_stripe_payment_intent_idx on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- p_amount_refunded_cents is the charge's cumulative amount_refunded, and
-- p_fully_refunded its `refunded` flag (Stripe sets it once the whole amount
-- has been refunded). Returns the result and, when an order was found, its
-- id (for the API to log by short reference). result:
--   'refunded'   a paid order fully refunded: now `refunded`, inventory released
--   'partial'    a paid order partly refunded: amount recorded, still `paid`
--   'unchanged'  found, but nothing to do (not paid, or a redelivery)
--   'not_found'  no order has this payment intent
create function private.record_payment_refund(
  p_payment_intent_id text, p_amount_refunded_cents integer, p_fully_refunded boolean,
  out result text, out order_id text
)
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
  v_line jsonb;
begin
  if p_amount_refunded_cents is null or p_amount_refunded_cents < 0 or p_fully_refunded is null then
    raise exception 'invalid refund amount or flag' using errcode = '22023';
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

  -- Only a paid order is ours to change here. pending/failed never took
  -- inventory; oversold_refund_required and refunded belong to the
  -- automatic refund path, or this refund has already been recorded.
  if v_order.status <> 'paid' then
    result := 'unchanged';
    return;
  end if;

  if p_fully_refunded then
    -- The reverse of fulfil_order's reservation, in the same lock order.
    for v_line in
      select value from jsonb_array_elements(v_order.line_items) order by value ->> 'ticketTypeId'
    loop
      update public.ticket_types
         set quantity_sold = greatest(quantity_sold - (v_line ->> 'quantity')::integer, 0)
       where event_id = v_order.event_id
         and id = v_line ->> 'ticketTypeId';
    end loop;

    update public.orders
       set status = 'refunded',
           amount_refunded_cents = greatest(amount_refunded_cents, p_amount_refunded_cents)
     where id = v_order.id;
    result := 'refunded';
    return;
  end if;

  -- Partial: amount_refunded only grows, so an older or repeated delivery
  -- (same or smaller amount) changes nothing.
  if p_amount_refunded_cents <= v_order.amount_refunded_cents then
    result := 'unchanged';
    return;
  end if;
  update public.orders set amount_refunded_cents = p_amount_refunded_cents where id = v_order.id;
  result := 'partial';
end;
$$;

revoke all on function private.record_payment_refund(text, integer, boolean) from public, anon, authenticated;
