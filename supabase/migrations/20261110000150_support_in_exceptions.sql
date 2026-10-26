-- Support Sheltüh in payment exceptions, and an `amount_mismatch` kind
-- (docs/architecture.md, "Support Sheltüh" and "Refunds made in Stripe";
-- docs/supabase-setup.md, "Refunding a paid order").
--
-- Sorts after 20261110000100_order_support.sql and needs it: the functions
-- below read public.orders.support_cents. Apply 20261110000100 first, then
-- this file, then deploy the app.
--
-- 1. supportCents in the details. An order's Support Sheltüh amount is part
--    of its total and of the application fee, so whoever refunds a payment in
--    the Stripe dashboard needs it to split the refund (the runbook in
--    docs/supabase-setup.md). The details an exception is opened with now
--    carry the order's support_cents (0 when none) beside its total:
--      * private.record_payment_refund (the 6-argument form): partial_refund
--        details gain supportCents.
--      * private.fulfil_order_detailed: an early partial refund's
--        partial_refund details gain supportCents.
--      * private.record_refund_status: refund_not_completed details gain
--        totalCents and supportCents when the order is found (stripped when
--        it isn't, as before).
--    (manual_refund_required and amount_mismatch details are built by the
--    app, lib/server/handlers/orders.ts, from the order row in the same
--    statement.) Exceptions opened before this file keep their details.
--
-- 2. `amount_mismatch`: a Checkout Session paid with an amount or currency
--    other than the order's stored total in AUD. The webhook checks
--    session.amount_total = orders.total_cents and session.currency = 'aud'
--    before fulfilling a paid order; on a mismatch it issues nothing (the
--    order stays `pending`), opens one of these (one open per order, keyed
--    on the order, like partial_refund and manual_refund_required) and
--    queues an ops alert. Nothing changes the money automatically: an admin
--    checks the payment in Stripe, refunds it there, and resolves it.
--    payment_exceptions_kind_check and private.raise_payment_exception's
--    argument check gain the kind; payment_exceptions_key_check already
--    keys every kind but refund_not_completed on its order (no refund id).
--
-- Each function is redefined (create or replace: same signature and result,
-- so every caller, the previous app version's included, resolves to it)
-- from its latest definition, 20261109000200_payment_reconciliation.sql (no
-- later file changes any of them), with only the changes above. Each pins
-- search_path = '', none is security definer, and execute is revoked from
-- PUBLIC, anon and authenticated again.
--
-- The previous app version keeps working against this file: it never opens
-- an amount_mismatch, and the extra detail keys are ignored by its mapper
-- (lib/server/records.ts reads known keys only).
--
-- No new table, column or index: nothing new is filtered or sorted on.
--
-- Additive. Reversible: deploy the previous app first; delete (or resolve
-- and export, then delete) the amount_mismatch exceptions; restore
-- payment_exceptions_kind_check without 'amount_mismatch'; recreate the four
-- functions from 20261109000200_payment_reconciliation.sql with their
-- revokes. Details already written with supportCents can stay (extra keys
-- are ignored).

alter table private.payment_exceptions
  drop constraint payment_exceptions_kind_check,
  add constraint payment_exceptions_kind_check
    check (kind in ('refund_not_completed', 'partial_refund', 'manual_refund_required', 'amount_mismatch'));

-- ---------------------------------------------------------------------------
-- Exceptions
-- ---------------------------------------------------------------------------

-- As in 20261109000200_payment_reconciliation.sql, plus the amount_mismatch
-- kind (keyed on its order, as partial_refund and manual_refund_required).
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
  if p_kind is null or p_kind not in ('refund_not_completed', 'partial_refund', 'manual_refund_required', 'amount_mismatch')
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
-- Refunds
-- ---------------------------------------------------------------------------

-- As in 20261109000200_payment_reconciliation.sql, plus supportCents in a
-- partial refund's exception details.
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
                       'supportCents', v_order.support_cents, 'orderStatus', 'paid'));
  result := 'partial';
end;
$$;


-- As in 20261109000200_payment_reconciliation.sql, plus totalCents and
-- supportCents in a refund_not_completed exception's details (when the order
-- is found; stripped otherwise).
create or replace function private.record_refund_status(
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
        'totalCents', v_order.total_cents, 'supportCents', v_order.support_cents,
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

-- As in 20261109000200_payment_reconciliation.sql, plus supportCents in an
-- early partial refund's exception details. private.fulfil_order (its
-- wrapper, unchanged) calls it.
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

revoke all on function private.raise_payment_exception(text, text, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function private.record_payment_refund(text, integer, boolean, text, text, text) from public, anon, authenticated;
revoke all on function private.record_refund_status(text, text, text, text, integer, text, timestamptz)
  from public, anon, authenticated;
revoke all on function private.fulfil_order_detailed(text, text, text, jsonb) from public, anon, authenticated;
