-- Fixes from the first code review of the Supabase backend.

-- A paid ticket must cost at least A$1.00. Below that, an organiser-absorbed
-- booking fee (5% + A$0.50) can exceed the price, which Stripe rejects.
-- Mirrors MIN_PAID_TICKET_CENTS in lib/fees.ts.
alter table public.ticket_types
  add constraint ticket_types_min_paid_price check (price_cents = 0 or price_cents >= 100);

-- fulfil_order now also refuses an event that is no longer published (an
-- admin can unpublish it while a buyer is still on Stripe's checkout page).
-- Such an order takes the same path as a sell-out: nothing is reserved, and
-- it's marked oversold_refund_required so the webhook refunds the payment.
-- The event row is share-locked, so an unpublish and a fulfilment can't
-- interleave.
create or replace function private.fulfil_order(
  p_order_id text, p_buyer_email text, p_payment_intent_id text, p_tickets jsonb
) returns public.order_status
language plpgsql as $$
declare
  v_order public.orders;
  v_line jsonb;
  v_event_status public.event_status;
begin
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

    insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name)
    select t ->> 'ticketCode', p_order_id, v_order.event_id, t ->> 'ticketTypeId', t ->> 'ticketTypeName'
    from jsonb_array_elements(p_tickets) t;

    update public.orders
    set status = 'paid',
        buyer_email = coalesce(p_buyer_email, buyer_email),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;
    return 'paid';
  exception when sqlstate 'SH409' then
    -- Everything in this block (partial reservations included) is rolled back.
    update public.orders
    set status = 'oversold_refund_required',
        buyer_email = coalesce(p_buyer_email, buyer_email),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;
    return 'oversold_refund_required';
  end;
end;
$$;

revoke all on function private.fulfil_order(text, text, text, jsonb) from public, anon, authenticated;

-- Refunds are only recorded as done once Stripe says they succeeded; one that
-- is still pending (or has failed) is tracked here, and the order stays
-- oversold_refund_required until a refund.updated webhook confirms it.
alter table public.orders add column stripe_refund_id text;
