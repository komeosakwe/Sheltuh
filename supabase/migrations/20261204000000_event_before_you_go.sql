-- "Before you go" (owner request, Nov 2026; docs/architecture.md, "Before
-- you go"): a short plain-text note the organiser writes for the people going
-- to their event ("Doors open 5:00 pm · last entry 8:00 pm."), for a box in
-- the ticket email, the reminder, the free-ticket confirmation and the buyer's
-- ticket page. Data only here: those displays come with their own changes.
--
--   * public.events.before_you_go: text, null when there is none. Check
--     events_before_you_go_check holds what the API stores (lib/before-you-go.ts,
--     parsed by lib/server/event-input.ts parseBeforeYouGo), whatever is sent:
--     1 to 500 characters (char_length: code points); no leading or trailing
--     space, tab or line break; at most one blank line in a row; at most 5
--     lines of text (a blank line between them doesn't count); no control
--     character but tab and line feed (so no \r: line endings are \n). Plain
--     text: the API refuses web and email addresses, and stores anything
--     HTML-like as the characters typed; every display escapes it. Existing
--     rows are null and pass.
--   * private.create_event_draft, edit_event_draft and admin_edit_event read
--     p_fields' beforeYouGo: create stores it (absent: null); both edits keep
--     the stored note when the key isn't sent (a caller from before this
--     migration: the deploy window, or a client that never shows the field)
--     and clear it with an explicit null. admin_edit_event compares and logs
--     it with the event's other fields (changes.beforeYouGo, old and new, in
--     its 'edited' entry). Each is redefined from its latest definition
--     (create_event_draft and edit_event_draft from
--     20261114000000_external_price.sql, admin_edit_event from
--     20261120000000_group_tickets.sql), everything else unchanged.
--   * The review rules don't change: an organiser edits only a draft or a
--     rejected event (edit_event_draft's not_editable), so the note goes
--     through the same publish or review as the description; an admin's edit
--     of a published event is the admin's own, as for any other field.
--   * publish_event, submit_event, admin_create_event (which calls
--     create_event_draft) and the reads need no change: the API's
--     EVENT_COLUMNS selects the column.
--
-- No index: nothing filters or sorts on it.
--
-- Access model as everywhere else: no new table; RLS stays on; the column has
-- no grants of its own; every redefined function pins its search_path, isn't
-- security definer and has execute revoked from PUBLIC, anon and
-- authenticated.
--
-- Additive. The column has no default (no table rewrite); validating the check
-- scans public.events once under the ALTER's lock (every row is null). Apply
-- it before the app that reads the column deploys (every event read selects
-- it). The previous app keeps working against it: it never sends the key, so
-- its creates store null and its edits keep the stored note. Not destructive.
-- Reversible: restore create_event_draft and edit_event_draft from
-- 20261114000000_external_price.sql and admin_edit_event from
-- 20261120000000_group_tickets.sql, then drop the constraint and the column
-- (which loses every note organisers wrote; deploy an app that doesn't select
-- it first).

alter table public.events
  add column before_you_go text,
  add constraint events_before_you_go_check check (
    before_you_go is null
    or (char_length(before_you_go) between 1 and 500
        and before_you_go = btrim(before_you_go, E' \t\n')
        and strpos(before_you_go, E'\n\n\n') = 0
        -- Every control character but tab and line feed (\r included).
        and before_you_go !~ '[\x01-\x08\x0b-\x1f\x7f]'
        -- Lines of text: what lies between runs of line breaks.
        and cardinality(regexp_split_to_array(before_you_go, E'\n+')) <= 5)
  );

comment on column public.events.before_you_go is
  'The organiser''s "Before you go" note for people going: plain text, at most 5 lines and 500 characters; null for none.';

-- ---------------------------------------------------------------------------
-- Creating, the organiser's edit and an admin's edit
-- ---------------------------------------------------------------------------

-- As in 20261114000000_external_price.sql, plus beforeYouGo (absent: null).
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
     location_source, venue_place_id, venue_lat, venue_lng, external_price_from_cents, before_you_go)
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
    case when v_mode = 'external' and not v_free then (p_fields ->> 'externalPriceFromCents')::integer end,
    p_fields ->> 'beforeYouGo'
  )
  returning id into v_id;

  perform private.replace_ticket_types(v_id, p_ticket_types);
  return v_id;
end;
$$;

-- As in 20261114000000_external_price.sql, plus beforeYouGo: sent, as sent (null clears it); not sent, kept.
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
         e.location_source, e.venue_place_id, e.venue_lat, e.venue_lng, e.external_price_from_cents, e.before_you_go
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
    venue_lng = case when v_location_sent then (p_fields ->> 'pinLng')::double precision else v_event.venue_lng end,
    before_you_go = case when p_fields ? 'beforeYouGo' then p_fields ->> 'beforeYouGo' else v_event.before_you_go end
  where id = p_event_id;

  if v_mode <> 'external' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;
  return 'updated';
end;
$$;

-- As in 20261120000000_group_tickets.sql, plus beforeYouGo: compared, logged and written with the other
-- fields; not sent, the stored note (so no change is seen).
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
  v_before_you_go text;
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
  -- As edit_event_draft reads it: sent, as sent (null clears it); not sent, kept.
  v_before_you_go := case when p_fields ? 'beforeYouGo' then p_fields ->> 'beforeYouGo' else v_event.before_you_go end;

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
    'beforeYouGo', v_event.before_you_go,
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
    'beforeYouGo', v_before_you_go,
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
      venue_lng = v_pin_lng,
      before_you_go = v_before_you_go
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

revoke all on function private.create_event_draft(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.edit_event_draft(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.admin_edit_event(uuid, uuid, timestamptz, jsonb, jsonb, boolean, text)
  from public, anon, authenticated;
