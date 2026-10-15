-- Analytics and favourites hardening (security review of the analytics
-- backend, and code review notes).
--
--   F1. A flood against POST /api/events/{id}/view can fill an event's shared
--       per-minute view cap, so real views are dropped silently. Now it's
--       visible: the first refused view of a window records a per-event,
--       per-Melbourne-day marker (private.event_view_cap_days), and reports
--       flag those days `viewsUnreliable` with no conversion rate. The flood
--       still costs the event its view counts for that minute (accepted:
--       docs/architecture.md, "Accepted risks (analytics)").
--   F2. private.take_event_rate_limit did an upsert (a row write) on every
--       call, even once over the cap, so a flood turned into a write per
--       request on one hot row. It now reads first and refuses without
--       writing while the window is live and already over.
--   Favourites: the 500 cap counted favourites of unpublished events, which
--       members can't see (or remove from the app). It now counts only
--       favourites of published events (see docs/architecture.md,
--       "Favourites").
--
-- Markers hold an event id and a day: no data about any visitor. Deleted with
-- the event, and by private.purge_analytics with the view counts (25 months).
--
-- Reversible: restore take_event_rate_limit and record_view from
-- 20261006000000_event_analytics.sql, purge_analytics likewise, and
-- add_favourite from 20261005000000_favourites.sql; drop table
-- private.event_view_cap_days (discards the markers only).

create table private.event_view_cap_days (
  event_id uuid not null references public.events (id) on delete cascade,
  -- The Australia/Melbourne day the event's view cap was reached.
  day date not null,
  primary key (event_id, day)
);
-- The primary key serves the reports (one event's days over a range) and the
-- events FK cascade. The overview joins through events on organiser_id first.

alter table private.event_view_cap_days enable row level security;
revoke all on private.event_view_cap_days from public, anon, authenticated;

-- Records one hit and returns whether it's within p_limit per p_window, as
-- before; but a window that's live and already over the limit is refused
-- with a plain read, without writing anything. (A concurrent hit can still
-- slip through the read and be refused by the upsert: harmless.)
create or replace function private.take_event_rate_limit(p_event_id uuid, p_bucket text, p_limit integer, p_window interval)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_hits integer;
  v_started timestamptz;
  v_ok boolean;
begin
  select r.hits, r.window_started_at into v_hits, v_started
    from private.event_rate_limits r
   where r.event_id = p_event_id and r.bucket = p_bucket;
  if found and v_started > now() - p_window and v_hits > p_limit then
    return false;
  end if;

  insert into private.event_rate_limits as r (event_id, bucket, window_started_at, hits)
  values (p_event_id, p_bucket, now(), 1)
  on conflict (event_id, bucket) do update
     set window_started_at = case when r.window_started_at <= now() - p_window then now() else r.window_started_at end,
         hits = case when r.window_started_at <= now() - p_window then 1 else least(r.hits + 1, p_limit + 1) end
  returning r.hits <= p_limit into v_ok;
  return v_ok;
end;
$$;

-- As in 20261006000000_event_analytics.sql, plus: a view refused by the cap
-- records that the event's cap was reached today. After the first, that
-- insert finds the row and writes nothing.
create or replace function private.record_view(p_event_id uuid, p_source text, p_code text, p_limit integer, p_window interval)
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
    insert into private.event_view_cap_days (event_id, day)
    values (p_event_id, (now() at time zone 'Australia/Melbourne')::date)
    on conflict (event_id, day) do nothing;
    return 'rate_limited';
  end if;

  insert into public.event_view_counts as c (event_id, day, source, link_code, views)
  values (p_event_id, (now() at time zone 'Australia/Melbourne')::date, v_source, v_code, 1)
  on conflict (event_id, day, source, coalesce(link_code, '')) do update set views = c.views + 1;
  return 'recorded';
end;
$$;

-- As before, plus the cap markers, on the same 25-month horizon as the view
-- counts (not reported separately, so the function's result is unchanged and
-- an existing Supabase Cron job keeps working).
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
end;
$$;

-- As in 20261005000000_favourites.sql, except that the cap counts only
-- favourites of published events: the ones the member can see and remove.
-- Hidden ones are kept, and come back if their event is published again, so
-- an account can then briefly hold more than p_limit visible favourites.
create or replace function private.add_favourite(p_user_id uuid, p_event_id uuid, p_limit integer) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events e where e.id = p_event_id and e.status = 'published';
  if not found then
    return 'not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('event_favourites:' || p_user_id::text, 0));

  if exists (select 1 from public.event_favourites f where f.user_id = p_user_id and f.event_id = p_event_id) then
    return 'exists';
  end if;

  if (select count(*) from public.event_favourites f
        join public.events e on e.id = f.event_id and e.status = 'published'
       where f.user_id = p_user_id) >= p_limit then
    return 'limit';
  end if;

  insert into public.event_favourites (user_id, event_id) values (p_user_id, p_event_id);
  return 'added';
exception
  when foreign_key_violation then
    -- The account (or the event) was deleted mid-call.
    return 'not_found';
end;
$$;

revoke all on function private.take_event_rate_limit(uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function private.record_view(uuid, text, text, integer, interval) from public, anon, authenticated;
revoke all on function private.purge_analytics() from public, anon, authenticated;
revoke all on function private.add_favourite(uuid, uuid, integer) from public, anon, authenticated;
