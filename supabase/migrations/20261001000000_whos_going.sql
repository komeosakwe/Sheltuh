-- "Who's Going", increment 1.
--
-- A member is "going" to an event when all of these hold:
--   * they're signed in with a verified email (checked by the API, which
--     passes that email in);
--   * a `paid` order for the event (free tickets are paid orders at A$0) has
--     a buyer_email equal, case-insensitively, to that verified email;
--   * they have a social profile that isn't suspended;
--   * they explicitly opted in for that event (off by default).
-- The public only ever sees a count. Verified members see display names,
-- never emails, user ids or ticket types. Nothing is shown once the event
-- has ended.
--
-- Same access model as every other table: RLS on, no policies, no grants to
-- anon/authenticated. Only the API (lib/server/handlers/going.ts and
-- profiles.ts) reads or writes these.
--
-- Reversible: drop function private.set_going, drop tables event_attendees
-- then profiles, drop index orders_event_paid_email_idx, and drop column
-- events.whos_going_enabled. Dropping the tables deletes profile and opt-in
-- data, so reversing it after launch is destructive.

-- ---------------------------------------------------------------------------
-- Profiles: a member's public-facing identity for social features.
-- ---------------------------------------------------------------------------

create table public.profiles (
  -- Deleting the Supabase account deletes the profile (and, through
  -- event_attendees' cascade, every opt-in).
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (char_length(display_name) between 1 and 40 and display_name = btrim(display_name)),
  -- A profile can't exist without the member confirming they're 18+.
  adult_confirmed_at timestamptz not null,
  -- Set by an admin (docs/supabase-setup.md). Hides the member from every
  -- Who's Going list and count, and blocks new opt-ins.
  social_suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Event attendees: one row per explicit opt-in.
-- ---------------------------------------------------------------------------

create table public.event_attendees (
  -- Exposed to members as the opaque attendeeId. Minted per opt-in, so the
  -- same person has a different id on every event and ids can't be joined
  -- across events or back to a user.
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

-- The attendee list: filter by event, keyset-friendly order by (created_at, id).
-- The unique (event_id, user_id) index already serves counts and "am I going".
create index event_attendees_event_created_idx on public.event_attendees (event_id, created_at, id);
-- The profiles FK cascade (profile/account deletion) looks rows up by user_id.
create index event_attendees_user_idx on public.event_attendees (user_id);

-- ---------------------------------------------------------------------------
-- Per-event kill switch (admin-only, via SQL: docs/supabase-setup.md).
-- A constant default is a metadata-only change: no table rewrite.
-- ---------------------------------------------------------------------------

alter table public.events add column whos_going_enabled boolean not null default true;

-- Eligibility looks up "a paid order for this event with this email". Partial,
-- so it only indexes paid orders, and on lower() so the case-insensitive match
-- can use it.
create index orders_event_paid_email_idx on public.orders (event_id, lower(buyer_email)) where status = 'paid';

-- ---------------------------------------------------------------------------
-- Lock the Data API out
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.event_attendees enable row level security;

revoke all on public.profiles, public.event_attendees from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Opt in. The whole eligibility check and the insert are one atomic step.
-- ---------------------------------------------------------------------------

-- p_email must be the caller's *verified* email; the API only passes one it
-- got from Supabase Auth with email_confirmed_at set.
-- Returns:
--   'going'             opted in (or already was: idempotent)
--   'event_unavailable' not published, Who's Going disabled, or already ended
--   'no_profile'        the member hasn't created a profile
--   'suspended'         the member's profile is suspended from social features
--   'not_eligible'      no paid order for this event under that email
-- The event and profile rows are share-locked (event first, then profile,
-- always), so an unpublish, a suspension or a profile deletion can't
-- interleave with the check and leave an opt-in that shouldn't exist.
create function private.set_going(p_event_id uuid, p_user_id uuid, p_email text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_suspended_at timestamptz;
begin
  perform 1 from public.events
   where id = p_event_id and status = 'published' and whos_going_enabled and ends_at > now()
     for share;
  if not found then
    return 'event_unavailable';
  end if;

  select social_suspended_at into v_suspended_at from public.profiles where user_id = p_user_id for share;
  if not found then
    return 'no_profile';
  end if;
  if v_suspended_at is not null then
    return 'suspended';
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

-- New functions are executable by PUBLIC by default; the init migration's
-- blanket revoke only covered functions that existed then.
revoke all on function private.set_going(uuid, uuid, text) from public, anon, authenticated;
