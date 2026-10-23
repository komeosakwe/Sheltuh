-- Trending (docs/FEATURE_PLAN.md, B4; docs/architecture.md, "Trending").
--
--   * private.event_curation: an admin's per-event boost (0.5 to 2, default
--     1) and exclusion from trending. One row per event, written only by
--     private.set_event_curation, which also logs a 'curated' entry (with the
--     reason and the old and new values in `details`) in the event's
--     moderation log in the same step.
--   * private.trending_snapshot: the ranked list the public endpoint serves
--     (rank, event, score, when computed), rebuilt as a whole by
--     private.refresh_trending (Vercel Cron, GET /api/cron/trending).
--   * Score S = R * P * B, from these immutable helpers (single source of the
--     formula; tests call them directly):
--       private.trending_day_utility  u = 6 ln(1+V) + 8F + 15G + 25Op + 10Of
--         (V views capped at 300 a day, 0 on a flood day; the rest capped at
--         50 a day each)
--       private.trending_decay        3-day half-life, days 0..13 only
--       private.trending_shrink       Bayesian shrinkage, m = 2, towards the
--                                     median of the eligible events
--       private.trending_proximity    1 within 7 days of the start, linear
--                                     to 0.3 at 60 days
--     B is the admin boost.
--   * Favourites (F) are read only as an aggregate input to the score
--     (owner-approved 21 Oct 2026). Nothing stores or returns a per-event
--     favourite count: the snapshot keeps only the final score.
--   * event_favourites gains an (event_id, created_at) index: the refresh
--     counts each candidate event's favourites over the last 14 days, and
--     the table's only other index leads with user_id. It also serves the
--     events foreign key's cascade.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated; every new function pins its search_path and has execute
-- revoked from PUBLIC, anon and authenticated.
--
-- Additive: no existing row changes. Reversible: drop the functions
-- private.refresh_trending, private.set_event_curation,
-- private.trending_day_utility, private.trending_decay,
-- private.trending_shrink and private.trending_proximity, the tables
-- private.trending_snapshot and private.event_curation, and the index
-- event_favourites_event_created_idx. Dropping event_curation discards the
-- admins' boosts and exclusions (their 'curated' log entries stay); the
-- snapshot is rebuilt by the next refresh, so dropping it loses nothing.

-- ---------------------------------------------------------------------------
-- Admin curation
-- ---------------------------------------------------------------------------

create table private.event_curation (
  event_id uuid primary key references public.events (id) on delete cascade,
  boost numeric(3, 2) not null default 1 check (boost between 0.5 and 2),
  excluded boolean not null default false,
  -- Null until an admin changes something (a row can exist with the defaults).
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz
);
-- The primary key serves every read (by event) and the events FK cascade.
-- updated_by needs no index: auth.users rows are deleted only by hand, and
-- this table is at most one row per event.

-- ---------------------------------------------------------------------------
-- Snapshot
-- ---------------------------------------------------------------------------

create table private.trending_snapshot (
  rank smallint primary key check (rank >= 1),
  event_id uuid not null unique references public.events (id) on delete cascade,
  score double precision not null check (score >= 0),
  computed_at timestamptz not null
);
-- The primary key serves the public read (order by rank); the unique
-- event_id index serves the join to events and the FK cascade.

alter table private.event_curation enable row level security;
alter table private.trending_snapshot enable row level security;
revoke all on private.event_curation, private.trending_snapshot from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Favourites per event (refresh only)
-- ---------------------------------------------------------------------------

create index event_favourites_event_created_idx on public.event_favourites (event_id, created_at);

-- ---------------------------------------------------------------------------
-- The formula
-- ---------------------------------------------------------------------------

-- One Melbourne day's utility. Negative inputs count as 0.
create function private.trending_day_utility(
  p_views integer, p_flood boolean, p_favourites integer, p_going integer, p_paid_orders integer, p_free_orders integer
) returns double precision
language sql
immutable
set search_path = ''
as $$
  select 6 * ln(1 + case when p_flood then 0 else least(greatest(coalesce(p_views, 0), 0), 300) end)
       + 8 * least(greatest(coalesce(p_favourites, 0), 0), 50)
       + 15 * least(greatest(coalesce(p_going, 0), 0), 50)
       + 25 * least(greatest(coalesce(p_paid_orders, 0), 0), 50)
       + 10 * least(greatest(coalesce(p_free_orders, 0), 0), 50)
$$;

-- Weight of a day p_age_days old (0 = today): a 3-day half-life, and nothing
-- outside the 14-day window (0..13).
create function private.trending_decay(p_age_days integer) returns double precision
language sql
immutable
set search_path = ''
as $$
  select case when p_age_days between 0 and 13 then power(0.5::double precision, p_age_days / 3.0::double precision) else 0 end
$$;

-- Bayesian shrinkage: an event with few engagement events (p_n) is pulled
-- towards p_prior (the median of the eligible events' raw scores) with the
-- weight of p_m pseudo-events. A null prior (no eligible events) leaves the
-- raw score.
create function private.trending_shrink(
  p_raw double precision, p_n integer, p_prior double precision, p_m double precision
) returns double precision
language sql
immutable
set search_path = ''
as $$
  select (greatest(p_n, 0) * p_raw + p_m * coalesce(p_prior, p_raw)) / (greatest(p_n, 0) + p_m)
$$;

-- Start proximity: 1 when the event starts within 7 days (or has started),
-- falling linearly to 0.3 at 60 days, and 0.3 beyond.
create function private.trending_proximity(p_starts_at timestamptz, p_now timestamptz) returns double precision
language sql
immutable
set search_path = ''
as $$
  select case
           when d <= 7 then 1
           when d >= 60 then 0.3
           else 1 - 0.7 * (d - 7) / 53
         end
    from (select extract(epoch from (p_starts_at - p_now))::double precision / 86400 as d) x
$$;

-- ---------------------------------------------------------------------------
-- Refresh
-- ---------------------------------------------------------------------------

-- Rebuilds private.trending_snapshot as of p_now (default now(); tests pass
-- another instant). An event is eligible when it's published, its organiser
-- is approved, it hasn't ended, it starts within 60 days, its latest
-- approval is at least 6 hours old, an admin hasn't excluded it, and it has
-- at least 3 engagement events (favourites, Who's Going opt-ins and orders,
-- after the daily caps; views aren't engagement events) in the 14-day
-- window. The organiser's own activity doesn't count: favourites and opt-ins
-- by the owner account, and orders bought with the owner account's email or
-- the organiser's contact email. Opt-ins of suspended members don't count
-- either (they're left out of every Who's Going count). At most 2 events per
-- organiser, then the top 24. Ties: sooner start, then id.
--
-- Returns how many events were eligible and how many were ranked. A
-- transaction-scoped advisory lock serialises concurrent refreshes; readers
-- keep seeing the previous snapshot until this one commits. Deletes (not
-- truncates) the old rows, so readers are never blocked.
create function private.refresh_trending(p_now timestamptz default now(), out eligible integer, out ranked integer)
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Australia/Melbourne')::date;
  v_from date := (p_now at time zone 'Australia/Melbourne')::date - 13;
  v_from_at timestamptz := (((p_now at time zone 'Australia/Melbourne')::date - 13)::timestamp at time zone 'Australia/Melbourne');
begin
  perform pg_advisory_xact_lock(hashtextextended('private.refresh_trending', 0));

  delete from private.trending_snapshot;

  with candidates as (
    select e.id, e.organiser_id, e.starts_at, o.owner_user_id,
           lower(u.email) as owner_email, lower(o.contact_email) as contact_email,
           coalesce(c.boost, 1)::double precision as boost
      from public.events e
      join public.organisers o on o.id = e.organiser_id
      left join auth.users u on u.id = o.owner_user_id
      left join private.event_curation c on c.event_id = e.id
     where e.status = 'published'
       and o.status = 'approved'
       and e.ends_at > p_now
       and e.starts_at <= p_now + interval '60 days'
       and not coalesce(c.excluded, false)
       and (select max(l.created_at) from public.event_moderation_log l
             where l.event_id = e.id and l.action = 'approved') <= p_now - interval '6 hours'
  ),
  activity as (
    -- A day on which the event's view cap was reached (record_view's flood
    -- marker) counts no views at all (trending_day_utility's p_flood).
    select v.event_id, v.day, sum(v.views)::integer as views,
           exists (select 1 from private.event_view_cap_days d where d.event_id = v.event_id and d.day = v.day) as flood,
           0 as favourites, 0 as going, 0 as paid_orders, 0 as free_orders
      from public.event_view_counts v
      join candidates c on c.id = v.event_id
     where v.day between v_from and v_today
     group by v.event_id, v.day
    union all
    select f.event_id, (f.created_at at time zone 'Australia/Melbourne')::date, 0, false, count(*)::integer, 0, 0, 0
      from public.event_favourites f
      join candidates c on c.id = f.event_id
     where f.created_at >= v_from_at and f.created_at <= p_now
       and f.user_id is distinct from c.owner_user_id
     group by 1, 2
    union all
    select a.event_id, (a.created_at at time zone 'Australia/Melbourne')::date, 0, false, 0, count(*)::integer, 0, 0
      from public.event_attendees a
      join candidates c on c.id = a.event_id
     where a.created_at >= v_from_at and a.created_at <= p_now
       and a.user_id is distinct from c.owner_user_id
       and not exists (select 1 from private.social_suspensions s where s.user_id = a.user_id)
     group by 1, 2
    union all
    select r.event_id, (r.created_at at time zone 'Australia/Melbourne')::date, 0, false, 0, 0,
           (count(*) filter (where r.total_cents > 0))::integer,
           (count(*) filter (where r.total_cents = 0))::integer
      from public.orders r
      join candidates c on c.id = r.event_id
     where r.status = 'paid'
       and r.created_at >= v_from_at and r.created_at <= p_now
       and lower(r.buyer_email) is distinct from c.owner_email
       and lower(r.buyer_email) is distinct from c.contact_email
     group by 1, 2
  ),
  days as (
    select event_id, day,
           private.trending_day_utility(sum(views)::integer, bool_or(flood), sum(favourites)::integer,
                                        sum(going)::integer, sum(paid_orders)::integer, sum(free_orders)::integer) as utility,
           (least(sum(favourites), 50) + least(sum(going), 50) + least(sum(paid_orders), 50)
              + least(sum(free_orders), 50))::integer as engagement,
           v_today - day as age
      from activity
     group by event_id, day
  ),
  raw_scores as (
    select event_id,
           sum(utility * private.trending_decay(age)) as r_raw,
           sum(engagement)::integer as n
      from days
     where age between 0 and 13
     group by event_id
  ),
  eligible_events as (
    select c.id, c.organiser_id, c.starts_at, c.boost, r.r_raw, r.n
      from candidates c
      join raw_scores r on r.event_id = c.id
     where r.n >= 3
  ),
  prior_median as (
    select percentile_cont(0.5) within group (order by r_raw) as median from eligible_events
  ),
  scored as (
    select x.id, x.organiser_id, x.starts_at,
           private.trending_shrink(x.r_raw, x.n, p.median, 2)
             * private.trending_proximity(x.starts_at, p_now)
             * x.boost as score
      from eligible_events x cross join prior_median p
  ),
  per_organiser as (
    select s.*, row_number() over (partition by s.organiser_id order by s.score desc, s.starts_at, s.id) as organiser_rank
      from scored s
  ),
  top_events as (
    select p.id, p.score, row_number() over (order by p.score desc, p.starts_at, p.id) as rank
      from per_organiser p
     where p.organiser_rank <= 2
  ),
  inserted as (
    insert into private.trending_snapshot (rank, event_id, score, computed_at)
    select t.rank, t.id, t.score, p_now from top_events t where t.rank <= 24
    returning 1
  )
  select (select count(*)::integer from eligible_events), (select count(*)::integer from inserted)
    into eligible, ranked;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin curation
-- ---------------------------------------------------------------------------

-- Sets p_event_id's curation (any status). Key-share-locks the event (so it
-- can't be deleted mid-call, without holding up checkouts), then locks its
-- curation row. Nothing changing is 'unchanged' (nothing logged); otherwise
-- the row is updated and a 'curated' moderation log entry written with the
-- admin, p_reason and, in `details`, the old and new value of each changed
-- field, in one step. Returns 'updated', 'unchanged' or 'not_found'.
create function private.set_event_curation(
  p_event_id uuid, p_admin_id uuid, p_boost numeric, p_excluded boolean, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_boost numeric(3, 2) := round(p_boost, 2);
  v_old_boost numeric(3, 2);
  v_old_excluded boolean;
  v_details jsonb := '{}'::jsonb;
begin
  perform 1 from public.events e where e.id = p_event_id for key share;
  if not found then
    return 'not_found';
  end if;

  insert into private.event_curation (event_id) values (p_event_id) on conflict (event_id) do nothing;
  select c.boost, c.excluded into v_old_boost, v_old_excluded
    from private.event_curation c where c.event_id = p_event_id for update;

  if v_old_boost <> v_boost then
    v_details := v_details || jsonb_build_object('boost', jsonb_build_object('old', v_old_boost, 'new', v_boost));
  end if;
  if v_old_excluded <> p_excluded then
    v_details := v_details || jsonb_build_object('excluded', jsonb_build_object('old', v_old_excluded, 'new', p_excluded));
  end if;
  if v_details = '{}'::jsonb then
    return 'unchanged';
  end if;

  update private.event_curation
     set boost = v_boost, excluded = p_excluded, updated_by = p_admin_id, updated_at = now()
   where event_id = p_event_id;
  insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
  values (p_event_id, 'curated', p_admin_id, p_reason, v_details);
  return 'updated';
end;
$$;

revoke all on function private.trending_day_utility(integer, boolean, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function private.trending_decay(integer) from public, anon, authenticated;
revoke all on function private.trending_shrink(double precision, integer, double precision, double precision) from public, anon, authenticated;
revoke all on function private.trending_proximity(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.refresh_trending(timestamptz) from public, anon, authenticated;
revoke all on function private.set_event_curation(uuid, uuid, numeric, boolean, text) from public, anon, authenticated;
