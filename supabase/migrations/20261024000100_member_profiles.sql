-- Member profiles and profile photos (docs/architecture.md, "Member
-- profiles"; owner request 21 Oct 2026, docs/FEATURE_PLAN.md).
--
--   * public.profiles gains:
--       - public_id: an opaque, random id for the profile's URL
--         (/members/{profileId}). Not the user id, not a per-event attendeeId.
--         Unique. A deleted and recreated profile gets a new one.
--       - profile_visible: opt-in (default off). Only a visible profile can be
--         opened by other members, and only then does the Who's Going list
--         link the name to it.
--       - bio (1 to 200 characters) and instagram_handle (Instagram's
--         username rules, as for organisers), both optional.
--   * private.profile_avatars: the member's photo, re-encoded by the API
--     (lib/server/avatar.ts) to a 512 px square WebP and a 96 px thumbnail,
--     with every piece of metadata (EXIF, GPS, ICC, XMP) stripped. Stored in
--     the database like event photos (no Storage bucket). Deleted with the
--     profile.
--   * private.member_profile_visible(viewer, profileId): the single rule for
--     who may see a member's profile, used by every read and write that
--     addresses a member by profileId: the viewer has a profile; neither is
--     suspended; neither blocks the other; and the profile is visible (or is
--     the viewer's own). The API also requires the viewer's verified email.
--   * Reports about a profile (private.file_profile_report): private.user_reports
--     gains target_type ('conversation', 'attendee' or 'profile'; set by a
--     trigger for the two existing kinds) and copies of the profile's bio,
--     Instagram handle and photo, which outlive the profile like message copies.
--   * Blocking and messaging by profileId (private.create_block_by_profile,
--     private.request_conversation_by_profile): the same rules as by
--     attendeeId; a message request still needs both members opted in to the
--     same open event (the soonest such event is recorded as where they met).
--   * private.admin_remove_profile_content: an admin removes a member's photo,
--     bio and/or Instagram handle, logged in private.profile_moderation_log
--     (which fields, by whom, why; never the content). The log is deleted with
--     the account, or 2 years after the entry (private.purge_social_data).
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC, every
-- function's search_path pinned.
--
-- Indexes: profiles_public_id_key (unique) serves every lookup by profileId.
-- profile_avatars is read by its primary key. profile_moderation_log
-- (user_id, id desc) serves the admin view's newest entries per member and
-- the auth.users cascade; (created_at) serves the daily purge. No new index
-- on user_reports: reports are listed by status (existing index).
--
-- The new public_id default is volatile, so adding it rewrites
-- public.profiles once (small: one row per member, before launch).
--
-- Reversible, with data loss: drop the functions and the trigger added here,
-- restore private.purge_social_data from 20261024000000_waitlist.sql; drop
-- tables private.profile_moderation_log and private.profile_avatars (that
-- deletes every photo); drop user_reports' new columns (the copies of
-- reported profiles); drop profiles' new columns (bios, handles, the
-- visibility choice and profile ids, so old profile links stop working).

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column public_id uuid not null default gen_random_uuid(),
  add column profile_visible boolean not null default false,
  add column bio text
    constraint profiles_bio_check check (char_length(bio) between 1 and 200 and bio = btrim(bio)),
  add column instagram_handle text
    constraint profiles_instagram_handle_check
    check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$' and instagram_handle ~ '[A-Za-z0-9]'),
  add constraint profiles_public_id_key unique (public_id);

-- ---------------------------------------------------------------------------
-- Photos
-- ---------------------------------------------------------------------------

create table private.profile_avatars (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  -- Always WebP, made by the server: 512 x 512, and the 96 x 96 thumbnail.
  image bytea not null check (octet_length(image) between 1 and 524288),
  thumb bytea not null check (octet_length(thumb) between 1 and 65536),
  updated_at timestamptz not null default now()
);

alter table private.profile_avatars enable row level security;
revoke all on private.profile_avatars from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Moderation log
-- ---------------------------------------------------------------------------

create table private.profile_moderation_log (
  id bigint generated always as identity primary key,
  -- The member whose content was removed.
  user_id uuid not null references auth.users (id) on delete cascade,
  admin_id uuid references auth.users (id) on delete set null,
  -- Which fields were removed (never their content).
  removed text[] not null
    check (cardinality(removed) between 1 and 3 and removed <@ array['avatar', 'bio', 'instagram']::text[]),
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

create index profile_moderation_log_user_idx on private.profile_moderation_log (user_id, id desc);
create index profile_moderation_log_created_idx on private.profile_moderation_log (created_at);

alter table private.profile_moderation_log enable row level security;
revoke all on private.profile_moderation_log from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reports about profiles
-- ---------------------------------------------------------------------------

alter table private.user_reports
  add column target_type text,
  add column reported_bio text check (char_length(reported_bio) between 1 and 200),
  add column reported_instagram text check (char_length(reported_instagram) between 1 and 30),
  add column reported_avatar bytea check (octet_length(reported_avatar) between 1 and 524288);

-- A conversation report always copied at least one message.
update private.user_reports
   set target_type = case when conversation_id is not null or message_body is not null or context <> '[]'::jsonb
                          then 'conversation' else 'attendee' end;

alter table private.user_reports
  alter column target_type set not null,
  add constraint user_reports_target_type_check check (target_type in ('conversation', 'attendee', 'profile'));

-- private.file_report (conversation or attendee) doesn't name a target type:
-- it's set here, from what it does name, so that function needn't change.
create function private.user_reports_target_type() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.target_type is null then
    new.target_type := case when new.conversation_id is not null then 'conversation' else 'attendee' end;
  end if;
  return new;
end;
$$;

create trigger user_reports_target_type before insert on private.user_reports
  for each row execute function private.user_reports_target_type();

-- ---------------------------------------------------------------------------
-- Who may see a profile
-- ---------------------------------------------------------------------------

-- The member (user id) behind p_public_id if p_viewer may see their profile
-- now, else null: the viewer has a profile; neither is suspended; neither
-- blocks the other; and the profile is visible, or is the viewer's own. The
-- API checks the viewer's verified email before calling it.
create function private.member_profile_visible(p_viewer uuid, p_public_id uuid) returns uuid
language sql
stable
set search_path = ''
as $$
  select t.user_id
    from public.profiles t
   where t.public_id = p_public_id
     and (t.profile_visible or t.user_id = p_viewer)
     and exists (select 1 from public.profiles v where v.user_id = p_viewer)
     and not exists (select 1 from private.social_suspensions s where s.user_id in (p_viewer, t.user_id))
     and not exists (select 1 from public.user_blocks b
                      where (b.blocker_id = p_viewer and b.blocked_id = t.user_id)
                         or (b.blocker_id = t.user_id and b.blocked_id = p_viewer));
$$;

-- ---------------------------------------------------------------------------
-- Reporting a profile
-- ---------------------------------------------------------------------------

-- Files p_reporter_id's report about the member behind p_profile_id, copying
-- their display name, bio, Instagram handle and photo into the report (so it
-- survives them being changed or deleted). The profile needn't be visible any
-- more (it may have been hidden since the reporter saw it), and blocks don't
-- matter (the reporter may have blocked first). Returns (result,
-- new_report_id, filed_at): 'filed', 'not_found' (no such profile, or deleted
-- mid-call), 'self' or 'rate_limited' (over p_limit per p_window). The
-- profile is key-share-locked while it's copied, so a deletion waits for the
-- report.
create function private.file_profile_report(
  p_reporter_id uuid, p_profile_id uuid, p_reason text, p_details text, p_limit integer, p_window interval,
  out result text, out new_report_id uuid, out filed_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_reported uuid;
  v_name text;
  v_bio text;
  v_instagram text;
  v_avatar bytea;
begin
  select p.user_id, p.display_name, p.bio, p.instagram_handle into v_reported, v_name, v_bio, v_instagram
    from public.profiles p where p.public_id = p_profile_id
     for key share;
  if not found then
    result := 'not_found';
    return;
  end if;
  if v_reported = p_reporter_id then
    result := 'self';
    return;
  end if;
  select a.image into v_avatar from private.profile_avatars a where a.user_id = v_reported;

  begin
    if not private.take_rate_limit(p_reporter_id, 'user_reports', p_limit, p_window) then
      raise exception 'rate limited' using errcode = 'P0001';
    end if;
    insert into private.user_reports (reporter_id, reported_user_id, target_type, reason, details,
                                      reported_display_name, reported_bio, reported_instagram, reported_avatar)
    values (p_reporter_id, v_reported, 'profile', p_reason, p_details, v_name, v_bio, v_instagram, v_avatar)
    returning id, created_at into new_report_id, filed_at;
  exception
    when raise_exception then
      result := 'rate_limited';
      new_report_id := null;
      filed_at := null;
      return;
    when foreign_key_violation or deadlock_detected then
      result := 'not_found';
      new_report_id := null;
      filed_at := null;
      return;
  end;
  result := 'filed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Blocking a profile
-- ---------------------------------------------------------------------------

-- As private.create_block (20261004000000_messaging_hardening.sql), for the
-- member behind a profile the blocker can see now (member_profile_visible).
-- Anything else, including someone already blocked either way, is
-- 'not_found'. Returns (result, block_id, block_name, block_created_at):
-- 'blocked', 'not_found', 'self' or 'rate_limited'.
create function private.create_block_by_profile(
  p_blocker_id uuid, p_profile_id uuid, p_limit integer, p_window interval,
  out result text, out block_id uuid, out block_name text, out block_created_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_target uuid := private.member_profile_visible(p_blocker_id, p_profile_id);
  v_name text;
begin
  if v_target is null then
    result := 'not_found';
    return;
  end if;
  if v_target = p_blocker_id then
    result := 'self';
    return;
  end if;

  select p.display_name into v_name from public.profiles p where p.user_id = v_target;

  begin
    if not private.take_rate_limit(p_blocker_id, 'blocks', p_limit, p_window) then
      raise exception 'rate limited' using errcode = 'P0001';
    end if;
    insert into public.user_blocks as b (blocker_id, blocked_id, blocked_display_name)
    values (p_blocker_id, v_target, v_name)
    on conflict (blocker_id, blocked_id) do update set blocked_display_name = b.blocked_display_name
    returning b.id, b.blocked_display_name, b.created_at into block_id, block_name, block_created_at;
  exception
    when raise_exception then
      result := 'rate_limited';
      return;
    when foreign_key_violation then
      result := 'not_found';
      return;
  end;

  result := 'blocked';
end;
$$;

-- ---------------------------------------------------------------------------
-- Messaging a profile
-- ---------------------------------------------------------------------------

-- A first message to the member behind p_profile_id. Messaging rules are
-- unchanged: both must be opted in to the same event while its Who's Going is
-- open. This picks that event (the soonest, if there are several) and hands
-- over to private.request_conversation with the member's attendeeId on it, so
-- every other check (blocks, suspensions, one conversation per pair, rate
-- limits, the recipient's cap) is the same code. Returns (result,
-- new_conversation_id) as request_conversation does, plus 'unavailable' for
-- a profile the sender can't see.
create function private.request_conversation_by_profile(
  p_sender_id uuid, p_profile_id uuid, p_body text,
  p_request_limit integer, p_request_window interval,
  p_message_limit integer, p_message_window interval,
  p_incoming_limit integer, p_incoming_window interval,
  out result text, out new_conversation_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_target uuid;
  v_attendee uuid;
begin
  if exists (select 1 from private.social_suspensions s where s.user_id = p_sender_id) then
    result := 'sender_suspended';
    return;
  end if;
  v_target := private.member_profile_visible(p_sender_id, p_profile_id);
  if v_target is null then
    result := 'unavailable';
    return;
  end if;
  if v_target = p_sender_id then
    result := 'self';
    return;
  end if;

  select a.id into v_attendee
    from public.event_attendees a
    join public.event_attendees mine on mine.event_id = a.event_id and mine.user_id = p_sender_id
    join public.events e on e.id = a.event_id
   where a.user_id = v_target
     and e.status = 'published' and e.whos_going_enabled and e.ends_at > now() and e.ticketing_mode = 'sheltuh'
   order by e.starts_at, e.id
   limit 1;
  if not found then
    result := 'not_going';
    return;
  end if;

  select r.result, r.new_conversation_id into result, new_conversation_id
    from private.request_conversation(p_sender_id, v_attendee, p_body, p_request_limit, p_request_window,
                                      p_message_limit, p_message_window, p_incoming_limit, p_incoming_window) r;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin removal
-- ---------------------------------------------------------------------------

-- An admin removes some of a member's profile content: 'avatar', 'bio',
-- 'instagram' (others ignored). Only what's actually there is removed and
-- logged. Locks the profile row (no key update) first, then the photo.
-- Returns (result, removed): 'removed' with the fields removed,
-- 'unchanged' (none of them was set: nothing logged) or 'not_found'.
create function private.admin_remove_profile_content(
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

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- As in 20261024000000_waitlist.sql, plus profile moderation log entries 2
-- years after they were made (like resolved reports). New OUT column, hence
-- drop + create; `select private.purge_social_data()` is unaffected.
drop function private.purge_social_data();

create function private.purge_social_data(
  out event_attendees_deleted integer, out rate_limits_deleted integer,
  out conversations_deleted integer, out user_reports_deleted integer,
  out conversation_pairs_deleted integer, out waitlist_entries_deleted integer,
  out waitlist_tokens_deleted integer, out profile_moderation_deleted integer)
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.purge_social_data() from public, anon, authenticated;
revoke all on function private.user_reports_target_type() from public, anon, authenticated;
revoke all on function private.member_profile_visible(uuid, uuid) from public, anon, authenticated;
revoke all on function private.file_profile_report(uuid, uuid, text, text, integer, interval) from public, anon, authenticated;
revoke all on function private.create_block_by_profile(uuid, uuid, integer, interval) from public, anon, authenticated;
revoke all on function private.request_conversation_by_profile(uuid, uuid, text, integer, interval, integer, interval, integer, interval)
  from public, anon, authenticated;
revoke all on function private.admin_remove_profile_content(uuid, uuid, text[], text) from public, anon, authenticated;
