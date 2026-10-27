-- Every event gets a state and an IANA time zone (Australia-wide events, step
-- S3; docs/architecture.md, "Events: state and time zone"). An event's own
-- times (its start and end as shown and as entered, its emails, its wallet
-- passes, the feed's "on or after" date) are read in its zone; everything
-- else stays in the platform's (Australia/Melbourne: analytics days,
-- trending, rate-limit days, retention, admin and message times).
--
--   * public.events.state: one of the ABS's states and territories (NSW, VIC,
--     QLD, SA, WA, TAS, NT, ACT, and OT for the other territories), default
--     'VIC'. public.events.time_zone: the zone its times are entered and
--     shown in, default 'Australia/Melbourne'. Every existing event was
--     entered in Melbourne time (the only zone until now), so the defaults
--     are what existing rows mean.
--   * events_place_check: the zone must be one the state uses. It mirrors
--     ZONES_BY_STATE in lib/time-zones.ts exactly (tests/server/event-place.test.ts
--     compares them): change both together.
--   * private.create_event_draft, edit_event_draft and admin_edit_event read
--     p_fields' state and timeZone (already validated by
--     lib/server/event-input.ts; the constraint holds whatever is sent).
--     Without them, create uses the defaults and the edits keep the stored
--     values, so a caller from before this migration (the deploy window)
--     changes nothing. admin_edit_event logs a change of either in its
--     'edited' entry (changes.state, changes.timeZone: old and new). Each is
--     redefined from its latest definition (20261109000100_event_refund_policy.sql),
--     with everything else unchanged: same signatures, search_path pinned,
--     execute revoked again.
--
-- private.update_event_draft (the earlier boolean form, kept for the deploy
-- window and no longer called) doesn't write the columns, so it keeps the
-- stored values: no change needed. admin_create_event goes through
-- create_event_draft. admin_set_event_ticketing doesn't touch them.
--
-- No new index: the feed's "on or after" filter compares the start's local
-- date, `(starts_at at time zone time_zone)::date`, which no index serves,
-- so the API adds a coarse bound a day earlier on starts_at itself (no
-- Australian zone is more than a day from UTC), which
-- events_status_starts_idx (status, starts_at, id) serves. Nothing filters
-- or sorts on state yet.
--
-- Additive. The two columns are added with constant defaults (no table
-- rewrite in Postgres 11+); validating the check scans public.events once
-- under the ALTER's lock. Apply it before the app that reads the columns
-- deploys (every event read selects them). The previous app keeps working
-- against it. Reversible: restore the three functions from
-- 20261109000100_event_refund_policy.sql, then drop the constraint and the
-- two columns (which loses every non-Victorian event's place: their times
-- would then read as Melbourne's; the app needs its previous version first).

alter table public.events
  add column state text not null default 'VIC',
  add column time_zone text not null default 'Australia/Melbourne',
  add constraint events_place_check check (
    (state = 'VIC' and time_zone = 'Australia/Melbourne')
    or (state = 'NSW' and time_zone in ('Australia/Sydney', 'Australia/Broken_Hill', 'Australia/Lord_Howe'))
    or (state = 'ACT' and time_zone = 'Australia/Sydney')
    or (state = 'QLD' and time_zone = 'Australia/Brisbane')
    or (state = 'SA' and time_zone = 'Australia/Adelaide')
    or (state = 'WA' and time_zone in ('Australia/Perth', 'Australia/Eucla'))
    or (state = 'TAS' and time_zone = 'Australia/Hobart')
    or (state = 'NT' and time_zone = 'Australia/Darwin')
    or (state = 'OT' and time_zone in ('Indian/Christmas', 'Indian/Cocos', 'Pacific/Norfolk', 'Australia/Sydney'))
  );

-- ---------------------------------------------------------------------------
-- Creating
-- ---------------------------------------------------------------------------

-- As in 20261109000100_event_refund_policy.sql, plus state (default 'VIC')
-- and timeZone (default 'Australia/Melbourne').
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
     ticketing_mode, external_ticket_url, external_free, is_free, refund_policy, refund_days, state, time_zone)
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
    coalesce(p_fields ->> 'timeZone', 'Australia/Melbourne')
  )
  returning id into v_id;

  perform private.replace_ticket_types(v_id, p_ticket_types);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The organiser's edit
-- ---------------------------------------------------------------------------

-- As in 20261109000100_event_refund_policy.sql, plus state and timeZone:
-- each saved when sent, the stored value kept when absent.
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
begin
  select e.status, e.ticketing_mode, e.external_ticket_url, e.refund_policy, e.refund_days, e.state, e.time_zone
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
    time_zone = coalesce(p_fields ->> 'timeZone', v_event.time_zone)
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

-- As in 20261109000100_event_refund_policy.sql, plus state and timeZone (as
-- edit_event_draft reads them: each kept when absent). A change of either is
-- logged in the 'edited' entry (state, timeZone: old and new).
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
      time_zone = v_time_zone
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

revoke all on function private.create_event_draft(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.edit_event_draft(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.admin_edit_event(uuid, uuid, timestamptz, jsonb, jsonb, boolean, text)
  from public, anon, authenticated;
