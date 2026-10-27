-- No refund purpose is inferred from an amount: only a full refund voids an
-- order's tickets (owner decision, 27 Oct 2026, with Support Sheltüh paused;
-- docs/architecture.md, "Refunds made in Stripe"; docs/supabase-setup.md,
-- "Refunding a paid order").
--
-- Sorts after 20261111000200_first_paid_event_review.sql. Needs
-- 20261110000150_support_in_exceptions.sql and
-- 20261110000200_support_ticket_refund.sql (the definitions redefined here)
-- and 20261110000100_order_support.sql (support_cents, read in the details).
--
-- 20261110000200 voided an order with Support Sheltüh once at least
-- total_cents - support_cents was refunded (the runbook's "tickets only"
-- recipe). An amount can't say what a refund was for: when the support is at
-- least the tickets' amount, a refund of only the support voided the
-- tickets too, and a refund that arrived before its payment was recorded
-- followed a different rule (only Stripe's full refund voided it). Now one
-- rule, whichever order Stripe's events arrive in:
--
--   * Full refund: Stripe's `refunded` (charge.refunded with refunded =
--     true), or a cumulative amount refunded of at least the order's
--     total_cents. After fulfilment, private.record_payment_refund voids a
--     `paid` order as before (`refunded`, each line's quantity_sold given
--     back, a seated order's seats freed, an open partial_refund exception
--     resolved automatically with "Refunded in full in Stripe: the order was
--     voided."). Before fulfilment (an early_charge_refunds row),
--     private.fulfil_order_detailed leaves the order `refunded` with nothing
--     taken, issued or emailed (D1).
--   * Any other refund is partial, whatever its amount (tickets only,
--     support only, or anything else): the order stays `paid`, its tickets
--     stay valid, amount_refunded_cents records the amount, and a
--     partial_refund exception (with an ops alert) opens for an admin. After
--     fulfilment that's record_payment_refund's 'partial', as before; before
--     fulfilment the tickets are issued and the exception opened (D2, as
--     before). Voiding tickets without a full refund is a manual step: the
--     app has no admin "void tickets" action (the runbook).
--
-- No exception is closed with supportKeptCents any more. Exceptions already
-- resolved that way keep their details (the mapper still reads the key).
--
-- The 6-argument private.record_payment_refund (from
-- 20261110000200_support_ticket_refund.sql) and
-- private.fulfil_order_detailed (from
-- 20261110000150_support_in_exceptions.sql; no later file changes it) are
-- redefined (create or replace: same signatures and results, so every
-- caller, the previous app version's and the 3-argument
-- record_payment_refund included, resolves to them) with only the changes
-- above. Each pins search_path = '', isn't security definer, and has execute
-- revoked from PUBLIC, anon and authenticated again. Lock order unchanged
-- (the payment intent's lock, the seat lock, the order row, the seats, the
-- exception). The previous app version keeps working against this file: the
-- results are the ones it handles already.
--
-- No new table, column or index; no data is changed. Orders already voided
-- by the tickets-only rule stay voided (restoring tickets is a person's
-- decision).
--
-- Reversible: recreate private.record_payment_refund from
-- 20261110000200_support_ticket_refund.sql and private.fulfil_order_detailed
-- from 20261110000150_support_in_exceptions.sql, each with its revoke.

-- ---------------------------------------------------------------------------
-- After fulfilment
-- ---------------------------------------------------------------------------

-- As in 20261110000200_support_ticket_refund.sql, but only a full refund
-- (Stripe's flag, or at least total_cents) voids; the tickets-only rule and
-- supportKeptCents are gone.
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

  -- refund_no_inference (20261111000300): only a full refund voids the order. Stripe's `refunded`,
  -- or a cumulative amount of at least the order's total. Nothing is inferred from a smaller amount
  -- (not even total - support_cents): any partial refund leaves the tickets valid, for a person.
  if p_fully_refunded or p_amount_refunded_cents >= v_order.total_cents then
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
                       'supportCents', v_order.support_cents, 'orderStatus', 'paid'));
  result := 'partial';
end;
$$;

-- ---------------------------------------------------------------------------
-- Before fulfilment (an early refund applied by the payment)
-- ---------------------------------------------------------------------------

-- As in 20261110000150_support_in_exceptions.sql, but an early refund of at
-- least the order's total counts as full (D1) even without Stripe's flag, as
-- record_payment_refund does. private.fulfil_order (its wrapper, unchanged)
-- calls it.
create or replace function private.fulfil_order_detailed(
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

  -- refund_no_inference (20261111000300): the same rule as private.record_payment_refund. Refunded in
  -- full before the payment was recorded (Stripe's `refunded`, or at least the order's total; D1):
  -- nothing taken, issued or emailed. Any smaller early refund is partial (D2, below).
  if v_early.payment_intent_id is not null
     and (v_early.fully_refunded or v_early.amount_refunded_cents >= v_order.total_cents) then
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
    -- Partly refunded before the payment was recorded (D2): the tickets stand, a person decides,
    -- whatever the amount (no refund purpose is inferred from it, as in record_payment_refund).
    -- (An oversold order is refunded in full by the app anyway.)
    if v_result = 'paid' then
      update public.orders
         set amount_refunded_cents = greatest(amount_refunded_cents, v_early.amount_refunded_cents)
       where id = p_order_id;
      select * into v_raised from private.raise_payment_exception(
        'partial_refund', p_order_id, p_payment_intent_id, null, v_early.last_event_id, null,
        jsonb_build_object('amountRefundedCents', v_early.amount_refunded_cents, 'totalCents', v_order.total_cents,
                           'supportCents', v_order.support_cents, 'orderStatus', 'paid'));
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.record_payment_refund(text, integer, boolean, text, text, text) from public, anon, authenticated;
revoke all on function private.fulfil_order_detailed(text, text, text, jsonb) from public, anon, authenticated;
