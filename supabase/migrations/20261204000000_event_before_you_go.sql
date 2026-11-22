-- "Before you go" (owner request, Nov 2026; docs/architecture.md, "Before
-- you go"): the organiser's short rows for the people going to their event,
-- a label and a value each ("Entry": "7:30 pm – 10:30 pm", "Age": "18+ ·
-- Photo ID required", "Extras": "Free earplugs at the bar"), for the event
-- page, the ticket email, the reminder, the free-ticket confirmation and the
-- buyer's ticket page. Data only here: those displays come with their own
-- changes.
--
--   * public.events.before_you_go: jsonb, null when there are none. Check
--     events_before_you_go_check (private.before_you_go_ok) holds what the
--     API stores (lib/before-you-go.ts, parsed by lib/server/event-input.ts
--     parseBeforeYouGo), whatever is sent: an array of 1 to 5 objects, each
--     with exactly the keys label and value, both strings
--     (private.before_you_go_text_ok): label 1 to 20 and value 1 to 80
--     characters (char_length: code points, as the API counts them after
--     NFC); no leading or trailing space and no two spaces in a row (the API
--     collapses whitespace); no C0 or C1 control character (U+0000-U+001F,
--     U+007F-U+009F: so no tab, CR, LF or U+0085) and no line or paragraph
--     separator (U+2028, U+2029): one line each; none of the invisible or
--     text-direction format characters the API refuses (\p{Cf}: soft hyphen,
--     Arabic letter mark, Mongolian vowel separator, zero-width space,
--     LRM/RLM, the bidi embeddings, overrides and isolates, word joiner and
--     invisible operators, BOM, the prepended concatenation marks) and no
--     other default-ignorable character (Unicode's
--     Default_Ignorable_Code_Point: the Hangul fillers, which are letters, the
--     combining grapheme joiner, the variation selectors), nor U+2800 BRAILLE
--     PATTERN BLANK (a symbol that renders as nothing). Allowed, as the API
--     allows them: U+200C and U+200D (joiners emoji and several scripts need),
--     VS16 (U+FE0F) after a character that can be an emoji (a red heart
--     emoji), and the tag characters in an emoji tag sequence (a subdivision
--     flag). An empty array is stored as null, never kept. Plain text: the
--     API refuses web and email addresses, and stores anything HTML-like as
--     the characters typed; every display escapes it. Existing rows are null
--     and pass.
--   * The two helpers are immutable SQL functions (a check can't hold a
--     subquery), structural only: tightening them later with create or
--     replace wouldn't re-check stored rows, but any later update of such a
--     row would fail, so change them only with a migration that checks the
--     stored rows first. Like events_external_ticket_url_valid before it
--     (20261022000000_external_ticketing.sql), the check calls a private
--     function whose execute is revoked from clients.
--   * private.create_event_draft, edit_event_draft and admin_edit_event read
--     p_fields' beforeYouGo (jsonb): create stores it (absent: null); both
--     edits keep the stored rows when the key isn't sent (a caller from
--     before this migration: the deploy window, or a client that never shows
--     the field) and clear them with an explicit null or []: JSON null and
--     [] are both stored as SQL null (private.before_you_go_of), never as
--     jsonb 'null' (which the check refuses). admin_edit_event compares and
--     logs them with the event's other fields (changes.beforeYouGo, the old
--     and new arrays, in its 'edited' entry). Each is redefined from its
--     latest definition (create_event_draft and edit_event_draft from
--     20261114000000_external_price.sql, admin_edit_event from
--     20261120000000_group_tickets.sql), everything else unchanged.
--   * The review rules don't change: an organiser edits only a draft or a
--     rejected event (edit_event_draft's not_editable), so the rows go
--     through the same publish or review as the description; an admin's edit
--     of a published event is the admin's own, as for any other field.
--   * publish_event, submit_event, admin_create_event (which calls
--     create_event_draft) and the reads need no change: the API's
--     EVENT_COLUMNS selects the column.
--
-- This file was rewritten in place (rows instead of free text, Nov 2026)
-- before it was applied anywhere. A database that somehow has the earlier
-- text version (before_you_go text) must drop that column first; nothing
-- outside the branch ever wrote to it.
--
-- No index: nothing filters or sorts on it.
--
-- Access model as everywhere else: no new table; RLS stays on; the column has
-- no grants of its own; every new or redefined function pins its search_path,
-- isn't security definer and has execute revoked from PUBLIC, anon and
-- authenticated.
--
-- Additive. The column has no default (no table rewrite); validating the check
-- scans public.events once under the ALTER's lock (every row is null). Apply
-- it before the app that reads the column deploys (every event read selects
-- it). The previous app keeps working against it: it never sends the key, so
-- its creates store null and its edits keep the stored rows. Not destructive.
-- Reversible: restore create_event_draft and edit_event_draft from
-- 20261114000000_external_price.sql and admin_edit_event from
-- 20261120000000_group_tickets.sql, then drop the constraint, the column
-- (which loses every row organisers wrote; deploy an app that doesn't select
-- it first) and the functions private.before_you_go_of,
-- private.before_you_go_ok and private.before_you_go_text_ok.

-- ---------------------------------------------------------------------------
-- The rules
-- ---------------------------------------------------------------------------

-- One label or value. Escapes only (\uXXXX and \UXXXXXXXX are fixed-width),
-- so no invisible character is ever typed into this file.
create function private.before_you_go_text_ok(p_text text, p_max integer) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is not null
     and char_length(p_text) between 1 and p_max
     and p_text = btrim(p_text)
     and strpos(p_text, '  ') = 0
     -- Checked with each emoji tag sequence (U+1F3F4, 1 to 8 tag letters or
     -- digits, U+E007F: the flags of England, Scotland and Wales) taken out
     -- (a space in its place), as the API checks it. Refused: C0 and C1
     -- controls (tab, CR, LF and U+0085 included: one line); the line and
     -- paragraph separators; the format characters the API refuses (\p{Cf}
     -- but U+200C and U+200D); every other Default_Ignorable_Code_Point
     -- (U+034F, the Hangul fillers U+115F, U+1160, U+3164 and U+FFA0, U+17B4
     -- and U+17B5, U+180B-U+180F, U+2065, the variation selectors
     -- U+FE00-U+FE0E, U+FFF0-U+FFF8, U+E0000-U+E0FFF, tags and the
     -- supplementary variation selectors included); U+2800 BRAILLE PATTERN
     -- BLANK (renders as nothing); and VS16 (U+FE0F) first or
     -- after anything that can't be an emoji (every emoji is #, *, 0-9, (c),
     -- (R) or from U+203C up; the API asks for \p{Emoji} itself).
     and regexp_replace(p_text, '\U0001F3F4[\U000E0030-\U000E0039\U000E0061-\U000E007A]{1,8}\U000E007F', ' ', 'g')
         !~ ('[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2'
             '\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200E\u200F\u2028-\u202E\u2060-\u206F\u2800\u3164'
             '\uFE00-\uFE0E\uFEFF\uFFA0\uFFF0-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F'
             '\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]'
             '|(^|[^#*0-9\u00A9\u00AE\u203C-\uFE0E\uFE10-\U000DFFFF\U000E1000-\U0010FFFF])\uFE0F');
$$;

-- The column's value: null, or an array of 1 to 5 {label, value} objects.
-- CASE guards each step, so jsonb_object_keys only ever sees an object.
create function private.before_you_go_ok(p_items jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_items is null then true
    when jsonb_typeof(p_items) <> 'array' then false
    when jsonb_array_length(p_items) not between 1 and 5 then false
    else not exists (
      select 1
        from jsonb_array_elements(p_items) as x (item)
       where case
               when jsonb_typeof(x.item) <> 'object' then true
               when (select array_agg(k order by k) from jsonb_object_keys(x.item) as t (k)) is distinct from array['label', 'value'] then true
               when jsonb_typeof(x.item -> 'label') is distinct from 'string'
                 or jsonb_typeof(x.item -> 'value') is distinct from 'string' then true
               else not (private.before_you_go_text_ok(x.item ->> 'label', 20)
                         and private.before_you_go_text_ok(x.item ->> 'value', 80))
             end)
  end;
$$;

-- p_fields' beforeYouGo as stored: JSON null and [] are SQL null (a clear);
-- the key's absence is the caller's to check (p_fields ? 'beforeYouGo').
create function private.before_you_go_of(p_fields jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select nullif(nullif(p_fields -> 'beforeYouGo', 'null'::jsonb), '[]'::jsonb);
$$;

alter table public.events
  add column before_you_go jsonb,
  add constraint events_before_you_go_check check (private.before_you_go_ok(before_you_go));

comment on column public.events.before_you_go is
  'The organiser''s "Before you go" rows for people going: 1 to 5 {label, value} (label 1-20, value 1-80 characters, one line each); null for none.';

-- ---------------------------------------------------------------------------
-- Creating, the organiser's edit and an admin's edit
-- ---------------------------------------------------------------------------

-- As in 20261114000000_external_price.sql, plus beforeYouGo (absent, null or []: null).
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
    private.before_you_go_of(p_fields)
  )
  returning id into v_id;

  perform private.replace_ticket_types(v_id, p_ticket_types);
  return v_id;
end;
$$;

-- As in 20261114000000_external_price.sql, plus beforeYouGo: sent, as sent (null or [] clears it); not sent, kept.
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
    before_you_go = case when p_fields ? 'beforeYouGo' then private.before_you_go_of(p_fields) else v_event.before_you_go end
  where id = p_event_id;

  if v_mode <> 'external' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;
  return 'updated';
end;
$$;

-- As in 20261120000000_group_tickets.sql, plus beforeYouGo: compared, logged (the old and new arrays) and
-- written with the other fields; not sent, the stored rows (so no change is seen).
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
  v_before_you_go jsonb;
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
  -- As edit_event_draft reads it: sent, as sent (null or [] clears it); not sent, kept.
  v_before_you_go := case when p_fields ? 'beforeYouGo' then private.before_you_go_of(p_fields) else v_event.before_you_go end;

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

revoke all on function private.before_you_go_text_ok(text, integer) from public, anon, authenticated;
revoke all on function private.before_you_go_ok(jsonb) from public, anon, authenticated;
revoke all on function private.before_you_go_of(jsonb) from public, anon, authenticated;
revoke all on function private.create_event_draft(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.edit_event_draft(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.admin_edit_event(uuid, uuid, timestamptz, jsonb, jsonb, boolean, text)
  from public, anon, authenticated;
