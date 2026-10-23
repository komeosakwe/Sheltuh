-- Trending: eligibility counts distinct people, not actions (manager decision,
-- 21 Oct 2026, docs/FEATURE_PLAN.md; docs/architecture.md, "Trending").
--
--   * private.refresh_trending is replaced. An event is eligible only when at
--     least 3 DIFFERENT people engaged with it in the 14-day window
--     (favourite, Who's Going opt-in, paid or free order). One person
--     favouriting, opting in and buying tickets is still one person, so
--     nobody can make an event trend alone. The same count is the n of the
--     shrinkage (it was the number of engagement events after the daily caps).
--   * A person is a normalised email address (private.email_key: lower case,
--     trimmed, no +tag, Gmail dots and googlemail.com folded) where there is
--     one: the account's email for favourites and opt-ins, the buyer email
--     for orders, so a member's favourite and their guest checkout are one
--     person. An account without an email counts by its user id. An order
--     without a buyer email still adds to the score but to nobody's count.
--   * The organiser's own activity is left out by the same key: favourites
--     and opt-ins by the owner account, and anything by a person whose key is
--     the owner account's email or the organiser's contact email (so
--     owner+promo@ and o.wner@gmail.com no longer slip through, and neither
--     does an account registered with the contact email).
--   * The score itself is unchanged: daily utility from action counts, with
--     the same caps, decay, proximity and boost; the formula functions
--     (private.trending_day_utility, _decay, _shrink, _proximity) are kept as
--     they are. Days are still Melbourne days (`at time zone
--     'Australia/Melbourne'`, so daylight saving moves midnight's UTC instant).
--   * orders_event_paid_created_idx (event_id, created_at) where status =
--     'paid': the refresh reads each candidate event's paid orders over the
--     last 14 days. The existing partial indexes lead with event_id but then
--     hold lower(buyer_email) or buyer_email_key (free orders only), so they
--     can't bound the date range; this one serves the range scan per event.
--
-- Same signature, same grants (none): `create or replace` keeps the revoked
-- execute privilege, and it's revoked again below for clarity.
--
-- Additive and reversible: re-create private.refresh_trending from
-- 20261023000000_trending.sql and drop index orders_event_paid_created_idx.
-- No data changes; the snapshot is rebuilt by the next refresh.

create index orders_event_paid_created_idx on public.orders (event_id, created_at) where status = 'paid';

-- Rebuilds private.trending_snapshot as of p_now (default now(); tests pass
-- another instant). An event is eligible when it's published, its organiser
-- is approved, it hasn't ended, it starts within 60 days, its latest
-- approval is at least 6 hours old, an admin hasn't excluded it, and at least
-- 3 distinct people (see above) engaged with it in the 14-day window
-- (favourites, Who's Going opt-ins and paid orders, free ones included;
-- views aren't engagement). The organiser's own activity doesn't count (see
-- above). Opt-ins of suspended members don't count either (they're left out
-- of every Who's Going count). At most 2 events per organiser, then the top
-- 24. Ties: sooner start, then id.
--
-- Returns how many events were eligible and how many were ranked. A
-- transaction-scoped advisory lock serialises concurrent refreshes; readers
-- keep seeing the previous snapshot until this one commits. Deletes (not
-- truncates) the old rows, so readers are never blocked.
create or replace function private.refresh_trending(p_now timestamptz default now(), out eligible integer, out ranked integer)
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Australia/Melbourne')::date;
  v_from date := (p_now at time zone 'Australia/Melbourne')::date - 13;
  -- Midnight starting v_from in Melbourne, as an instant (its UTC offset is
  -- that day's, not today's, across a daylight-saving change).
  v_from_at timestamptz := (((p_now at time zone 'Australia/Melbourne')::date - 13)::timestamp at time zone 'Australia/Melbourne');
begin
  perform pg_advisory_xact_lock(hashtextextended('private.refresh_trending', 0));

  delete from private.trending_snapshot;

  with candidates as (
    select e.id, e.organiser_id, e.starts_at, o.owner_user_id,
           'e:' || private.email_key(u.email) as owner_key,
           'e:' || private.email_key(o.contact_email) as contact_key,
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
  -- One row per engagement in the window, with the person behind it (null:
  -- an order without a buyer email, which nobody can be told apart by).
  engagements_all as (
    select f.event_id, f.created_at, 'favourite'::text as kind,
           coalesce('e:' || private.email_key(u.email), 'u:' || f.user_id::text) as person,
           (f.user_id = c.owner_user_id) as by_owner, c.owner_key, c.contact_key
      from public.event_favourites f
      join candidates c on c.id = f.event_id
      left join auth.users u on u.id = f.user_id
     where f.created_at >= v_from_at and f.created_at <= p_now
    union all
    select a.event_id, a.created_at, 'going',
           coalesce('e:' || private.email_key(u.email), 'u:' || a.user_id::text),
           (a.user_id = c.owner_user_id), c.owner_key, c.contact_key
      from public.event_attendees a
      join candidates c on c.id = a.event_id
      left join auth.users u on u.id = a.user_id
     where a.created_at >= v_from_at and a.created_at <= p_now
       and not exists (select 1 from private.social_suspensions s where s.user_id = a.user_id)
    union all
    select r.event_id, r.created_at, case when r.total_cents > 0 then 'paid' else 'free' end,
           'e:' || private.email_key(r.buyer_email),
           false, c.owner_key, c.contact_key
      from public.orders r
      join candidates c on c.id = r.event_id
     where r.status = 'paid'
       and r.created_at >= v_from_at and r.created_at <= p_now
  ),
  engagements as (
    select g.event_id, (g.created_at at time zone 'Australia/Melbourne')::date as day, g.kind, g.person
      from engagements_all g
     where not coalesce(g.by_owner, false)
       and g.person is distinct from g.owner_key
       and g.person is distinct from g.contact_key
  ),
  people as (
    select event_id, count(distinct person)::integer as n
      from engagements
     where person is not null
     group by event_id
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
    select g.event_id, g.day, 0, false,
           (count(*) filter (where g.kind = 'favourite'))::integer,
           (count(*) filter (where g.kind = 'going'))::integer,
           (count(*) filter (where g.kind = 'paid'))::integer,
           (count(*) filter (where g.kind = 'free'))::integer
      from engagements g
     group by g.event_id, g.day
  ),
  days as (
    select event_id, day,
           private.trending_day_utility(sum(views)::integer, bool_or(flood), sum(favourites)::integer,
                                        sum(going)::integer, sum(paid_orders)::integer, sum(free_orders)::integer) as utility,
           v_today - day as age
      from activity
     group by event_id, day
  ),
  raw_scores as (
    select event_id, sum(utility * private.trending_decay(age)) as r_raw
      from days
     where age between 0 and 13
     group by event_id
  ),
  eligible_events as (
    select c.id, c.organiser_id, c.starts_at, c.boost, r.r_raw, p.n
      from candidates c
      join raw_scores r on r.event_id = c.id
      join people p on p.event_id = c.id
     where p.n >= 3
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

revoke all on function private.refresh_trending(timestamptz) from public, anon, authenticated;
