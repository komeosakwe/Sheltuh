-- External ticketing (docs/FEATURE_PLAN.md, B2; docs/architecture.md,
-- "External ticketing"): an event whose tickets are sold on another site,
-- which Sheltüh lists and links to.
--
--   * events.ticketing_mode ('sheltuh' | 'external'), external_ticket_url,
--     external_free. An external event has a ticket link and no ticket types,
--     orders, Who's Going or check-in; a Sheltüh-ticketed one has no link.
--     is_free follows external_free for external events (the feed's
--     pricing=free filter), and the ticket-type rule otherwise.
--   * The ticket link's rules are a check constraint as well as the API's
--     (lib/ticketing.ts): https, a plain DNS host (no IP address, port,
--     credentials, localhost or other non-public name, or link shortener),
--     printable ASCII (the URL parser's own form), at most 2048 characters.
--   * Triggers keep external events free of ticket types and orders, so no
--     code path can sell Sheltüh tickets for one.
--   * private.edit_event_draft replaces private.update_event_draft for the
--     organiser's PATCH: same rules, plus the ticketing fields, which are
--     frozen once the event has ever been approved ('ticketing_frozen').
--   * private.admin_set_event_ticketing: an admin's change to an event's
--     ticketing (any status), logged in event_moderation_log as
--     'ticketing_changed' with the old and new values in the new `details`
--     column.
--   * public.event_outbound_clicks + private.record_outbound_click: clicks on
--     an external event's ticket link, counted per event per Melbourne day
--     like page views (no visitor data, a per-event per-minute cap).
--   * private.set_going refuses external events; purge_analytics also
--     deletes outbound clicks after 25 months.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated; every new function pins its search_path and has execute
-- revoked from PUBLIC.
--
-- Additive. Reversible before launch: drop the functions
-- private.record_outbound_click, private.admin_set_event_ticketing,
-- private.edit_event_draft, private.external_ticket_url_ok and the trigger
-- functions; drop table public.event_outbound_clicks (its counts are lost);
-- drop the triggers, the new events constraints and columns (any external
-- event's link is lost, so convert or delete those first) and
-- event_moderation_log.details; restore create_event_draft,
-- replace_ticket_types, set_going and purge_analytics from their previous
-- migrations. The enum value 'ticketing_changed' can't be removed from
-- public.moderation_action without recreating the type (harmless if left).

alter type public.moderation_action add value if not exists 'ticketing_changed';

-- ---------------------------------------------------------------------------
-- The ticket link's rules
-- ---------------------------------------------------------------------------

-- True if p_url is an acceptable stored ticket link. The URL is stored as the
-- browser's URL parser writes it (lib/ticketing.ts, checkExternalTicketUrl):
-- printable ASCII, host lower case and punycode. Mirrors the API's rules;
-- tests/server/external-ticketing.test.ts checks the two agree, shortener
-- and non-public lists included.
create function private.external_ticket_url_ok(p_url text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
     and char_length(p_url) <= 2048
     -- Printable ASCII, no space; no backslash (URL parsers read it as "/").
     and p_url ~ '^[!-~]+$'
     and strpos(p_url, chr(92)) = 0
     -- https://, then a host of DNS labels (so no credentials, port, IPv6
     -- literal or trailing dot), then optionally a path, query or fragment.
     and p_url ~ '^https://[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$'
     and not exists (
       select 1
         from (select substring(p_url from '^https://([^/?#]+)') as host) h
        where h.host ~ '^[0-9.]+$'
           or h.host ~ '(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan|test|invalid|example|onion)$'
           or h.host ~ ('(^|\.)(adf\.ly|bit\.do|bit\.ly|bitly\.com|bl\.ink|buff\.ly|cutt\.ly|dub\.sh|fb\.me|goo\.gl'
                        || '|is\.gd|lnkd\.in|ow\.ly|rb\.gy|rebrand\.ly|s\.id|short\.io|shorturl\.at|t\.co|t\.ly'
                        || '|tiny\.cc|tinyurl\.com|trib\.al|v\.gd)$')
     );
$$;

revoke all on function private.external_ticket_url_ok(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- Constant defaults: metadata-only on Postgres 11+, no table rewrite. Every
-- existing event is Sheltüh-ticketed with no link, so every constraint holds.
alter table public.events
  add column ticketing_mode text not null default 'sheltuh',
  add column external_ticket_url text,
  add column external_free boolean not null default false,
  add constraint events_ticketing_mode_check check (ticketing_mode in ('sheltuh', 'external')),
  -- External: a link. Sheltüh-ticketed: no link and not externally free.
  add constraint events_ticketing_fields check (
    case when ticketing_mode = 'external'
         then external_ticket_url is not null
         else external_ticket_url is null and not external_free end),
  -- The feed's pricing=free filter reads is_free: for an external event it's the organiser's free flag.
  add constraint events_external_is_free check (ticketing_mode <> 'external' or is_free = external_free),
  add constraint events_external_ticket_url_valid check (
    external_ticket_url is null or private.external_ticket_url_ok(external_ticket_url));

-- Admin-only context for each log entry, e.g. the old and new ticketing
-- values of a 'ticketing_changed' entry. Null for the other actions.
alter table public.event_moderation_log
  add column details jsonb,
  add constraint event_moderation_log_details_object check (details is null or jsonb_typeof(details) = 'object');

-- ---------------------------------------------------------------------------
-- External events never have ticket types or orders
-- ---------------------------------------------------------------------------

-- A ticket type for an external event is refused. Every insert comes through
-- private.replace_ticket_types, called after its event row was updated (so
-- row-locked) in the same transaction.
create function private.ticket_types_sheltuh_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.events e where e.id = new.event_id and e.ticketing_mode = 'external') then
    raise exception 'An event with external ticketing has no ticket types.'
      using errcode = 'check_violation', constraint = 'ticket_types_sheltuh_only';
  end if;
  return new;
end;
$$;

create trigger ticket_types_sheltuh_only before insert on public.ticket_types
  for each row execute function private.ticket_types_sheltuh_only();

-- An event can't become external while it has ticket types (remove them first).
create function private.events_external_without_ticket_types() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ticketing_mode = 'external' and old.ticketing_mode <> 'external'
     and exists (select 1 from public.ticket_types t where t.event_id = new.id) then
    raise exception 'Remove the ticket types before switching to external ticketing.'
      using errcode = 'check_violation', constraint = 'events_external_no_ticket_types';
  end if;
  return new;
end;
$$;

create trigger events_external_without_ticket_types before update of ticketing_mode on public.events
  for each row execute function private.events_external_without_ticket_types();

-- An order for an external event is refused. The event row is share-locked,
-- so an order racing private.admin_set_event_ticketing (which locks the event
-- row, then refuses if the event has any order) either commits first, and
-- the switch is refused, or waits and then sees the event is external.
create function private.orders_sheltuh_only() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode text;
begin
  select e.ticketing_mode into v_mode from public.events e where e.id = new.event_id for share;
  if v_mode = 'external' then
    raise exception 'Tickets for this event are sold on another site.'
      using errcode = 'check_violation', constraint = 'orders_sheltuh_only';
  end if;
  return new;
end;
$$;

create trigger orders_sheltuh_only before insert on public.orders
  for each row execute function private.orders_sheltuh_only();

-- Triggers don't need the caller to hold execute on their function.
revoke all on function private.ticket_types_sheltuh_only() from public, anon, authenticated;
revoke all on function private.events_external_without_ticket_types() from public, anon, authenticated;
revoke all on function private.orders_sheltuh_only() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- is_free: as in 20261021120000_listing_fixes.sql, except that an external
-- event's is_free is its external_free.
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
    (event_id, id, position, name, description, price_cents, fee_policy, quantity_available)
  select p_event_id,
         x.e ->> 'id',
         x.ord::integer - 1,
         x.e ->> 'name',
         nullif(x.e ->> 'description', ''),
         (x.e ->> 'priceCents')::integer,
         (x.e ->> 'feePolicy')::public.fee_policy,
         (x.e ->> 'quantityAvailable')::integer
  from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)
  on conflict (event_id, id) do update set
    position = excluded.position,
    name = excluded.name,
    description = excluded.description,
    price_cents = excluded.price_cents,
    fee_policy = excluded.fee_policy,
    quantity_available = excluded.quantity_available;

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

revoke all on function private.replace_ticket_types(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Creating and editing drafts
-- ---------------------------------------------------------------------------

-- As in 20260925000000_init.sql, plus the ticketing fields, read from
-- p_fields: ticketingMode (default 'sheltuh'), externalTicketUrl,
-- externalFree (default false). Already validated by
-- lib/server/event-input.ts; the constraints and triggers above hold whatever
-- is sent. Same signature, so a caller that doesn't send them gets a
-- Sheltüh-ticketed event, as before. Now pins its search_path.
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
     ticketing_mode, external_ticket_url, external_free, is_free)
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
    v_mode = 'external' and v_free
  )
  returning id into v_id;

  perform private.replace_ticket_types(v_id, p_ticket_types);
  return v_id;
end;
$$;

revoke all on function private.create_event_draft(uuid, text, jsonb, jsonb) from public, anon, authenticated;

-- The organiser's edit (PATCH /api/events/{id}). Same rules as
-- private.update_event_draft (still there, unchanged, for the deploy window),
-- plus the ticketing fields. Locks the event row first. Returns:
--   'updated'           saved
--   'not_found'         no such event, or not p_organiser_id's
--   'not_editable'      not draft or rejected
--   'ticketing_frozen'  the event has been approved before (published at some
--                       point) and the edit would change its ticketing mode or
--                       ticket link: only an admin can now
--                       (private.admin_set_event_ticketing)
-- Switching to external removes the ticket types first (a sold one can't be:
-- the tickets foreign key fails, which the API reports as a 409; only an
-- event approved before can have sales, and its ticketing is frozen anyway).
create function private.edit_event_draft(
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
begin
  select e.status, e.ticketing_mode, e.external_ticket_url into v_event
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

  if v_mode = 'external' then
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
    is_free = case when v_mode = 'external' then v_free else is_free end
  where id = p_event_id;

  if v_mode <> 'external' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;
  return 'updated';
end;
$$;

revoke all on function private.edit_event_draft(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An admin's change to an event's ticketing
-- ---------------------------------------------------------------------------

-- Sets p_event_id's ticketing, whatever its status, and logs it. Locks the
-- event row first. Returns:
--   'updated'     changed, and a 'ticketing_changed' moderation log entry
--                 written with p_reason and, in `details`, the old and new
--                 value of each field that changed
--   'unchanged'   nothing would change: nothing written
--   'not_found'   no such event
--   'has_orders'  switching to external, but the event has orders (of any
--                 status): its tickets can't be dropped
-- Switching to external deletes the event's ticket types (it has no orders,
-- so none has sales). Switching back to Sheltüh ticketing leaves it with no
-- ticket types: neither free nor paid, and not on sale until the organiser
-- adds some (after an unpublish).
create function private.admin_set_event_ticketing(
  p_event_id uuid, p_admin_id uuid, p_mode text, p_url text, p_free boolean, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_details jsonb := '{}'::jsonb;
begin
  select e.ticketing_mode, e.external_ticket_url, e.external_free into v_event
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
  if v_details = '{}'::jsonb then
    return 'unchanged';
  end if;

  if p_mode = 'external' and v_event.ticketing_mode <> 'external' then
    if exists (select 1 from public.orders o where o.event_id = p_event_id) then
      return 'has_orders';
    end if;
    delete from public.ticket_types t where t.event_id = p_event_id;
  end if;

  update public.events e set
    ticketing_mode = p_mode,
    external_ticket_url = p_url,
    external_free = p_free,
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

revoke all on function private.admin_set_event_ticketing(uuid, uuid, text, text, boolean, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who's Going: as in 20261002000000_whos_going_hardening.sql, except that an
-- external event has none ('event_unavailable').
-- ---------------------------------------------------------------------------

create or replace function private.set_going(p_event_id uuid, p_user_id uuid, p_email text) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events
   where id = p_event_id and status = 'published' and whos_going_enabled and ends_at > now()
     and ticketing_mode = 'sheltuh'
     for share;
  if not found then
    return 'event_unavailable';
  end if;

  if exists (select 1 from private.social_suspensions where user_id = p_user_id) then
    return 'suspended';
  end if;

  perform 1 from public.profiles where user_id = p_user_id for share;
  if not found then
    return 'no_profile';
  end if;

  if p_email is null or not exists (
    select 1 from public.orders
     where event_id = p_event_id and status = 'paid' and lower(buyer_email) = lower(p_email)
  ) then
    return 'not_eligible';
  end if;

  insert into public.event_attendees (event_id, user_id) values (p_event_id, p_user_id)
  on conflict (event_id, user_id) do nothing;
  return 'going';
end;
$$;

revoke all on function private.set_going(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Outbound clicks
-- ---------------------------------------------------------------------------

create table public.event_outbound_clicks (
  event_id uuid not null references public.events (id) on delete cascade,
  -- The Australia/Melbourne calendar day the clicks were counted on.
  day date not null,
  clicks integer not null check (clicks >= 0),
  -- The event's per-minute click cap was reached that day: clicks is a lower bound.
  cap_reached boolean not null default false,
  primary key (event_id, day)
);
-- The primary key serves every read (one event's days over a range), the
-- upsert and the events FK cascade. The overview joins through events on
-- organiser_id (events_organiser_created_idx) first. No index on day alone:
-- only the daily purge filters on it without an event.

alter table public.event_outbound_clicks enable row level security;
revoke all on public.event_outbound_clicks from anon, authenticated;

-- Counts one click on p_event_id's ticket link. Returns:
--   'recorded'     counted
--   'not_found'    no such event, it isn't published, or it isn't external
--   'rate_limited' over p_limit clicks per p_window for this event: not
--                  counted, and the day marked cap_reached (once: after that
--                  the conflict update's condition is false, so no write)
-- Like private.record_view: no row lock on the event and no exception block,
-- to keep the hot path to two small upserts.
create function private.record_outbound_click(p_event_id uuid, p_limit integer, p_window interval)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Australia/Melbourne')::date;
begin
  perform 1 from public.events e
   where e.id = p_event_id and e.status = 'published' and e.ticketing_mode = 'external';
  if not found then
    return 'not_found';
  end if;

  if not private.take_event_rate_limit(p_event_id, 'outbound', p_limit, p_window) then
    insert into public.event_outbound_clicks as c (event_id, day, clicks, cap_reached)
    values (p_event_id, v_day, 0, true)
    on conflict (event_id, day) do update set cap_reached = true where not c.cap_reached;
    return 'rate_limited';
  end if;

  insert into public.event_outbound_clicks as c (event_id, day, clicks)
  values (p_event_id, v_day, 1)
  on conflict (event_id, day) do update set clicks = c.clicks + 1;
  return 'recorded';
end;
$$;

revoke all on function private.record_outbound_click(uuid, integer, interval) from public, anon, authenticated;

-- Retention: as in 20261021000000_ticket_check_in.sql, plus outbound clicks
-- on the view counts' 25-month horizon. The result columns are unchanged, so
-- an existing Supabase Cron job keeps working.
create or replace function private.purge_analytics(out event_view_counts_deleted integer, out event_rate_limits_deleted integer)
language plpgsql
set search_path = ''
as $$
begin
  delete from public.event_view_counts
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;
  get diagnostics event_view_counts_deleted = row_count;

  delete from private.event_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics event_rate_limits_deleted = row_count;

  delete from private.event_view_cap_days
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;

  delete from public.event_outbound_clicks
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;

  delete from public.ticket_check_ins c
   using public.events e
   where e.id = c.event_id and e.ends_at < now() - interval '25 months';

  update public.tickets t
     set checked_in_at = null
    from public.events e
   where e.id = t.event_id and e.ends_at < now() - interval '25 months' and t.checked_in_at is not null;
end;
$$;

revoke all on function private.purge_analytics() from public, anon, authenticated;
