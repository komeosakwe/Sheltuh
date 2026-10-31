-- An external event's optional "price from" (owner request, Nov 2026;
-- docs/architecture.md, "External ticketing"): an event whose tickets are sold
-- on the organiser's own site can show what they charge, as "From A$89". It is
-- the organiser's number, entered by them or an admin: Sheltüh adds no booking
-- fee to it and the checkout never reads it.
--
--   * public.events.external_price_from_cents: whole AUD cents, null when none
--     is given. Check events_external_price_from: null, or 1 to 1,000,000
--     (A$0.01 to A$10,000; lib/ticketing.ts MAX_EXTERNAL_PRICE_FROM_CENTS) on a
--     paid external event (ticketing_mode 'external' and not external_free).
--     "Free" stays the external_free flag, so there is no 0 price. Existing
--     rows are null and pass.
--   * private.create_event_draft, edit_event_draft and admin_edit_event read
--     p_fields' externalPriceFromCents (validated by lib/server/ticketing-input.ts;
--     the constraint holds whatever is sent). It is written only for a paid
--     external event, so switching to Sheltuh ticketing, or marking the event
--     free, clears it. edit_event_draft and admin_edit_event keep the stored
--     price when the key isn't sent (a caller from before this migration);
--     an explicit null clears it. Each is redefined from its latest definition
--     (20261111000100_event_venue_location.sql), everything else unchanged.
--   * private.admin_set_event_ticketing gets a seven-argument form with
--     p_price_from, logging externalPriceFromCents {old, new} in its
--     'ticketing_changed' entry. The six-argument form remains, delegating to
--     it with the stored price (cleared if the new ticketing can't have one),
--     for the deploy window. admin_edit_event calls the new form; a price
--     change alone is a ticketing change (it needs no reason: the link, which
--     does, is untouched).
--   * publish_event, submit_event and the public feeds need no change: the
--     price is a column of events, read by the API's EVENT_COLUMNS.
--
-- No index: nothing filters or sorts on it.
--
-- Access model as everywhere else: no new table; RLS stays on; the new column
-- has no grants of its own; every new or redefined function pins its
-- search_path, isn't security definer and has execute revoked from PUBLIC,
-- anon and authenticated.
--
-- Additive. The column has no default (no table rewrite); validating the check
-- scans public.events once under the ALTER's lock. Apply it before the app
-- that reads the column deploys (every event read selects it).
-- Reversible: restore create_event_draft, edit_event_draft and admin_edit_event
-- from 20261111000100_event_venue_location.sql; drop the seven-argument
-- admin_set_event_ticketing (the six-argument form then needs
-- 20261101000000_reserved_seating.sql's body back); drop the constraint and
-- the column (which loses every price entered; the app needs its previous
-- version first).

alter table public.events
  add column external_price_from_cents integer,
  add constraint events_external_price_from check (
    external_price_from_cents is null
    or (external_price_from_cents between 1 and 1000000 and ticketing_mode = 'external' and not external_free)
  );

comment on column public.events.external_price_from_cents is
  'External, paid events only: the organiser''s own "price from" in AUD cents. Shown as "From A$x"; no booking fee applies.';

-- ---------------------------------------------------------------------------
-- An admin's ticketing change
-- ---------------------------------------------------------------------------

-- As in 20261101000000_reserved_seating.sql, plus p_price_from: stored for a
-- paid external event (null otherwise) and logged as externalPriceFromCents.
create function private.admin_set_event_ticketing(
  p_event_id uuid, p_admin_id uuid, p_mode text, p_url text, p_free boolean, p_price_from integer, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_details jsonb := '{}'::jsonb;
  v_map jsonb;
  v_price integer := case when p_mode = 'external' and not p_free then p_price_from end;
begin
  select e.ticketing_mode, e.external_ticket_url, e.external_free, e.external_price_from_cents into v_event
    from public.events e where e.id = p_event_id
     for no key update;
  if not found then
    return 'not_found';
  end if;

  if v_event.ticketing_mode is distinct from p_mode then
    v_details := v_details || jsonb_build_object('ticketingMode', jsonb_build_object('old', v_event.ticketing_mode, 'new', p_mode));
  end if;
  if v_event.external_ticket_url is distinct from p_url then
    v_details := v_details
      || jsonb_build_object('externalTicketUrl', jsonb_build_object('old', v_event.external_ticket_url, 'new', p_url));
  end if;
  if v_event.external_free is distinct from p_free then
    v_details := v_details || jsonb_build_object('externalFree', jsonb_build_object('old', v_event.external_free, 'new', p_free));
  end if;
  if v_event.external_price_from_cents is distinct from v_price then
    v_details := v_details
      || jsonb_build_object('externalPriceFromCents', jsonb_build_object('old', v_event.external_price_from_cents, 'new', v_price));
  end if;
  if v_details = '{}'::jsonb then
    return 'unchanged';
  end if;

  if p_mode = 'external' and v_event.ticketing_mode <> 'external' then
    if exists (select 1 from public.orders o where o.event_id = p_event_id) then
      return 'has_orders';
    end if;
    v_map := private.seat_map_summary(p_event_id);
    if v_map is not null then
      perform private.clear_seat_map(p_event_id);
      v_details := v_details || jsonb_build_object('seatMap', jsonb_build_object('old', v_map, 'new', null));
    end if;
    delete from public.ticket_types t where t.event_id = p_event_id;
  end if;

  update public.events e set
    ticketing_mode = p_mode,
    external_ticket_url = p_url,
    external_free = p_free,
    external_price_from_cents = v_price,
    is_free = case when p_mode = 'external' then p_free
                   else exists (select 1 from public.ticket_types t where t.event_id = p_event_id)
                        and not exists (select 1 from public.ticket_types t where t.event_id = p_event_id and t.price_cents > 0)
              end
  where e.id = p_event_id;

  insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
  values (p_event_id, 'ticketing_changed', p_admin_id, p_reason, v_details);
  return 'updated';
end;
$$;

-- The six-argument form (a caller from before this migration): the stored
-- price is kept where the new ticketing can still have one.
create or replace function private.admin_set_event_ticketing(
  p_event_id uuid, p_admin_id uuid, p_mode text, p_url text, p_free boolean, p_reason text
) returns text
language sql
set search_path = ''
as $$
  select private.admin_set_event_ticketing(
    p_event_id, p_admin_id, p_mode, p_url, p_free,
    (select e.external_price_from_cents from public.events e where e.id = p_event_id),
    p_reason)
$$;

-- ---------------------------------------------------------------------------
-- Creating, the organiser's edit and an admin's edit
-- ---------------------------------------------------------------------------

-- As in 20261111000100_event_venue_location.sql, plus externalPriceFromCents.
create or replace function private.create_event_draft(
  p_organiser_id uuid, p_slug text, p_fields jsonb, p_ticket_types jsonb
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
begin
  insert into public.events
    (organiser_id, slug, title, description, category, venue_name, venue_address, suburb, starts_at, ends_at,
     ticketing_mode, external_ticket_url, external_free, is_free, refund_policy, refund_days, state, time_zone,
     location_source, venue_place_id, venue_lat, venue_lng, external_price_from_cents)
  values (
    p_organiser_id,
    p_slug,
    p_fields ->> 'title',
    p_fields ->> 'description',
    (p_fields ->> 'category')::public.event_category,
    p_fields ->> 'venueName',
    p_fields ->> 'venueAddress',
    p_fields ->> 'suburb',
    (p_fields ->> 'startsAt')::timestamptz,
    (p_fields ->> 'endsAt')::timestamptz,
    v_mode,
    p_fields ->> 'externalTicketUrl',
    v_free,
    v_mode = 'external' and v_free,
    coalesce(p_fields ->> 'refundPolicy', 'no_change_of_mind'),
    (p_fields ->> 'refundDays')::integer,
    coalesce(p_fields ->> 'state', 'VIC'),
    coalesce(p_fields ->> 'timeZone', 'Australia/Melbourne'),
    coalesce(p_fields ->> 'locationSource', 'legacy'),
    p_fields ->> 'placeId',
    (p_fields ->> 'pinLat')::double precision,
    (p_fields ->> 'pinLng')::double precision,
    case when v_mode = 'external' and not v_free then (p_fields ->> 'externalPriceFromCents')::integer end
  )
  returning id into v_id;

  perform private.replace_ticket_types(v_id, p_ticket_types);
  return v_id;
end;
$$;

-- As in 20261111000100_event_venue_location.sql, plus the price (see the header).
create or replace function private.edit_event_draft(
  p_event_id uuid, p_organiser_id uuid, p_fields jsonb, p_ticket_types jsonb
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_url text := p_fields ->> 'externalTicketUrl';
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
  v_refund_policy text;
  v_refund_days integer;
  v_location_sent boolean := p_fields ? 'locationSource';
  v_price integer;
begin
  select e.status, e.ticketing_mode, e.external_ticket_url, e.refund_policy, e.refund_days, e.state, e.time_zone,
         e.location_source, e.venue_place_id, e.venue_lat, e.venue_lng, e.external_price_from_cents
    into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if (v_event.ticketing_mode is distinct from v_mode or v_event.external_ticket_url is distinct from v_url)
     and exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'ticketing_frozen';
  end if;

  if p_fields ? 'refundPolicy' then
    v_refund_policy := p_fields ->> 'refundPolicy';
    v_refund_days := (p_fields ->> 'refundDays')::integer;
  else
    v_refund_policy := v_event.refund_policy;
    v_refund_days := v_event.refund_days;
  end if;
  if private.refund_policy_tightens(v_event.refund_policy, v_event.refund_days, v_refund_policy, v_refund_days)
     and private.event_has_payable_orders(p_event_id) then
    return 'refund_policy_tightened';
  end if;

  -- The price is the organiser's, for a paid external event only. Sent: as sent (null clears it); not sent
  -- (a caller from before this migration): kept.
  v_price := case when v_mode <> 'external' or v_free then null
                  when p_fields ? 'externalPriceFromCents' then (p_fields ->> 'externalPriceFromCents')::integer
                  else v_event.external_price_from_cents end;

  if v_mode = 'external' then
    perform private.clear_seat_map(p_event_id);
    perform private.replace_ticket_types(p_event_id, '[]'::jsonb);
  end if;

  update public.events set
    title = p_fields ->> 'title',
    description = p_fields ->> 'description',
    category = (p_fields ->> 'category')::public.event_category,
    venue_name = p_fields ->> 'venueName',
    venue_address = p_fields ->> 'venueAddress',
    suburb = p_fields ->> 'suburb',
    starts_at = (p_fields ->> 'startsAt')::timestamptz,
    ends_at = (p_fields ->> 'endsAt')::timestamptz,
    ticketing_mode = v_mode,
    external_ticket_url = v_url,
    external_free = v_free,
    external_price_from_cents = v_price,
    is_free = case when v_mode = 'external' then v_free else is_free end,
    refund_policy = v_refund_policy,
    refund_days = v_refund_days,
    state = coalesce(p_fields ->> 'state', v_event.state),
    time_zone = coalesce(p_fields ->> 'timeZone', v_event.time_zone),
    location_source = case when v_location_sent then p_fields ->> 'locationSource' else v_event.location_source end,
    venue_place_id = case when v_location_sent then p_fields ->> 'placeId' else v_event.venue_place_id end,
    venue_lat = case when v_location_sent then (p_fields ->> 'pinLat')::double precision else v_event.venue_lat end,
    venue_lng = case when v_location_sent then (p_fields ->> 'pinLng')::double precision else v_event.venue_lng end
  where id = p_event_id;

  if v_mode <> 'external' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;
  return 'updated';
end;
$$;

-- As in 20261111000100_event_venue_location.sql, plus the price: a change to it is a ticketing change.
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
  -- request's shape (an empty description left out), in display order.
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
               'feePolicy', t.fee_policy::text, 'quantityAvailable', t.quantity_available)) order by t.position)
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
               'quantityAvailable', (x.e ->> 'quantityAvailable')::integer)) order by x.ord)
        from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)), '[]'::jsonb) end);
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
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.admin_set_event_ticketing(uuid, uuid, text, text, boolean, integer, text)
  from public, anon, authenticated;
revoke all on function private.admin_set_event_ticketing(uuid, uuid, text, text, boolean, text)
  from public, anon, authenticated;
revoke all on function private.create_event_draft(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.edit_event_draft(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.admin_edit_event(uuid, uuid, timestamptz, jsonb, jsonb, boolean, text)
  from public, anon, authenticated;
