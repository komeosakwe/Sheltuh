-- Group tickets (docs/architecture.md, "Group tickets"): one ticket type that
-- admits several people ("Group of 4", A$120 for 4). General admission, paid
-- only, events without a seat map in v1 (owner decisions, 4 Nov 2026).
--
-- Capacity stays in PEOPLE. A group ticket type's quantity_available is the
-- number of people it admits in total (a multiple of admits), and one group
-- sold takes `admits` of quantity_sold. So sold-out logic, the sequential
-- release (ticket_type_locks, sold_out_at), the waitlist, the door counts and
-- ticketsSold all work unchanged, in people.
--
--   * ticket_types.admits (integer, default 1): how many people one ticket
--     admits. Checks: 1..10 (ticket_types_admits_range); quantity_available a
--     multiple of it (ticket_types_admits_multiple); above 1 only for a paid
--     ticket (ticket_types_group_paid) and a general admission one
--     (ticket_types_admits_ga_only: a seated tier is sold by seat).
--   * ticket_types_admits_frozen (BEFORE UPDATE OF admits): the number can't
--     change while the tier has sold tickets or the event has orders that can
--     still be paid (private.event_has_payable_orders, as the refund policy's
--     freeze): an order is priced and fulfilled with the admits it was made
--     with. check_violation, constraint ticket_types_admits_frozen. Setting
--     the value it already has is no change.
--   * tickets.group_size (smallint, null for a single ticket): the people in
--     the group a ticket belongs to, copied from the order's line snapshot
--     when the ticket is issued. One ticket (code, QR) is issued per person.
--   * orders.line_items[].admits: the snapshot (only above 1), written by the
--     app from the database's own value. private.order_group_size reads it.
--   * private.fulfil_order_detailed, redefined (as 20261111000300_
--     refund_no_inference.sql): a line takes quantity x admits of
--     quantity_sold, and only from a ticket type whose admits is still the
--     snapshot's (else the SH409 sold-out path: refund required, as for any
--     order that can't be fulfilled); a group line's issued tickets must be
--     exactly one per person (a plain error: a bug, never an oversold order);
--     tickets get group_size.
--   * private.record_payment_refund, redefined (as 20261111000300): a full
--     refund gives back quantity x admits people. Refunds stay whole-order
--     only: a partial refund of a group order still raises the partial_refund
--     exception for a person to decide (docs/supabase-setup.md).
--   * private.replace_ticket_types and private.admin_edit_event, redefined
--     (as 20261117000000_ticket_release_lock.sql) to carry admits: absent from
--     the request keeps the stored value (a client that predates the feature
--     can't reset it), and it is logged (`ticketTypes` old/new) only when
--     above 1.
--
-- Unchanged, checked: private.release_tickets (the quantity it takes must now
-- be a multiple of admits: ticket_types_admits_multiple, mapped to a 400 by
-- the handler), check_in_ticket, hold_seats, ticket_types_seated_capacity
-- (seated tiers have admits 1), notify_waitlist and the waitlist reads (people),
-- the door counts, trending, set_going.
--
-- Overlap with the unmerged feat/delayed-payouts migration
-- (20261119000000_delayed_payouts.sql): it redefines only
-- private.raise_payment_exception among the functions this file touches
-- (it doesn't redefine fulfil_order_detailed, record_payment_refund,
-- replace_ticket_types or admin_edit_event), so the bodies here are based on
-- the latest in main and nothing of it is lost. This file sorts after it.
--
-- Access model as everywhere else: not SECURITY DEFINER, search_path pinned,
-- execute revoked from PUBLIC, anon and authenticated. No new table, so no new
-- RLS or grants.
--
-- Additive. Reversible, not destructive, until a group ticket exists
-- (admits > 1): restore the four functions from their earlier migrations,
-- drop the trigger and the helper, then the constraints and the two columns.
-- Dropping the columns afterwards would turn issued group tickets into
-- ordinary single ones (and their orders' admits snapshots would be ignored).

alter table public.ticket_types
  add column admits integer not null default 1,
  add constraint ticket_types_admits_range check (admits between 1 and 10),
  -- greatest(): an admits of 0 is for ticket_types_admits_range to refuse, not a division by zero.
  add constraint ticket_types_admits_multiple check (quantity_available % greatest(admits, 1) = 0),
  add constraint ticket_types_group_paid check (admits = 1 or price_cents > 0),
  add constraint ticket_types_admits_ga_only check (admits = 1 or not seated);

alter table public.tickets
  add column group_size smallint,
  add constraint tickets_group_size_range check (group_size is null or group_size between 2 and 10);

-- ---------------------------------------------------------------------------
-- The number of people can't change under an order
-- ---------------------------------------------------------------------------

create function private.ticket_types_admits_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.admits is distinct from old.admits
     and (old.quantity_sold > 0 or private.event_has_payable_orders(old.event_id)) then
    raise exception 'A ticket that has sales or orders can''t change how many people it admits.'
      using errcode = 'check_violation', constraint = 'ticket_types_admits_frozen';
  end if;
  return new;
end;
$$;

create trigger ticket_types_admits_frozen before update of admits on public.ticket_types
  for each row execute function private.ticket_types_admits_frozen();

-- The people in the group a ticket of `p_ticket_type_id` belongs to, from an
-- order's line snapshot: null for a single ticket (or a line without admits).
create function private.order_group_size(p_line_items jsonb, p_ticket_type_id text) returns smallint
language sql
immutable
set search_path = ''
as $$
  select (li ->> 'admits')::smallint
    from jsonb_array_elements(p_line_items) li
   where li ->> 'ticketTypeId' = p_ticket_type_id
     and coalesce((li ->> 'admits')::integer, 1) > 1
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- replace_ticket_types: as 20261117000000_ticket_release_lock.sql, plus admits
-- ---------------------------------------------------------------------------

create or replace function private.replace_ticket_types(p_event_id uuid, p_ticket_types jsonb) returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.ticket_types t
  where t.event_id = p_event_id
    and not exists (select 1 from jsonb_array_elements(p_ticket_types) e where e ->> 'id' = t.id);

  insert into public.ticket_types
    (event_id, id, position, name, description, price_cents, fee_policy, quantity_available, opens_after_previous, admits)
  select p_event_id,
         x.e ->> 'id',
         x.ord::integer - 1,
         x.e ->> 'name',
         nullif(x.e ->> 'description', ''),
         (x.e ->> 'priceCents')::integer,
         (x.e ->> 'feePolicy')::public.fee_policy,
         (x.e ->> 'quantityAvailable')::integer,
         -- Absent: the stored value. Never the first position.
         x.ord > 1 and coalesce((x.e ->> 'opensAfterPrevious')::boolean, s.opens_after_previous, false),
         -- Absent: the stored value (a client that predates group tickets can't reset it); 1 for a new tier.
         coalesce((x.e ->> 'admits')::integer, s.admits, 1)
  from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)
  left join public.ticket_types s on s.event_id = p_event_id and s.id = x.e ->> 'id'
  on conflict (event_id, id) do update set
    position = excluded.position,
    name = excluded.name,
    description = excluded.description,
    price_cents = excluded.price_cents,
    fee_policy = excluded.fee_policy,
    quantity_available = excluded.quantity_available,
    opens_after_previous = excluded.opens_after_previous,
    admits = excluded.admits;

  -- External: the organiser's free flag. Otherwise free only with at least
  -- one ticket type and none of them paid.
  update public.events e
  set is_free = case when e.ticketing_mode = 'external' then e.external_free
                     else exists (select 1 from public.ticket_types where event_id = p_event_id)
                          and not exists (select 1 from public.ticket_types where event_id = p_event_id and price_cents > 0)
                end
  where e.id = p_event_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_edit_event: as 20261117000000_ticket_release_lock.sql, plus admits in the
-- ticket types it compares and logs (absent from the request: the stored one)
-- ---------------------------------------------------------------------------

create or replace function private.admin_edit_event(
  p_event_id uuid, p_admin_id uuid, p_expected_updated_at timestamptz,
  p_fields jsonb, p_ticket_types jsonb, p_publish boolean, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_organiser_id uuid;
  v_org record;
  v_event record;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_url text := p_fields ->> 'externalTicketUrl';
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
  v_refund_policy text;
  v_refund_days integer;
  v_state text;
  v_time_zone text;
  v_location_source text;
  v_place_id text;
  v_pin_lat double precision;
  v_pin_lng double precision;
  v_price integer;
  v_ticketing_changed boolean;
  v_publish boolean;
  v_old jsonb;
  v_new jsonb;
  v_details jsonb;
  v_ticketing_result text;
begin
  select e.organiser_id into v_organiser_id from public.events e where e.id = p_event_id;
  if not found then
    return 'not_found';
  end if;
  -- Organiser (share), then event, as event approval and suspend_organiser.
  select o.status, o.owner_user_id into v_org from public.organisers o where o.id = v_organiser_id for share;
  select e.* into v_event from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  if date_trunc('milliseconds', v_event.updated_at) is distinct from date_trunc('milliseconds', p_expected_updated_at)
     or v_event.organiser_id <> v_organiser_id then
    return 'stale';
  end if;

  if p_fields ? 'refundPolicy' then
    v_refund_policy := p_fields ->> 'refundPolicy';
    v_refund_days := (p_fields ->> 'refundDays')::integer;
  else
    v_refund_policy := v_event.refund_policy;
    v_refund_days := v_event.refund_days;
  end if;
  v_state := coalesce(p_fields ->> 'state', v_event.state);
  v_time_zone := coalesce(p_fields ->> 'timeZone', v_event.time_zone);
  if p_fields ? 'locationSource' then
    v_location_source := p_fields ->> 'locationSource';
    v_place_id := p_fields ->> 'placeId';
    v_pin_lat := (p_fields ->> 'pinLat')::double precision;
    v_pin_lng := (p_fields ->> 'pinLng')::double precision;
  else
    v_location_source := v_event.location_source;
    v_place_id := v_event.venue_place_id;
    v_pin_lat := v_event.venue_lat;
    v_pin_lng := v_event.venue_lng;
  end if;

  -- As edit_event_draft reads it: only for a paid external event; kept when not sent.
  v_price := case when v_mode <> 'external' or v_free then null
                  when p_fields ? 'externalPriceFromCents' then (p_fields ->> 'externalPriceFromCents')::integer
                  else v_event.external_price_from_cents end;

  v_ticketing_changed := v_event.ticketing_mode is distinct from v_mode
    or v_event.external_ticket_url is distinct from v_url
    or v_event.external_free is distinct from v_free
    or v_event.external_price_from_cents is distinct from v_price;
  v_publish := coalesce(p_publish, false) and v_event.status <> 'published';

  -- Every other field, old and new, in the API's names. Ticket types in the
  -- request's shape (an empty description left out; opensAfterPrevious and
  -- admits only when set), in display order.
  v_old := jsonb_build_object(
    'title', v_event.title,
    'description', v_event.description,
    'category', v_event.category::text,
    'venueName', v_event.venue_name,
    'venueAddress', v_event.venue_address,
    'suburb', v_event.suburb,
    'state', v_event.state,
    'timeZone', v_event.time_zone,
    'location', private.event_location_json(v_event.location_source, v_event.venue_place_id,
                                            v_event.venue_lat, v_event.venue_lng),
    'startsAt', v_event.starts_at,
    'endsAt', v_event.ends_at,
    'refundPolicy', v_event.refund_policy,
    'refundDays', v_event.refund_days,
    'ticketTypes', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', t.id, 'name', t.name, 'description', t.description, 'priceCents', t.price_cents,
               'feePolicy', t.fee_policy::text, 'quantityAvailable', t.quantity_available,
               'opensAfterPrevious', case when t.opens_after_previous then true end,
               'admits', case when t.admits > 1 then t.admits end)) order by t.position)
        from public.ticket_types t where t.event_id = p_event_id), '[]'::jsonb));
  v_new := jsonb_build_object(
    'title', p_fields ->> 'title',
    'description', p_fields ->> 'description',
    'category', p_fields ->> 'category',
    'venueName', p_fields ->> 'venueName',
    'venueAddress', p_fields ->> 'venueAddress',
    'suburb', p_fields ->> 'suburb',
    'state', v_state,
    'timeZone', v_time_zone,
    'location', private.event_location_json(v_location_source, v_place_id, v_pin_lat, v_pin_lng),
    'startsAt', (p_fields ->> 'startsAt')::timestamptz,
    'endsAt', (p_fields ->> 'endsAt')::timestamptz,
    'refundPolicy', v_refund_policy,
    'refundDays', v_refund_days,
    'ticketTypes', case when v_mode = 'external' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', x.e ->> 'id', 'name', x.e ->> 'name', 'description', nullif(x.e ->> 'description', ''),
               'priceCents', (x.e ->> 'priceCents')::integer, 'feePolicy', x.e ->> 'feePolicy',
               'quantityAvailable', (x.e ->> 'quantityAvailable')::integer,
               -- As replace_ticket_types stores it: absent keeps the stored value; never the first position.
               'opensAfterPrevious', case when x.ord > 1
                 and coalesce((x.e ->> 'opensAfterPrevious')::boolean, s.opens_after_previous, false) then true end,
               -- As replace_ticket_types stores it: absent keeps the stored value.
               'admits', case when coalesce((x.e ->> 'admits')::integer, s.admits, 1) > 1
                 then coalesce((x.e ->> 'admits')::integer, s.admits) end))
               order by x.ord)
        from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)
        left join public.ticket_types s on s.event_id = p_event_id and s.id = x.e ->> 'id'), '[]'::jsonb) end);
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k)), '{}'::jsonb)
    into v_details
    from jsonb_object_keys(v_new) k
   where (v_old -> k) is distinct from (v_new -> k);

  if v_details = '{}'::jsonb and not v_ticketing_changed and not v_publish then
    return 'unchanged';
  end if;

  -- Refusals, before anything is written.
  if v_org.owner_user_id is null and v_mode = 'sheltuh'
     and exists (select 1 from jsonb_array_elements(p_ticket_types) t where (t ->> 'priceCents')::integer > 0) then
    return 'platform_paid';
  end if;
  if v_mode = 'external' and v_event.ticketing_mode <> 'external'
     and exists (select 1 from public.orders o where o.event_id = p_event_id) then
    return 'has_orders';
  end if;
  if private.refund_policy_tightens(v_event.refund_policy, v_event.refund_days, v_refund_policy, v_refund_days)
     and private.event_has_payable_orders(p_event_id) then
    return 'refund_policy_tightened';
  end if;
  if (v_event.ticketing_mode is distinct from v_mode or v_event.external_ticket_url is distinct from v_url)
     and p_reason is null
     and exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'reason_required';
  end if;
  if v_publish and v_org.status <> 'approved' then
    return 'organiser_not_approved';
  end if;

  -- Ticketing first: switching to external deletes the ticket types, and
  -- switching back leaves none for replace_ticket_types to add below.
  if v_ticketing_changed then
    v_ticketing_result := private.admin_set_event_ticketing(p_event_id, p_admin_id, v_mode, v_url, v_free, v_price, p_reason);
    if v_ticketing_result <> 'updated' then
      raise exception 'admin_edit_event: unexpected ticketing result %', v_ticketing_result;
    end if;
  end if;

  if v_details - 'ticketTypes' <> '{}'::jsonb then
    update public.events set
      title = p_fields ->> 'title',
      description = p_fields ->> 'description',
      category = (p_fields ->> 'category')::public.event_category,
      venue_name = p_fields ->> 'venueName',
      venue_address = p_fields ->> 'venueAddress',
      suburb = p_fields ->> 'suburb',
      starts_at = (p_fields ->> 'startsAt')::timestamptz,
      ends_at = (p_fields ->> 'endsAt')::timestamptz,
      refund_policy = v_refund_policy,
      refund_days = v_refund_days,
      state = v_state,
      time_zone = v_time_zone,
      location_source = v_location_source,
      venue_place_id = v_place_id,
      venue_lat = v_pin_lat,
      venue_lng = v_pin_lng
    where id = p_event_id;
  end if;
  if v_mode = 'sheltuh' and v_details ? 'ticketTypes' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;

  if v_details <> '{}'::jsonb then
    insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
    values (p_event_id, 'edited', p_admin_id, p_reason, v_details);
  end if;

  if v_publish then
    if not private.transition_event(p_event_id, array['draft', 'pending_review', 'rejected']::public.event_status[],
                                    'published', 'approved', p_admin_id) then
      raise exception 'admin_edit_event: the event could not be published';
    end if;
  end if;
  return 'updated';
end;
$$;

-- ---------------------------------------------------------------------------
-- record_payment_refund: as 20261111000300_refund_no_inference.sql, but a full
-- refund gives back the people of a group ticket
-- ---------------------------------------------------------------------------

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
         set quantity_sold = greatest(quantity_sold - (v_line ->> 'quantity')::integer * coalesce((v_line ->> 'admits')::integer, 1), 0)
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
-- fulfil_order_detailed: as 20261111000300_refund_no_inference.sql, but capacity
-- is taken in people and the tickets of a group are stamped with its size
-- ---------------------------------------------------------------------------

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
  v_people integer;
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
        -- group_tickets (20261120000000): capacity is in people. A line is `quantity` tickets of a type that
        -- admits `admits` people each (the snapshot made with the order; absent: 1), and takes quantity x admits.
        -- A type whose admits has changed since the order was made isn't taken (the guard below): the same
        -- refund path as a sold-out one. The tickets issued are one per person: anything else is a bug here, not
        -- an oversold order, so it isn't an SH409 and nothing is refunded for it.
        v_people := (v_line ->> 'quantity')::integer * coalesce((v_line ->> 'admits')::integer, 1);
        if coalesce((v_line ->> 'admits')::integer, 1) > 1
           and (select count(*) from jsonb_array_elements(p_tickets) t where t ->> 'ticketTypeId' = v_line ->> 'ticketTypeId')
               <> v_people then
          raise exception 'order % issues the wrong number of tickets for a group ticket', p_order_id using errcode = '22023';
        end if;

        update public.ticket_types
        set quantity_sold = quantity_sold + v_people
        where event_id = v_order.event_id
          and id = v_line ->> 'ticketTypeId'
          and admits = coalesce((v_line ->> 'admits')::integer, 1)
          and quantity_sold + v_people <= quantity_available;

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
        insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name, group_size)
        select t ->> 'ticketCode', p_order_id, v_order.event_id, t ->> 'ticketTypeId', t ->> 'ticketTypeName',
               private.order_group_size(v_order.line_items, t ->> 'ticketTypeId')
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
        insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name, seat_id, group_size)
        select t.ticket ->> 'ticketCode', p_order_id, v_order.event_id, t.ticket ->> 'ticketTypeId',
               t.ticket ->> 'ticketTypeName', k.id, private.order_group_size(v_order.line_items, t.ticket ->> 'ticketTypeId')
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

-- Triggers don't need the caller to hold execute on their function.
revoke all on function private.ticket_types_admits_frozen() from public, anon, authenticated;
revoke all on function private.order_group_size(jsonb, text) from public, anon, authenticated;
revoke all on function private.replace_ticket_types(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.admin_edit_event(uuid, uuid, timestamptz, jsonb, jsonb, boolean, text)
  from public, anon, authenticated;
revoke all on function private.record_payment_refund(text, integer, boolean, text, text, text) from public, anon, authenticated;
revoke all on function private.fulfil_order_detailed(text, text, text, jsonb) from public, anon, authenticated;
