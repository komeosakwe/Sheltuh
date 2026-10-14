-- Organiser analytics, stages A (views, sales) and B (tracking links).
--
-- Privacy first: page views are aggregate counters only, one row per
-- (event, Melbourne day, source bucket, tracking code). No cookie, IP
-- address, user id, email, user agent or referrer URL is stored anywhere.
-- Sales figures are computed from the existing `paid` orders.
--
--   * public.event_view_counts: daily view counters, incremented by
--     private.record_view (one atomic upsert). Rows older than 25 months are
--     deleted by private.purge_analytics (daily, Supabase Cron).
--   * private.event_rate_limits + private.take_event_rate_limit: a
--     fixed-window counter keyed on the *event* (never on a person), so one
--     client can't inflate an event's views beyond a per-minute cap.
--   * public.event_tracking_links: up to 20 organiser-labelled codes per
--     event (private.create_tracking_link enforces the cap atomically).
--   * orders.tracking_code: the tracking code a checkout came through,
--     checked against the event's links when the order is created.
--   * private.analytics_settings.views_tracked_since: the Melbourne day view
--     counting started (when this migration ran), so reports can say "not
--     counted" rather than "0" for earlier days.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC.
--
-- Reversible: drop functions private.purge_analytics, private.record_view,
-- private.create_tracking_link and private.take_event_rate_limit; drop index
-- orders_organiser_paid_created_idx; drop column orders.tracking_code; drop
-- tables private.analytics_settings, private.event_rate_limits,
-- public.event_view_counts and public.event_tracking_links. That discards
-- every view count, tracking link and order attribution, so reversing it
-- after launch is destructive.

-- ---------------------------------------------------------------------------
-- Tracking links
-- ---------------------------------------------------------------------------

create table public.event_tracking_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- Made by the server (lib/server/tracking-codes.ts): no 0/1/i/l/o, so it
  -- survives being read aloud or retyped.
  code text not null check (code ~ '^[2-9a-hjkmnp-z]{6,10}$'),
  -- Organiser-supplied; the API trims it and refuses control and invisible
  -- characters. Ends up in CSV exports, which neutralise formulas.
  label text not null check (char_length(label) between 1 and 40 and label = btrim(label)),
  created_at timestamptz not null default now(),
  constraint event_tracking_links_event_code_key unique (event_id, code)
);

-- One label per event, ignoring case (so the organiser can tell links apart).
create unique index event_tracking_links_event_label_key on public.event_tracking_links (event_id, lower(label));
-- event_tracking_links_event_code_key serves "this event's links" and "is this
-- code one of the event's", which are the only lookups.

-- ---------------------------------------------------------------------------
-- View counters
-- ---------------------------------------------------------------------------

create table public.event_view_counts (
  event_id uuid not null references public.events (id) on delete cascade,
  -- The Australia/Melbourne calendar day the view was counted on.
  day date not null,
  source text not null check (source in (
    'direct', 'search', 'instagram', 'facebook', 'x', 'tiktok', 'email', 'eventbrite', 'other', 'tracking')),
  -- Only for source 'tracking': one of the event's codes when the view was
  -- counted. Not a foreign key: a deleted link's counts are kept, under its code.
  link_code text check (link_code ~ '^[2-9a-hjkmnp-z]{6,10}$'),
  views integer not null check (views >= 1),
  constraint event_view_counts_code_only_for_tracking check (link_code is null or source = 'tracking')
);

-- The counter's key (a primary key can't hold an expression, and link_code is
-- nullable). Also serves every read: one event's rows over a range of days,
-- and the events FK cascade. No index on day alone: only the daily purge
-- filters on it without an event.
create unique index event_view_counts_key on public.event_view_counts (event_id, day, source, coalesce(link_code, ''));

-- ---------------------------------------------------------------------------
-- Per-event rate limits (keyed on the event, never on a person)
-- ---------------------------------------------------------------------------

create table private.event_rate_limits (
  event_id uuid not null references public.events (id) on delete cascade,
  bucket text not null check (char_length(bucket) between 1 and 64),
  window_started_at timestamptz not null,
  hits integer not null check (hits >= 1),
  primary key (event_id, bucket)
);

-- Same semantics as private.take_rate_limit (20261002000000_whos_going_hardening.sql):
-- records one hit, returns whether it's within p_limit per p_window. One
-- upsert, so concurrent hits can't both take the last slot; `hits` stops at
-- p_limit + 1.
create function private.take_event_rate_limit(p_event_id uuid, p_bucket text, p_limit integer, p_window interval)
returns boolean
language sql
set search_path = ''
as $$
  insert into private.event_rate_limits as r (event_id, bucket, window_started_at, hits)
  values (p_event_id, p_bucket, now(), 1)
  on conflict (event_id, bucket) do update
     set window_started_at = case when r.window_started_at <= now() - p_window then now() else r.window_started_at end,
         hits = case when r.window_started_at <= now() - p_window then 1 else least(r.hits + 1, p_limit + 1) end
  returning hits <= p_limit;
$$;

-- ---------------------------------------------------------------------------
-- When view counting started
-- ---------------------------------------------------------------------------

create table private.analytics_settings (
  -- A single row.
  id boolean primary key default true check (id),
  views_tracked_since date not null
);

insert into private.analytics_settings (views_tracked_since)
values ((now() at time zone 'Australia/Melbourne')::date);

-- ---------------------------------------------------------------------------
-- Order attribution
-- ---------------------------------------------------------------------------

-- Nullable with no default: a metadata-only change. Set only by the checkout
-- API, and only to a code that belonged to the event's links at that moment.
alter table public.orders
  add column tracking_code text check (tracking_code ~ '^[2-9a-hjkmnp-z]{6,10}$');

-- The analytics overview reads one organiser's paid orders over a date range.
-- Partial (paid only), like orders_event_paid_email_idx, which already serves
-- the per-event reports (event_id, status = 'paid').
create index orders_organiser_paid_created_idx on public.orders (organiser_id, created_at) where status = 'paid';

-- ---------------------------------------------------------------------------
-- Lock the Data API out
-- ---------------------------------------------------------------------------

alter table public.event_tracking_links enable row level security;
alter table public.event_view_counts enable row level security;
alter table private.event_rate_limits enable row level security;
alter table private.analytics_settings enable row level security;

revoke all on public.event_tracking_links, public.event_view_counts from anon, authenticated;
revoke all on private.event_rate_limits, private.analytics_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Count a view
-- ---------------------------------------------------------------------------

-- Counts one view of p_event_id. p_source must be one of the buckets (else
-- 'other'). p_code, if it's one of the event's tracking codes, makes the view
-- source 'tracking' under that code; an unknown code is ignored, and
-- 'tracking' without a valid code becomes 'other'. Returns:
--   'recorded'     counted
--   'not_found'    no such event, or it isn't published
--   'rate_limited' over p_limit views per p_window for this event: not counted
-- No row lock on the event: a view landing as the event is unpublished is
-- harmless, and locking would make every view write to the events table. No
-- exception block either (it would cost a subtransaction per view): an event
-- deleted mid-call (only ever by hand) fails the insert, and the API answers
-- 204 regardless.
create function private.record_view(p_event_id uuid, p_source text, p_code text, p_limit integer, p_window interval)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_source text := p_source;
  v_code text;
begin
  perform 1 from public.events e where e.id = p_event_id and e.status = 'published';
  if not found then
    return 'not_found';
  end if;

  if v_source is null or v_source not in (
       'direct', 'search', 'instagram', 'facebook', 'x', 'tiktok', 'email', 'eventbrite', 'other', 'tracking') then
    v_source := 'other';
  end if;

  if p_code is not null then
    select l.code into v_code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_code;
  end if;
  if v_code is not null then
    v_source := 'tracking';
  elsif v_source = 'tracking' then
    v_source := 'other';
  end if;

  if not private.take_event_rate_limit(p_event_id, 'views', p_limit, p_window) then
    return 'rate_limited';
  end if;

  insert into public.event_view_counts as c (event_id, day, source, link_code, views)
  values (p_event_id, (now() at time zone 'Australia/Melbourne')::date, v_source, v_code, 1)
  on conflict (event_id, day, source, coalesce(link_code, '')) do update set views = c.views + 1;
  return 'recorded';
end;
$$;

-- ---------------------------------------------------------------------------
-- Create a tracking link
-- ---------------------------------------------------------------------------

-- Adds a link to p_event_id if it belongs to p_organiser_id. Returns
-- (result, link_id, link_created_at):
--   'created'     done
--   'not_found'   no such event, or not the organiser's
--   'limit'       the event already has p_limit links
--   'label_taken' the event already has a link with that label (any case)
--   'code_taken'  the code collided with one of the event's codes: the API
--                 retries with a fresh code
-- A transaction-scoped advisory lock on the event serialises one event's
-- creates, so two concurrent requests can't both take the last slot. The
-- events row itself isn't locked (that would hold up checkouts).
create function private.create_tracking_link(
  p_event_id uuid, p_organiser_id uuid, p_code text, p_label text, p_limit integer,
  out result text, out link_id uuid, out link_created_at timestamptz)
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id;
  if not found then
    result := 'not_found';
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('event_tracking_links:' || p_event_id::text, 0));

  if (select count(*) from public.event_tracking_links l where l.event_id = p_event_id) >= p_limit then
    result := 'limit';
    return;
  end if;
  if exists (select 1 from public.event_tracking_links l
              where l.event_id = p_event_id and lower(l.label) = lower(p_label)) then
    result := 'label_taken';
    return;
  end if;

  begin
    insert into public.event_tracking_links (event_id, code, label)
    values (p_event_id, p_code, p_label)
    returning id, created_at into link_id, link_created_at;
  exception
    when unique_violation then
      result := 'code_taken';
      return;
    when foreign_key_violation then
      result := 'not_found';
      return;
  end;
  result := 'created';
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- Deletes view counters for days more than 25 months ago (two full years to
-- compare against, plus a month of slack), and per-event rate-limit rows idle
-- for over a day. Idempotent; run daily by Supabase Cron
-- (docs/supabase-setup.md), not from this migration.
create function private.purge_analytics(out event_view_counts_deleted integer, out event_rate_limits_deleted integer)
language plpgsql
set search_path = ''
as $$
begin
  delete from public.event_view_counts
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;
  get diagnostics event_view_counts_deleted = row_count;

  delete from private.event_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics event_rate_limits_deleted = row_count;
end;
$$;

revoke all on function private.take_event_rate_limit(uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function private.record_view(uuid, text, text, integer, interval) from public, anon, authenticated;
revoke all on function private.create_tracking_link(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function private.purge_analytics() from public, anon, authenticated;
