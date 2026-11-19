-- Member usernames (docs/architecture.md, "Usernames"; owner decisions 19 Nov
-- 2026): an optional "@username" a member sets in settings, shown to them
-- (GET /me) and, exactly where their profileId is, on their visible member
-- profile and next to them on Who's Going. Never in a URL; nothing looks a
-- member up by username.
--
--   * private.member_username_key(username): the lookalike-folded key names
--     are unique on: '.' and '_' dropped, then i/1 -> l, 0 -> o, rn -> m (the
--     ASCII part of skeleton() in lib/lookalikes.ts; lib/username.ts's
--     usernameKey computes the same, tests/server/usernames.test.ts pins
--     the two together). "1atte", "lat.te" and "latte" share a key.
--   * private.member_username_ok(username): the database's structural floor
--     (the API's parseUsername is stricter: reserved words, claim words,
--     web-address-like names): 3 to 20 of a-z 0-9 _ . ; starts and ends with
--     a letter, digit or _; no '..'; at least one letter; at most 4 digits;
--     no "sheltuh" in the key. Applied by the trigger member_usernames_valid
--     when a name is new to the row (organisers_custom_tags_valid's pattern),
--     so tightening the rule later never blocks an unrelated update.
--   * private.member_usernames: live names and holds in one key space, so the
--     primary key is the race arbiter. user_id null = held: a released name
--     (changed, cleared, removed by an admin, or its account deleted, via the
--     FK's SET NULL) is held for 30 days for everyone, its previous owner
--     included (trigger member_usernames_hold sets held_until). A live name
--     can't pass straight to another account: only through a hold.
--   * private.member_username_changes: one clock row per member who has ever
--     claimed: first_claimed_at, last_claimed_at. A change is allowed with no
--     claim yet, 30 days after the latest claim, or at any time (any number
--     of changes) within 24 hours of the first claim (the typo window).
--     Clearing never resets it; an admin removal restarts it and closes the
--     typo window. Both timestamps are null while a member's first claim is
--     in progress or failed (the row exists so the claim can lock it).
--   * private.member_username_state(user): the username and changeable_at
--     (null when a change is allowed now): the only reader of the rule.
--   * private.claim_member_username / private.clear_member_username: the
--     member's save and clear, each one atomic step.
--   * private.admin_remove_profile_content gains 'username' (same signature,
--     20261024000100_member_profiles.sql's body otherwise unchanged), and
--     private.profile_moderation_log's removed-fields check allows it.
--   * private.purge_social_data (same OUT list, 20261116000000_external_going.sql's
--     body otherwise unchanged) deletes holds that have run out, and clock
--     rows of members with no username whose rule no longer limits anything
--     (latest claim over 30 days ago, first over 24 hours ago) or that never
--     completed a claim.
--
-- Locks, in this order everywhere: the account (auth.users, key share, so an
-- account deletion, which locks it first and then cascades to both tables,
-- waits rather than deadlocks), the profile (admin removal only), the clock
-- row, then username rows in key order. Two members swapping names lock the
-- same two keys in the same order, so one waits and both get 'taken'.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC and its
-- search_path pinned. None is security definer.
--
-- Indexes: member_usernames' primary key (username_key) serves every claim
-- and availability check; its unique user_id serves each member's own name
-- (GET /me, Who's Going, member profiles: one index probe per row) and the
-- auth.users SET NULL; member_usernames_held_idx (held_until) where user_id
-- is null serves the purge of expired holds. member_username_changes is read
-- by its primary key; the daily purge scans it (one small row per member who
-- ever claimed), so no other index.
--
-- Additive for the previous app: two new tables, new functions; the two
-- redefined functions keep their signatures and behave as before for every
-- input the previous app sends, and the relaxed check accepts every row the
-- old one did. Can be applied before the app.
--
-- Reversible, with data loss: drop the functions added here and the two
-- triggers, then tables private.member_username_changes and
-- private.member_usernames (every username and hold); restore
-- private.admin_remove_profile_content from 20261024000100_member_profiles.sql
-- and private.purge_social_data from 20261116000000_external_going.sql. The
-- old removed-fields check can only be restored after deleting (or editing)
-- the moderation log entries that name 'username'.

-- ---------------------------------------------------------------------------
-- The rules
-- ---------------------------------------------------------------------------

create function private.member_username_key(p_username text) returns text
language sql
immutable
strict
set search_path = ''
as $$
  select replace(translate(replace(replace(p_username, '.', ''), '_', ''), 'i10', 'llo'), 'rn', 'm');
$$;

create function private.member_username_ok(p_username text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_username is not null
     and p_username ~ '^[a-z0-9_][a-z0-9_.]{1,18}[a-z0-9_]$'
     and strpos(p_username, '..') = 0
     and p_username ~ '[a-z]'
     and char_length(regexp_replace(p_username, '[^0-9]', '', 'g')) <= 4
     and strpos(private.member_username_key(p_username), 'sheltuh') = 0;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table private.member_usernames (
  username_key text primary key,
  username text not null,
  -- Null: held (released), until held_until.
  user_id uuid unique references auth.users (id) on delete set null,
  held_until timestamptz,
  claimed_at timestamptz not null default now(),
  constraint member_usernames_key_check check (username_key = private.member_username_key(username)),
  constraint member_usernames_hold_check check ((user_id is null) = (held_until is not null))
);

create index member_usernames_held_idx on private.member_usernames (held_until) where user_id is null;

alter table private.member_usernames enable row level security;
revoke all on private.member_usernames from public, anon, authenticated;

create table private.member_username_changes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_claimed_at timestamptz,
  last_claimed_at timestamptz,
  constraint member_username_changes_clock_check check (
    (first_claimed_at is null) = (last_claimed_at is null)
    and (first_claimed_at is null or first_claimed_at <= last_claimed_at)
  )
);

alter table private.member_username_changes enable row level security;
revoke all on private.member_username_changes from public, anon, authenticated;

-- A name new to the row must pass member_username_ok; one already there
-- isn't re-checked (a hold, an admin removal, a re-claim of the same spelling).
create function private.member_usernames_valid() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.username is distinct from old.username)
     and not private.member_username_ok(new.username) then
    raise exception 'That username isn''t accepted.'
      using errcode = 'check_violation', constraint = 'member_usernames_valid';
  end if;
  return new;
end;
$$;

create trigger member_usernames_valid before insert or update of username on private.member_usernames
  for each row execute function private.member_usernames_valid();

-- Releasing a name (user_id to null: a change, a clear, an admin removal, or
-- the account's deletion through the FK) holds it for 30 days; claiming one
-- clears the hold. A live name never passes straight to another account.
create function private.member_usernames_hold() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is null then
    if old.user_id is not null then
      new.held_until := now() + interval '30 days';
    end if;
  else
    if old.user_id is not null and old.user_id <> new.user_id then
      raise exception 'A username can''t pass straight to another account.'
        using errcode = 'check_violation', constraint = 'member_usernames_hold';
    end if;
    new.held_until := null;
  end if;
  return new;
end;
$$;

create trigger member_usernames_hold before update of user_id on private.member_usernames
  for each row execute function private.member_usernames_hold();

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- The member's username (null: none) and when they may next change it (null:
-- now). Allowed with no completed claim, within 24 hours of the first claim,
-- or 30 days after the latest. Always one row.
create function private.member_username_state(p_user_id uuid, out username text, out changeable_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select (select u.username from private.member_usernames u where u.user_id = p_user_id),
         (select case when c.last_claimed_at is null
                        or now() < c.first_claimed_at + interval '24 hours'
                        or now() >= c.last_claimed_at + interval '30 days'
                      then null
                      else c.last_claimed_at + interval '30 days' end
            from private.member_username_changes c where c.user_id = p_user_id);
$$;

-- ---------------------------------------------------------------------------
-- Claiming and clearing
-- ---------------------------------------------------------------------------

-- p_user_id claims p_username (already normalised and checked by the API; the
-- trigger checks again). Returns (result, changeable_at):
--   'claimed'          now theirs; any previous name of theirs is held
--   'unchanged'        already their name, spelt the same: nothing written
--   'too_soon'         the clock forbids a change until changeable_at
--   'taken'            live for someone else, or held (the same answer)
--   'suspended'        a suspended member can't claim
--   'user_unavailable' no such account (deleted)
-- changeable_at is set for 'too_soon', and after a claim when the next
-- change has to wait.
create function private.claim_member_username(
  p_user_id uuid, p_username text, out result text, out changeable_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_key text := private.member_username_key(p_username);
  v_current text;
  v_current_key text;
begin
  perform 1 from auth.users u where u.id = p_user_id for key share;
  if not found then
    result := 'user_unavailable';
    return;
  end if;

  -- The clock row, created if need be and locked by the same statement (a
  -- no-op update), so one member's saves run one at a time.
  insert into private.member_username_changes as c (user_id) values (p_user_id)
  on conflict (user_id) do update set first_claimed_at = c.first_claimed_at;

  if exists (select 1 from private.social_suspensions s where s.user_id = p_user_id) then
    result := 'suspended';
    return;
  end if;

  select u.username, u.username_key into v_current, v_current_key
    from private.member_usernames u where u.user_id = p_user_id;
  if v_current = p_username then
    result := 'unchanged';
    select s.changeable_at into changeable_at from private.member_username_state(p_user_id) s;
    return;
  end if;

  select s.changeable_at into changeable_at from private.member_username_state(p_user_id) s;
  if changeable_at is not null then
    result := 'too_soon';
    return;
  end if;

  -- A plain read first: most refusals take no lock.
  if exists (select 1 from private.member_usernames u
              where u.username_key = v_key
                and ((u.user_id is not null and u.user_id <> p_user_id)
                     or (u.user_id is null and u.held_until > now()))) then
    result := 'taken';
    return;
  end if;

  perform 1 from private.member_usernames u
   where u.username_key in (v_key, v_current_key)
   order by u.username_key
     for update;

  begin
    if v_current_key = v_key then
      -- The same key, spelt differently ("lat.te" for "latte"): theirs already.
      update private.member_usernames u set username = p_username, claimed_at = now()
       where u.username_key = v_key and u.user_id = p_user_id;
      if not found then
        raise exception 'taken' using errcode = 'P0001';
      end if;
    else
      update private.member_usernames u set user_id = null where u.user_id = p_user_id;
      insert into private.member_usernames as u (username_key, username, user_id)
      values (v_key, p_username, p_user_id)
      on conflict (username_key) do update
         set username = excluded.username, user_id = excluded.user_id, held_until = null, claimed_at = now()
       where u.user_id is null and u.held_until <= now();
      if not found then
        raise exception 'taken' using errcode = 'P0001';
      end if;
    end if;
  exception
    when raise_exception or unique_violation then
      -- Their old name is theirs again (the release rolled back with this block).
      result := 'taken';
      changeable_at := null;
      return;
  end;

  update private.member_username_changes c
     set first_claimed_at = coalesce(c.first_claimed_at, now()), last_claimed_at = now()
   where c.user_id = p_user_id;

  select s.changeable_at into changeable_at from private.member_username_state(p_user_id) s;
  result := 'claimed';
end;
$$;

-- p_user_id clears their username, which is then held for 30 days. The clock
-- is untouched. Returns 'cleared' or 'unchanged' (none). A suspended member
-- may clear.
create function private.clear_member_username(p_user_id uuid) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from auth.users u where u.id = p_user_id for key share;
  perform 1 from private.member_username_changes c where c.user_id = p_user_id for update;
  update private.member_usernames u set user_id = null where u.user_id = p_user_id;
  if found then
    return 'cleared';
  end if;
  return 'unchanged';
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin removal: as in 20261024000100_member_profiles.sql, plus 'username':
-- the clock row, then the name, which is held for 30 days like any released
-- name; the clock restarts (last claim now, the typo window closed), so the
-- member can't pick another for 30 days. Same signature, hence create or
-- replace.
-- ---------------------------------------------------------------------------

-- An admin removes some of a member's profile content: 'avatar', 'bio',
-- 'instagram', 'username' (others ignored). Only what's actually there is
-- removed and logged. Locks the profile row (no key update) first, then the
-- photo, then the username clock and name.
-- Returns (result, removed): 'removed' with the fields removed,
-- 'unchanged' (none of them was set: nothing logged) or 'not_found'.
create or replace function private.admin_remove_profile_content(
  p_admin_id uuid, p_profile_id uuid, p_fields text[], p_reason text, out result text, out removed text[])
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_bio text;
  v_instagram text;
begin
  removed := array[]::text[];
  select p.user_id, p.bio, p.instagram_handle into v_user, v_bio, v_instagram
    from public.profiles p where p.public_id = p_profile_id
     for no key update;
  if not found then
    result := 'not_found';
    return;
  end if;

  if 'avatar' = any(p_fields) then
    delete from private.profile_avatars a where a.user_id = v_user;
    if found then
      removed := removed || 'avatar'::text;
    end if;
  end if;
  if 'bio' = any(p_fields) and v_bio is not null then
    removed := removed || 'bio'::text;
  end if;
  if 'instagram' = any(p_fields) and v_instagram is not null then
    removed := removed || 'instagram'::text;
  end if;
  if 'username' = any(p_fields) then
    insert into private.member_username_changes as c (user_id) values (v_user)
    on conflict (user_id) do update set first_claimed_at = c.first_claimed_at;
    update private.member_usernames u set user_id = null where u.user_id = v_user;
    if found then
      removed := removed || 'username'::text;
      update private.member_username_changes c
         set first_claimed_at = least(coalesce(c.first_claimed_at, now()), now() - interval '24 hours'),
             last_claimed_at = now()
       where c.user_id = v_user;
    end if;
  end if;

  if cardinality(removed) = 0 then
    result := 'unchanged';
    return;
  end if;

  update public.profiles p
     set bio = case when 'bio' = any(removed) then null else p.bio end,
         instagram_handle = case when 'instagram' = any(removed) then null else p.instagram_handle end
   where p.user_id = v_user;

  insert into private.profile_moderation_log (user_id, admin_id, removed, reason)
  values (v_user, p_admin_id, removed, p_reason);
  result := 'removed';
end;
$$;

alter table private.profile_moderation_log
  drop constraint profile_moderation_log_removed_check,
  add constraint profile_moderation_log_removed_check
    check (cardinality(removed) between 1 and 4 and removed <@ array['avatar', 'bio', 'instagram', 'username']::text[]);

-- ---------------------------------------------------------------------------
-- Retention: as in 20261116000000_external_going.sql, plus holds that have
-- run out, and clock rows that no longer limit anything (no username, and
-- the latest claim over 30 days ago and the first over 24 hours ago, or no
-- claim ever completed). A member with a username keeps their clock row, so
-- the typo window stays the first claim's. Same signature, hence create or
-- replace.
-- ---------------------------------------------------------------------------

create or replace function private.purge_social_data(
  out event_attendees_deleted integer, out rate_limits_deleted integer,
  out conversations_deleted integer, out user_reports_deleted integer,
  out conversation_pairs_deleted integer, out waitlist_entries_deleted integer,
  out waitlist_tokens_deleted integer, out profile_moderation_deleted integer,
  out follow_tokens_deleted integer, out report_photos_deleted integer)
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.event_attendees a
   using public.events e
   where e.id = a.event_id and e.ends_at < now() - interval '30 days';
  get diagnostics event_attendees_deleted = row_count;

  delete from private.external_event_going g
   using public.events e
   where e.id = g.event_id and e.ends_at < now() - interval '30 days';

  delete from private.rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics rate_limits_deleted = row_count;

  -- Messages go with their conversation (cascade); reports keep their copies.
  delete from public.conversations where last_message_at < now() - interval '12 months';
  get diagnostics conversations_deleted = row_count;

  delete from private.user_reports where status <> 'open' and resolved_at < now() - interval '2 years';
  get diagnostics user_reports_deleted = row_count;

  delete from private.conversation_pairs cp
   where cp.created_at < now() - interval '12 months'
     and not exists (select 1 from public.conversations c where c.user_low = cp.user_low and c.user_high = cp.user_high);
  get diagnostics conversation_pairs_deleted = row_count;

  delete from private.event_waitlist w
   using public.events e
   where e.id = w.event_id and e.ends_at < now() - interval '30 days';
  get diagnostics waitlist_entries_deleted = row_count;
  delete from private.event_waitlist w
   where (w.confirmed_at is null and w.created_at < now() - interval '8 days'
          and not exists (select 1 from private.event_waitlist_tokens t
                           where t.entry_id = w.id and t.purpose = 'confirm'
                             and t.created_at > now() - interval '8 days'))
      or w.unsubscribed_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  waitlist_entries_deleted := waitlist_entries_deleted + v_count;

  delete from private.event_waitlist_tokens t where t.expires_at < now() - interval '7 days';
  get diagnostics waitlist_tokens_deleted = row_count;

  delete from private.profile_moderation_log l where l.created_at < now() - interval '2 years';
  get diagnostics profile_moderation_deleted = row_count;

  delete from private.organiser_follow_tokens t where t.created_at < now() - interval '90 days';
  get diagnostics follow_tokens_deleted = row_count;

  -- After the reports above, so a photo whose last report just went goes too.
  delete from private.report_photos ph
   where ph.last_used_at < now() - interval '1 day'
     and not exists (select 1 from private.user_reports r where r.reported_avatar_sha256 = ph.sha256);
  get diagnostics report_photos_deleted = row_count;

  delete from private.member_usernames u where u.user_id is null and u.held_until <= now();
  delete from private.member_username_changes c
   where (c.last_claimed_at is null
          or (c.last_claimed_at < now() - interval '30 days' and c.first_claimed_at < now() - interval '24 hours'))
     and not exists (select 1 from private.member_usernames u where u.user_id = c.user_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.member_username_key(text) from public, anon, authenticated;
revoke all on function private.member_username_ok(text) from public, anon, authenticated;
revoke all on function private.member_usernames_valid() from public, anon, authenticated;
revoke all on function private.member_usernames_hold() from public, anon, authenticated;
revoke all on function private.member_username_state(uuid) from public, anon, authenticated;
revoke all on function private.claim_member_username(uuid, text) from public, anon, authenticated;
revoke all on function private.clear_member_username(uuid) from public, anon, authenticated;
revoke all on function private.admin_remove_profile_content(uuid, uuid, text[], text) from public, anon, authenticated;
revoke all on function private.purge_social_data() from public, anon, authenticated;
