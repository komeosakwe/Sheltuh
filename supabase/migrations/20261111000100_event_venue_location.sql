-- An event's venue location (owner decisions A-D1 to A-D3, 27 Oct 2026;
-- docs/architecture.md, "Venue location"). The organiser finds the venue with
-- Google Places (through the API's own proxy, lib/server/places.ts) or drops a
-- pin on our own map, and confirms the pin either way.
--
--   * public.events.location_source: 'legacy' (the default: every existing
--     event, and any saved by a client that sends no location), 'places' (a
--     Google place the organiser picked) or 'manual_pin' (no Google place: the
--     organiser's pin alone).
--   * public.events.venue_place_id: the Google place id ('places' only).
--     Google's terms let a place id be stored indefinitely. Nothing else from
--     Google is stored: the venue's name, address and suburb are what the
--     organiser confirmed (prefilled from Google, editable), as before.
--   * public.events.venue_lat / venue_lng: the ORGANISER'S OWN PIN, never
--     Google's coordinates (Google forbids caching Places lat/lng beyond 30
--     days and using them on a non-Google map; the API never even requests
--     them). Required for 'manual_pin', optional for 'places' (a draft not yet
--     pinned), absent for 'legacy'.
--   * Checks: the pin is both columns or neither (events_venue_pin_pair); a pin
--     lies within AUSTRALIA_BOUNDS (lib/geo.ts: south -45, north -8, west 95,
--     east 170; events_venue_pin_bounds; tests/server/event-location.test.ts
--     checks the two agree: change both together); the place id's shape
--     (events_venue_place_id_shape); and each source's columns
--     (events_location_source_check).
--   * private.create_event_draft, edit_event_draft and admin_edit_event read
--     p_fields' locationSource, placeId, pinLat and pinLng (already validated
--     by lib/server/event-input.ts, and the place id checked with Google by the
--     handler when it's new; the constraints hold whatever is sent). Without
--     locationSource, create writes 'legacy' and the edits keep the stored
--     location, so a caller from before this migration (the deploy window)
--     changes nothing. admin_edit_event logs a change in its 'edited' entry
--     (changes.location: old and new {source, placeId, pin}, null for legacy).
--     Each is redefined from its latest definition
--     (20261110000000_event_place_time_zone.sql), with everything else
--     unchanged: same signatures, search_path pinned, execute revoked again.
--   * private.publish_event (from 20261111000000_event_publish_now.sql) and
--     private.submit_event (from 20261109000000_paid_events_need_payouts.sql)
--     refuse 'location_required' (nothing written) for an event without the
--     organiser's pin: going live, or into the review queue, needs a confirmed
--     location (a Google place with a pin, or a manual pin). Checked after the
--     payouts rule, so an event missing both is told about payouts first. An
--     admin's approval, create or publish doesn't require it (admins can list
--     an event with its address alone).
--   * private.event_location_json: the {source, placeId, pin} object (null
--     for legacy) admin_edit_event logs. Immutable helper.
--
-- private.update_event_draft (the earlier boolean form, kept for the deploy
-- window and no longer called) doesn't write the columns, so it keeps the
-- stored values. admin_create_event goes through create_event_draft.
--
-- No index: nothing filters or sorts on the location yet.
--
-- Access model as everywhere else: no new table; RLS stays on; the new
-- columns have no grants of their own; every new or redefined function pins
-- its search_path, isn't security definer and has execute revoked from
-- PUBLIC, anon and authenticated.
--
-- Additive. The columns are added with a constant default or none (no table
-- rewrite in Postgres 11+); validating the checks scans public.events once
-- under the ALTER's lock (every existing row is 'legacy' with nulls, so they
-- pass). Apply it before the app that reads the columns deploys (every event
-- read selects them). Deploy window: the previous app keeps working against
-- it, except that its /submit route answers 200 without submitting an event
-- that has no pin (it doesn't know the new 'location_required' result; the
-- event stays a draft and its returned status says so). Production isn't live
-- yet, so ship the two together.
-- Reversible: restore create_event_draft, edit_event_draft and
-- admin_edit_event from 20261110000000_event_place_time_zone.sql,
-- publish_event from 20261111000000_event_publish_now.sql and submit_event
-- from 20261109000000_paid_events_need_payouts.sql; drop
-- private.event_location_json, the four constraints and the four columns
-- (which loses every event's place id and pin; the app needs its previous
-- version first).

alter table public.events
  add column location_source text not null default 'legacy',
  add column venue_place_id text,
  add column venue_lat double precision,
  add column venue_lng double precision,
  add constraint events_venue_pin_pair check ((venue_lat is null) = (venue_lng is null)),
  -- AUSTRALIA_BOUNDS (lib/geo.ts). NaN and infinities are outside every range.
  add constraint events_venue_pin_bounds check (
    venue_lat is null or (venue_lat between -45 and -8 and venue_lng between 95 and 170)
  ),
  -- lib/server/places.ts PLACE_ID_PATTERN, ^[A-Za-z0-9_-]{16,256}$ (Postgres caps a regex repeat at 255,
  -- so the length is checked on its own).
  add constraint events_venue_place_id_shape check (
    char_length(venue_place_id) between 16 and 256 and venue_place_id ~ '^[A-Za-z0-9_-]+$'
  ),
  add constraint events_location_source_check check (
    (location_source = 'legacy' and venue_place_id is null and venue_lat is null)
    or (location_source = 'places' and venue_place_id is not null)
    or (location_source = 'manual_pin' and venue_place_id is null and venue_lat is not null)
  );

comment on column public.events.venue_place_id is
  'Google place id the organiser linked (location_source places). The only Google Places data stored.';
comment on column public.events.venue_lat is
  'The organiser''s own pin (latitude). Never Google''s coordinates: the API never requests them.';
comment on column public.events.venue_lng is
  'The organiser''s own pin (longitude). Never Google''s coordinates: the API never requests them.';

-- ---------------------------------------------------------------------------
-- The logged shape
-- ---------------------------------------------------------------------------

-- {source, placeId, pin: {lat, lng}} as the API names them, absent parts left
-- out; null for 'legacy' (no location).
create function private.event_location_json(
  p_source text, p_place_id text, p_lat double precision, p_lng double precision
) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_source is null or p_source = 'legacy' then null else jsonb_strip_nulls(jsonb_build_object(
    'source', p_source,
    'placeId', p_place_id,
    'pin', case when p_lat is not null and p_lng is not null then jsonb_build_object('lat', p_lat, 'lng', p_lng) end)) end
$$;

-- ---------------------------------------------------------------------------
-- Creating
-- ---------------------------------------------------------------------------

-- As in 20261110000000_event_place_time_zone.sql, plus locationSource
-- (default 'legacy'), placeId, pinLat and pinLng.
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
     location_source, venue_place_id, venue_lat, venue_lng)
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
    (p_fields ->> 'pinLng')::double precision
  )
  returning id into v_id;

  perform private.replace_ticket_types(v_id, p_ticket_types);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The organiser's edit
-- ---------------------------------------------------------------------------

-- As in 20261110000000_event_place_time_zone.sql, plus the location: saved
-- when locationSource is sent (with placeId, pinLat and pinLng as sent: absent
-- ones are null), the stored location kept when it's absent.
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
begin
  select e.status, e.ticketing_mode, e.external_ticket_url, e.refund_policy, e.refund_days, e.state, e.time_zone,
         e.location_source, e.venue_place_id, e.venue_lat, e.venue_lng
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

-- ---------------------------------------------------------------------------
-- An admin's edit
-- ---------------------------------------------------------------------------

-- As in 20261110000000_event_place_time_zone.sql, plus the location (as
-- edit_event_draft reads it: kept when locationSource is absent). A change is
-- logged in the 'edited' entry (changes.location: old and new, as
-- private.event_location_json shapes them).
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

  v_ticketing_changed := v_event.ticketing_mode is distinct from v_mode
    or v_event.external_ticket_url is distinct from v_url
    or v_event.external_free is distinct from v_free;
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
    v_ticketing_result := private.admin_set_event_ticketing(p_event_id, p_admin_id, v_mode, v_url, v_free, p_reason);
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
-- The organiser's submit (the review path)
-- ---------------------------------------------------------------------------

-- As in 20261109000000_paid_events_need_payouts.sql, plus:
--   'location_required'  no organiser's pin (location_source legacy, or a
--                        Google place not yet pinned): nothing written
create or replace function private.submit_event(p_event_id uuid, p_organiser_id uuid, p_actor_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_payouts boolean;
  v_status text;
  v_event record;
begin
  select o.payouts_enabled, o.status::text into v_payouts, v_status
    from public.organisers o where o.id = p_organiser_id for share;
  -- Re-checked under the lock: a takedown that committed after the handler's
  -- own (unlocked) check must win.
  if not found or v_status <> 'approved' then
    return 'not_found';
  end if;
  select e.status, e.ticketing_mode, e.venue_lat into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_submittable';
  end if;
  if not v_payouts and v_event.ticketing_mode = 'sheltuh'
     and exists (select 1 from public.ticket_types t where t.event_id = p_event_id and t.price_cents > 0) then
    return 'payouts_required';
  end if;
  if v_event.venue_lat is null then
    return 'location_required';
  end if;

  if not private.transition_event(p_event_id, array['draft', 'rejected']::public.event_status[], 'pending_review',
                                  'submitted', p_actor_id, null, p_organiser_id) then
    raise exception 'submit_event: the locked event could not be submitted';
  end if;
  return 'submitted';
end;
$$;

-- ---------------------------------------------------------------------------
-- The organiser's publish
-- ---------------------------------------------------------------------------

-- As in 20261111000000_event_publish_now.sql, plus, after the payouts rule:
--   'location_required'  no organiser's pin (location_source legacy, or a
--                        Google place not yet pinned): nothing written
create or replace function private.publish_event(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_external_url text, p_force_review boolean
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_org record;
  v_event record;
  v_last_decision public.moderation_action;
  v_review boolean;
begin
  select o.status::text as status, o.payouts_enabled, o.event_review_required, o.owner_user_id
    into v_org
    from public.organisers o where o.id = p_organiser_id for share;
  -- Re-checked under the lock: a takedown that committed after the API's own
  -- (unlocked) check must win.
  if not found or v_org.status <> 'approved' or v_org.owner_user_id is distinct from p_actor_id then
    return 'not_found';
  end if;
  select e.status, e.ends_at, e.ticketing_mode, e.venue_lat,
         case when e.ticketing_mode = 'external' then e.external_ticket_url end as external_url
    into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status = 'published' then
    return 'already_published';
  end if;
  if v_event.status = 'pending_review' then
    return 'in_review';
  end if;
  if v_event.ends_at <= now() then
    return 'ended';
  end if;
  if not v_org.payouts_enabled and v_event.ticketing_mode = 'sheltuh'
     and exists (select 1 from public.ticket_types t where t.event_id = p_event_id and t.price_cents > 0) then
    return 'payouts_required';
  end if;
  if v_event.venue_lat is null then
    return 'location_required';
  end if;
  if v_event.external_url is distinct from p_external_url then
    return 'stale';
  end if;

  -- The latest admin decision about it (event_moderation_log_event_idx, newest first).
  select l.action into v_last_decision
    from public.event_moderation_log l
   where l.event_id = p_event_id and l.action in ('approved', 'rejected', 'unpublished')
   order by l.id desc
   limit 1;

  v_review := v_org.event_review_required
    or v_event.status = 'rejected'
    or (v_last_decision is not null and v_last_decision in ('rejected', 'unpublished'))
    or exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id)
    or coalesce(p_force_review, false);
  -- The caps last (a publish going to review anyway takes no slot), the
  -- account's first (a refusal there takes no platform slot).
  if not v_review then
    v_review := not private.take_rate_limit(p_actor_id, 'event_publishes', 10, interval '24 hours');
  end if;
  if not v_review then
    v_review := not private.take_platform_rate_limit('event_self_publishes_daily', 100, interval '24 hours');
  end if;

  if v_review then
    if not private.transition_event(p_event_id, array['draft', 'rejected']::public.event_status[], 'pending_review',
                                    'submitted', p_actor_id, null, p_organiser_id) then
      raise exception 'publish_event: the locked event could not be submitted';
    end if;
    return 'submitted';
  end if;

  if not private.transition_event(p_event_id, array['draft', 'rejected']::public.event_status[], 'published',
                                  'approved', p_actor_id, null, p_organiser_id) then
    raise exception 'publish_event: the locked event could not be published';
  end if;
  perform private.queue_review_email('event_published', p_event_id);
  return 'published';
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.event_location_json(text, text, double precision, double precision)
  from public, anon, authenticated;
revoke all on function private.create_event_draft(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.edit_event_draft(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.admin_edit_event(uuid, uuid, timestamptz, jsonb, jsonb, boolean, text)
  from public, anon, authenticated;
revoke all on function private.submit_event(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.publish_event(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
