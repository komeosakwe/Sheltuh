-- Waitlist, member profile and follow hardening (security review of
-- 3e938b3/1721031; docs/architecture.md, "Waitlist", "Member profiles" and
-- "Following organisers").
--
--   * The outbox can never fail the write that queues it: the deferred
--     triggers that queue waitlist and follower emails at commit
--     (private.ticket_types_waitlist_release, private.events_waitlist_release,
--     private.events_followers_announce) now catch any error from
--     private.notify_waitlist / private.notify_followers and raise a warning
--     instead (the event id and SQLSTATE only). The refund, edit or approval
--     that triggered them commits; nobody is emailed for that change.
--   * Waitlist ownership: private.join_waitlist links an entry already on the
--     list to the joining member's account only when its address is exactly
--     theirs (ignoring case), not merely the same normalised key
--     (private.email_key folds `+tags` and Gmail dots). The API's "my entry"
--     reads (status, leave) match the same way.
--   * Follower new-event emails only go to accounts whose email Supabase Auth
--     has confirmed (auth.users.email_confirmed_at): private.notify_followers
--     queues none for the others (the API checks it again at send time).
--   * Follows: a new follow's emails are off unless the member chose them
--     (private.follow_organiser: coalesce(p_notify, false); the column default
--     becomes false too). An existing follow's choice is unchanged when none
--     is sent, as before.
--   * Profile reports (private.file_profile_report):
--       - only about a profile the reporter can see now
--         (private.member_profile_visible), or a member the reporter has
--         blocked (a block hides the profile both ways); anything else is the
--         same 'not_found' as an unknown profile, so a report can't be used to
--         test whether a hidden profile id exists;
--       - one open profile report per reporter and reported member (partial
--         unique index user_reports_open_profile_key): another report while
--         one is open returns that one ('already_open'), using no allowance;
--       - the photo copy is stored once per distinct image
--         (private.report_photos, keyed on its SHA-256), not once per report:
--         many reports of one profile no longer copy its photo many times.
--         Reports made before this keep their inline copy
--         (user_reports.reported_avatar, no longer written); a report has at
--         most one of the two (user_reports_one_avatar_copy).
--   * private.purge_social_data also deletes report photos no report
--     references any more (after a day unused, so it never races a report
--     being filed). New OUT column, hence drop + create;
--     `select private.purge_social_data()` (Supabase Cron) is unaffected.
--
-- Access model as everywhere else: the new table has RLS on, no policies and
-- no grants to anon or authenticated; every new or redefined function pins
-- its search_path and has execute revoked from PUBLIC, anon and authenticated.
--
-- Indexes:
--   * report_photos_pkey (sha256): the dedupe lookup and the foreign key.
--   * report_photos_last_used_idx (last_used_at): the purge's candidates.
--   * user_reports_avatar_sha256_idx (partial, not null): the purge's "still
--     referenced?" check and the foreign key's checks when a photo is deleted.
--   * user_reports_open_profile_key (reporter_id, reported_user_id) where open
--     profile reports: the one-open-report rule and its lookup.
--
-- If the database already has two open profile reports by one reporter about
-- one member, creating user_reports_open_profile_key fails: resolve one first
-- (none exist before launch).
--
-- Reversible, not destructive: drop the index user_reports_open_profile_key;
-- copy report photos back inline (update private.user_reports r set
-- reported_avatar = p.image from private.report_photos p where p.sha256 =
-- r.reported_avatar_sha256), then drop the column reported_avatar_sha256, the
-- constraint and table private.report_photos; restore
-- private.file_profile_report from 20261024000100_member_profiles.sql,
-- private.follow_organiser, private.notify_followers,
-- private.events_followers_announce and private.purge_social_data from
-- 20261024000200_organiser_follows.sql (and the column default true),
-- private.ticket_types_waitlist_release, private.events_waitlist_release and
-- private.join_waitlist from 20261024000000_waitlist.sql.

-- ---------------------------------------------------------------------------
-- Email-queue triggers never fail their parent write
-- ---------------------------------------------------------------------------

create or replace function private.ticket_types_waitlist_release() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform private.notify_waitlist(new.event_id);
  exception when others then
    raise warning 'waitlist emails for event % not queued (SQLSTATE %); the change itself is kept', new.event_id, sqlstate;
  end;
  return null;
end;
$$;

create or replace function private.events_waitlist_release() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform private.notify_waitlist(new.id);
  exception when others then
    raise warning 'waitlist emails for event % not queued (SQLSTATE %); the change itself is kept', new.id, sqlstate;
  end;
  return null;
end;
$$;

create or replace function private.events_followers_announce() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform private.notify_followers(new.id);
  exception when others then
    raise warning 'follower emails for event % not queued (SQLSTATE %); the change itself is kept', new.id, sqlstate;
  end;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Waitlist: an entry becomes a member's only by their exact address
-- ---------------------------------------------------------------------------

-- As in 20261024000000_waitlist.sql, except that a member joining with an
-- address that only normalises to an entry already on the list (another
-- `+tag`, Gmail dots) no longer has that entry linked to their account: it's
-- someone's, and only the exact address (ignoring case) is proof it's theirs.
-- They're told they're on the list either way (one entry per person, as
-- before).
create or replace function private.join_waitlist(p_event_id uuid, p_email text, p_user_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_state text := private.waitlist_join_state(p_event_id);
  v_key text := private.email_key(p_email);
  v_entry private.event_waitlist;
begin
  if v_state <> 'open' then
    return v_state;
  end if;

  insert into private.event_waitlist (event_id, email, email_key, user_id, confirmed_at)
  values (p_event_id, p_email, v_key, p_user_id, now())
  on conflict (event_id, email_key) do nothing;
  if found then
    return 'joined';
  end if;

  select * into v_entry from private.event_waitlist w
   where w.event_id = p_event_id and w.email_key = v_key
   for update;
  if v_entry.confirmed_at is not null and v_entry.unsubscribed_at is null then
    if v_entry.user_id is null and lower(v_entry.email) = lower(p_email) then
      update private.event_waitlist set user_id = p_user_id where id = v_entry.id;
    end if;
    return 'already_joined';
  end if;
  update private.event_waitlist
     set email = p_email, user_id = coalesce(user_id, p_user_id), confirmed_at = now(), unsubscribed_at = null
   where id = v_entry.id;
  return 'joined';
end;
$$;

-- ---------------------------------------------------------------------------
-- Follower emails: confirmed addresses only; off unless chosen
-- ---------------------------------------------------------------------------

-- As in 20261024000200_organiser_follows.sql, plus: only followers whose
-- account's email is confirmed (auth.users.email_confirmed_at) are queued.
create or replace function private.notify_followers(p_event_id uuid) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_organiser uuid;
  v_follow record;
  v_due timestamptz;
  v_queued integer := 0;
begin
  select e.organiser_id into v_organiser
    from public.events e join public.organisers o on o.id = e.organiser_id
   where e.id = p_event_id and e.status = 'published' and e.ends_at > now() and o.status = 'approved';
  if not found then
    return 0;
  end if;

  insert into private.organiser_event_announcements (event_id, organiser_id) values (p_event_id, v_organiser)
  on conflict (event_id) do nothing;
  if not found then
    -- Announced before (published, unpublished and published again): nobody is emailed twice.
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('follower_notify:' || v_organiser::text, 0));

  for v_follow in
    select f.id, f.next_notify_at from public.organiser_follows f
      join auth.users u on u.id = f.user_id
     where f.organiser_id = v_organiser and f.notify_new_events
       and u.email_confirmed_at is not null
       -- An email already waiting will list this event too.
       and not exists (select 1 from private.email_outbox j
                        where j.follow_id = f.id and j.status in ('pending', 'sending'))
     order by f.next_notify_at nulls first, f.created_at, f.id
       for update of f
  loop
    if not private.take_platform_rate_limit('follower_notifications_daily', 500, interval '24 hours') then
      exit;
    end if;
    v_due := greatest(now(), coalesce(v_follow.next_notify_at, now()));
    insert into private.email_outbox (kind, follow_id, next_attempt_at)
    values ('organiser_new_events', v_follow.id, v_due);
    update public.organiser_follows set next_notify_at = v_due + interval '24 hours' where id = v_follow.id;
    v_queued := v_queued + 1;
  end loop;
  return v_queued;
end;
$$;

alter table public.organiser_follows alter column notify_new_events set default false;

-- As in 20261024000200_organiser_follows.sql, except that a new follow's
-- emails are off unless p_notify is true (they're marketing-adjacent: only
-- with the member's explicit choice).
create or replace function private.follow_organiser(
  p_user_id uuid, p_organiser_id uuid, p_notify boolean, p_max_follows integer, p_limit integer, p_window interval,
  out result text, out notify boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select o.owner_user_id into v_owner from public.organisers o
   where o.id = p_organiser_id and o.status = 'approved'
     for key share;
  if not found then
    result := 'not_found';
    return;
  end if;
  if v_owner = p_user_id then
    result := 'self';
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('organiser_follows:' || p_user_id::text, 0));

  update public.organiser_follows f
     set notify_new_events = coalesce(p_notify, f.notify_new_events)
   where f.user_id = p_user_id and f.organiser_id = p_organiser_id
  returning f.notify_new_events into notify;
  if found then
    result := 'exists';
    return;
  end if;

  if (select count(*) from public.organiser_follows f where f.user_id = p_user_id) >= p_max_follows then
    result := 'limit';
    return;
  end if;
  if not private.take_rate_limit(p_user_id, 'organiser_follows', p_limit, p_window) then
    result := 'rate_limited';
    return;
  end if;

  insert into public.organiser_follows as f (user_id, organiser_id, notify_new_events)
  values (p_user_id, p_organiser_id, coalesce(p_notify, false))
  returning f.notify_new_events into notify;
  result := 'followed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile reports
-- ---------------------------------------------------------------------------

-- A reported profile's photo, once per distinct image. The 512 px WebP the
-- server made (private.profile_avatars.image). Deleted by purge_social_data
-- once no report references it.
create table private.report_photos (
  sha256 bytea primary key,
  image bytea not null check (octet_length(image) between 1 and 524288),
  created_at timestamptz not null default now(),
  -- Bumped whenever a report takes it, so the purge never deletes a photo a
  -- report is being filed with.
  last_used_at timestamptz not null default now(),
  constraint report_photos_sha256_check check (sha256 = sha256(image))
);

create index report_photos_last_used_idx on private.report_photos (last_used_at);

alter table private.report_photos enable row level security;
revoke all on private.report_photos from public, anon, authenticated;

alter table private.user_reports
  add column reported_avatar_sha256 bytea references private.report_photos (sha256),
  add constraint user_reports_one_avatar_copy check (reported_avatar is null or reported_avatar_sha256 is null);

create index user_reports_avatar_sha256_idx on private.user_reports (reported_avatar_sha256)
  where reported_avatar_sha256 is not null;

create unique index user_reports_open_profile_key on private.user_reports (reporter_id, reported_user_id)
  where status = 'open' and target_type = 'profile';

-- Files p_reporter_id's report about the member behind p_profile_id, copying
-- their display name, bio, Instagram handle and photo (once per distinct
-- photo, private.report_photos) into the report. Only for a profile the
-- reporter can see now (private.member_profile_visible), or a member they've
-- blocked. Returns (result, new_report_id, filed_at):
--   'filed'          a new report
--   'already_open'   the reporter's open report about this member (its id
--                    and time): nothing written, no allowance used
--   'not_found'      no such profile, not one they can see (and not someone
--                    they blocked), or deleted mid-call
--   'self'           their own profile
--   'rate_limited'   over p_limit per p_window
-- The profile is key-share-locked while it's copied, so a deletion waits.
create or replace function private.file_profile_report(
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
  v_hash bytea;
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
  if private.member_profile_visible(p_reporter_id, p_profile_id) is null
     and not exists (select 1 from public.user_blocks b
                      where b.blocker_id = p_reporter_id and b.blocked_id = v_reported) then
    result := 'not_found';
    return;
  end if;

  select r.id, r.created_at into new_report_id, filed_at
    from private.user_reports r
   where r.reporter_id = p_reporter_id and r.reported_user_id = v_reported
     and r.status = 'open' and r.target_type = 'profile';
  if found then
    result := 'already_open';
    return;
  end if;

  select a.image into v_avatar from private.profile_avatars a where a.user_id = v_reported;

  begin
    if not private.take_rate_limit(p_reporter_id, 'user_reports', p_limit, p_window) then
      raise exception 'rate limited' using errcode = 'P0001';
    end if;
    if v_avatar is not null then
      v_hash := sha256(v_avatar);
      -- The update (not "do nothing") locks the row, so a purge running now skips it.
      insert into private.report_photos (sha256, image) values (v_hash, v_avatar)
      on conflict (sha256) do update set last_used_at = now();
    end if;
    insert into private.user_reports (reporter_id, reported_user_id, target_type, reason, details,
                                      reported_display_name, reported_bio, reported_instagram, reported_avatar_sha256)
    values (p_reporter_id, v_reported, 'profile', p_reason, p_details, v_name, v_bio, v_instagram, v_hash)
    returning id, created_at into new_report_id, filed_at;
  exception
    when raise_exception then
      result := 'rate_limited';
      new_report_id := null;
      filed_at := null;
      return;
    when unique_violation then
      -- The same reporter's report about the same member, filed at the same moment: that one stands.
      select r.id, r.created_at into new_report_id, filed_at
        from private.user_reports r
       where r.reporter_id = p_reporter_id and r.reported_user_id = v_reported
         and r.status = 'open' and r.target_type = 'profile';
      result := case when new_report_id is null then 'not_found' else 'already_open' end;
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
-- Retention
-- ---------------------------------------------------------------------------

-- As in 20261024000200_organiser_follows.sql, plus report photos no report
-- references (resolved reports are deleted 2 years after resolution), once
-- unused for a day. New OUT column, hence drop + create.
drop function private.purge_social_data();

create function private.purge_social_data(
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.join_waitlist(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.ticket_types_waitlist_release() from public, anon, authenticated;
revoke all on function private.events_waitlist_release() from public, anon, authenticated;
revoke all on function private.events_followers_announce() from public, anon, authenticated;
revoke all on function private.notify_followers(uuid) from public, anon, authenticated;
revoke all on function private.follow_organiser(uuid, uuid, boolean, integer, integer, interval) from public, anon, authenticated;
revoke all on function private.file_profile_report(uuid, uuid, text, text, integer, interval) from public, anon, authenticated;
revoke all on function private.purge_social_data() from public, anon, authenticated;
