-- Who's Going hardening (review fixes).
--
-- 1. Suspensions move out of public.profiles into private.social_suspensions.
--    A member can delete their own profile (DELETE /api/profiles/me), which
--    used to take profiles.social_suspended_at with it: delete, recreate, and
--    the suspension was gone. The new table is keyed on the auth user, so
--    only deleting the whole Supabase account removes it. The API checks it
--    in set_going, the public count, the attendee list, and before creating
--    or renaming a profile.
-- 2. private.rate_limits + private.take_rate_limit: a small fixed-window,
--    per-user counter. Used to rate-limit the attendee list.
-- 3. private.purge_social_data(): retention. Deletes Who's Going opt-ins 30
--    days after their event ended, and stale rate-limit rows. Scheduled with
--    Supabase Cron (docs/supabase-setup.md), not from this migration.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, and every new function's execute revoked from PUBLIC.
--
-- profiles.social_suspended_at is kept (dropping a column needs sign-off) but
-- is no longer read by anything: its values are copied into
-- private.social_suspensions below. Drop it in a later migration.
--
-- Reversible: drop function private.purge_social_data and
-- private.take_rate_limit, drop table private.rate_limits, recreate
-- private.set_going from 20261001000000_whos_going.sql, copy
-- private.social_suspensions back into profiles.social_suspended_at, then drop
-- table private.social_suspensions. Dropping the tables after launch discards
-- suspensions that belong to members without a profile (they'd need to be
-- recorded again), so reversing it then is destructive.

-- ---------------------------------------------------------------------------
-- Suspensions
-- ---------------------------------------------------------------------------

create table private.social_suspensions (
  -- Keyed on the account, not the profile, so deleting and recreating a
  -- profile can't clear it. Deleting the account removes it (with everything
  -- else about that person).
  user_id uuid primary key references auth.users (id) on delete cascade,
  suspended_at timestamptz not null default now(),
  -- Free text for the admin's own records. Never shown to anyone.
  reason text
);

alter table private.social_suspensions enable row level security;
revoke all on private.social_suspensions from public, anon, authenticated;

insert into private.social_suspensions (user_id, suspended_at, reason)
select user_id, social_suspended_at, 'Migrated from profiles.social_suspended_at'
  from public.profiles
 where social_suspended_at is not null
on conflict (user_id) do nothing;

comment on column public.profiles.social_suspended_at is
  'Deprecated and ignored since 20261002000000_whos_going_hardening: suspensions live in private.social_suspensions.';

-- Opt in. Same contract as before (see 20261001000000_whos_going.sql), with
-- the suspension read from private.social_suspensions, and checked *before*
-- the profile: a suspended member who deleted their profile gets 'suspended'
-- (403), not 'no_profile' (409, "create a profile").
--
-- A suspension recorded while this runs can't be locked out in advance (there's
-- no row to lock yet), so an opt-in can slip in alongside it. That's harmless:
-- every count and list filters suspended members out at read time.
create or replace function private.set_going(p_event_id uuid, p_user_id uuid, p_email text) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events
   where id = p_event_id and status = 'published' and whos_going_enabled and ends_at > now()
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
-- Per-user rate limits
-- ---------------------------------------------------------------------------

-- One row per (user, bucket): the start of the current window and the hits in
-- it. Tiny (one row per active member per bucket), and purge_social_data
-- clears stale rows; looked up only by its primary key, so no other index.
create table private.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null check (char_length(bucket) between 1 and 64),
  window_started_at timestamptz not null,
  hits integer not null check (hits >= 1),
  primary key (user_id, bucket)
);

alter table private.rate_limits enable row level security;
revoke all on private.rate_limits from public, anon, authenticated;

-- Records one hit and returns whether it's within p_limit hits per p_window.
-- A single upsert, so concurrent hits serialise on the row and can't both
-- take the last slot. Fixed window: the first hit after the window has passed
-- starts a new one. `hits` stops at p_limit + 1 so a hammering client can't
-- overflow it.
create function private.take_rate_limit(p_user_id uuid, p_bucket text, p_limit integer, p_window interval)
returns boolean
language sql
set search_path = ''
as $$
  insert into private.rate_limits as r (user_id, bucket, window_started_at, hits)
  values (p_user_id, p_bucket, now(), 1)
  on conflict (user_id, bucket) do update
     set window_started_at = case when r.window_started_at <= now() - p_window then now() else r.window_started_at end,
         hits = case when r.window_started_at <= now() - p_window then 1 else least(r.hits + 1, p_limit + 1) end
  returning hits <= p_limit;
$$;

revoke all on function private.take_rate_limit(uuid, text, integer, interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- Deletes every Who's Going opt-in whose event ended more than 30 days ago
-- (nothing is shown once an event ends; the 30 days leave room to handle a
-- report about it), and rate-limit rows idle for over a day. Idempotent; run
-- daily by Supabase Cron (docs/supabase-setup.md).
-- events is small and ends_at is only filtered here, once a day, so there's
-- no index on it; the delete reaches event_attendees by its (event_id, …) index.
create function private.purge_social_data(out event_attendees_deleted integer, out rate_limits_deleted integer)
language plpgsql
set search_path = ''
as $$
begin
  delete from public.event_attendees a
   using public.events e
   where e.id = a.event_id and e.ends_at < now() - interval '30 days';
  get diagnostics event_attendees_deleted = row_count;

  delete from private.rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics rate_limits_deleted = row_count;
end;
$$;

revoke all on function private.purge_social_data() from public, anon, authenticated;
