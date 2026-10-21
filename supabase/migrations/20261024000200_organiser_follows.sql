-- Organiser follows, "events hosted" and the featured video
-- (docs/architecture.md, "Following organisers" and "Organiser profiles";
-- owner request 21 Oct 2026, docs/FEATURE_PLAN.md).
--
--   * public.organiser_follows: a verified member follows an approved
--     organiser (one row per pair; keyed on the account, like favourites).
--     notify_new_events is chosen when following (default true): an email
--     when the organiser publishes a new event. At most 500 follows per
--     account and 60 new follows an hour (private.follow_organiser).
--     Deleted with the account or the organiser.
--   * New-event emails: when an event is published for the first time
--     (private.organiser_event_announcements records each event once, so an
--     unpublish and republish doesn't announce it again), a deferred
--     constraint trigger queues one `organiser_new_events` outbox job per
--     follower with notifications on, at most one per follower per organiser
--     per 24 hours: a follower who already has an email waiting gets the new
--     event in it (the email lists every event announced since their last
--     one, read when it's sent), and one emailed in the last 24 hours gets
--     their next email 24 hours after it. At most 500 a day platform-wide (the
--     shared SMTP quota). Each email has its own unsubscribe link (only the
--     token's SHA-256 hash is stored, private.organiser_follow_tokens), which
--     turns notifications off and keeps the follow.
--   * private.email_outbox gains the third kind, keyed on the follow.
--     private.claim_email_outbox claims every kind (and returns the follow);
--     private.claim_outbox_jobs, the previous release's, now leaves the new
--     kind alone, so a deploy still running it can't fail those jobs.
--   * public.organisers gains the featured video: featured_video_provider
--     ('youtube' or 'vimeo') and featured_video_id, checked together. Set with
--     the application (reviewed), or by an approved organiser's profile edit
--     (no review, logged, like the bio: private.edit_organiser_profile now
--     takes `featured_video`). Admins remove it with
--     private.admin_remove_featured_video, logged as a `profile_edit` by the
--     admin with a reason (organiser_profile_edits now allows a reason on any
--     entry, and still requires one on a takedown).
--   * private.purge_social_data also deletes unsubscribe tokens 90 days after
--     their email (the link only has to work for a while after it's sent;
--     Spam Act 2003 asks for at least 30 days).
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC, every
-- function's search_path pinned.
--
-- Indexes:
--   * organiser_follows_pair_key (user_id, organiser_id): a member's follows
--     (their list, the cap, "am I following") and the auth.users cascade.
--   * organiser_follows_organiser_idx (organiser_id, created_at): follower
--     counts, the notification fan-out and the organisers cascade.
--   * organiser_follow_tokens: the token hash (primary key); (follow_id) for
--     the cascade; (created_at) for the purge.
--   * organiser_event_announcements (organiser_id, announced_at): the events
--     an email lists.
--   * email_outbox (follow_id): one active job per follow (unique, partial)
--     and the cascade.
--
-- Reversible: drop the trigger and functions added here; restore
-- private.claim_outbox_jobs from 20261024000000_waitlist.sql,
-- private.edit_organiser_profile from 20261018000000_organiser_profile_moderation.sql
-- and private.purge_social_data from 20261024000100_member_profiles.sql;
-- delete the outbox's `organiser_new_events` jobs and restore its kind
-- checks; drop the outbox's follow_id column; drop tables
-- private.organiser_follow_tokens, private.organiser_event_announcements and
-- public.organiser_follows (destructive: every follow); restore
-- organiser_profile_edits_reason (after deleting entries with a reason that
-- aren't takedowns); drop the organisers' two video columns (destructive:
-- every featured video).

-- ---------------------------------------------------------------------------
-- Featured video
-- ---------------------------------------------------------------------------

alter table public.organisers
  add column featured_video_provider text,
  add column featured_video_id text,
  -- Mirrors lib/api/featured-video.ts (YOUTUBE_ID, VIMEO_ID).
  add constraint organisers_featured_video_check check (
    case when featured_video_provider is null then featured_video_id is null
         when featured_video_provider = 'youtube' then coalesce(featured_video_id ~ '^[A-Za-z0-9_-]{11}$', false)
         when featured_video_provider = 'vimeo' then coalesce(featured_video_id ~ '^[0-9]{1,12}$', false)
         else false end);

-- A reason on any entry (an admin's profile edit has one); still required on a takedown.
alter table private.organiser_profile_edits
  drop constraint organiser_profile_edits_reason,
  add constraint organiser_profile_edits_reason check (kind <> 'suspended' or reason is not null);

-- As in 20261018000000_organiser_profile_moderation.sql, plus
-- "featured_video": "youtube:{id}" / "vimeo:{id}" (already validated by the
-- API; the check constraint re-checks), or JSON null to remove it. Logged in
-- that "provider:id" form.
create or replace function private.edit_organiser_profile(p_owner_user_id uuid, p_changes jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_old public.organisers;
  v_changed jsonb;
  v_video text;
begin
  select * into v_old from public.organisers where owner_user_id = p_owner_user_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_old.status <> 'approved' then
    return 'not_approved';
  end if;

  v_video := case when v_old.featured_video_provider is null then null
                  else v_old.featured_video_provider || ':' || v_old.featured_video_id end;

  select coalesce(jsonb_object_agg(c.field, jsonb_build_object('old', c.old_value, 'new', p_changes -> c.field)), '{}'::jsonb)
    into v_changed
    from (values ('description', v_old.description),
                 ('website_url', v_old.website_url),
                 ('instagram_handle', v_old.instagram_handle),
                 ('tiktok_handle', v_old.tiktok_handle),
                 ('facebook_page', v_old.facebook_page),
                 ('x_handle', v_old.x_handle),
                 ('featured_video', v_video)) as c (field, old_value)
   where p_changes ? c.field
     and (p_changes ->> c.field) is distinct from c.old_value;

  if v_changed = '{}'::jsonb then
    return 'unchanged';
  end if;

  update public.organisers set
    description = case when v_changed ? 'description' then p_changes ->> 'description' else description end,
    website_url = case when v_changed ? 'website_url' then p_changes ->> 'website_url' else website_url end,
    instagram_handle = case when v_changed ? 'instagram_handle' then p_changes ->> 'instagram_handle' else instagram_handle end,
    tiktok_handle = case when v_changed ? 'tiktok_handle' then p_changes ->> 'tiktok_handle' else tiktok_handle end,
    facebook_page = case when v_changed ? 'facebook_page' then p_changes ->> 'facebook_page' else facebook_page end,
    x_handle = case when v_changed ? 'x_handle' then p_changes ->> 'x_handle' else x_handle end,
    featured_video_provider = case when v_changed ? 'featured_video'
                                   then nullif(split_part(p_changes ->> 'featured_video', ':', 1), '')
                                   else featured_video_provider end,
    featured_video_id = case when v_changed ? 'featured_video'
                             then nullif(split_part(p_changes ->> 'featured_video', ':', 2), '')
                             else featured_video_id end
  where id = v_old.id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
  values (v_old.id, 'profile_edit', p_owner_user_id, v_changed);

  return 'updated';
end;
$$;

-- An admin removes an organiser's featured video (any status), with a
-- reason, logged as a `profile_edit` by the admin. Locks the organiser row
-- (for update), as suspend_organiser does. Returns 'removed', 'unchanged'
-- (no video: nothing logged) or 'not_found'.
create function private.admin_remove_featured_video(p_organiser_id uuid, p_admin_id uuid, p_reason text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_old public.organisers;
begin
  select * into v_old from public.organisers where id = p_organiser_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_old.featured_video_provider is null then
    return 'unchanged';
  end if;
  update public.organisers set featured_video_provider = null, featured_video_id = null where id = p_organiser_id;
  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields, reason)
  values (p_organiser_id, 'profile_edit', p_admin_id,
          jsonb_build_object('featured_video', jsonb_build_object(
            'old', v_old.featured_video_provider || ':' || v_old.featured_video_id, 'new', null)),
          p_reason);
  return 'removed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Follows
-- ---------------------------------------------------------------------------

create table public.organiser_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organiser_id uuid not null references public.organisers (id) on delete cascade,
  notify_new_events boolean not null default true,
  created_at timestamptz not null default now(),
  -- Emails list events announced after this (null: after created_at).
  notified_through timestamptz,
  -- The earliest the next email may be sent (24 hours after the last one's).
  next_notify_at timestamptz,
  constraint organiser_follows_pair_key unique (user_id, organiser_id)
);

create index organiser_follows_organiser_idx on public.organiser_follows (organiser_id, created_at);

alter table public.organiser_follows enable row level security;
revoke all on public.organiser_follows from anon, authenticated;

create table private.organiser_follow_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  follow_id uuid not null references public.organiser_follows (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index organiser_follow_tokens_follow_idx on private.organiser_follow_tokens (follow_id);
create index organiser_follow_tokens_created_idx on private.organiser_follow_tokens (created_at);

alter table private.organiser_follow_tokens enable row level security;
revoke all on private.organiser_follow_tokens from public, anon, authenticated;

-- Follows (or updates the notification choice of an existing follow, when
-- p_notify isn't null) an approved organiser. Returns (result, notify):
--   'followed'      new (notify: p_notify, default true)
--   'exists'        already following (notify: as stored, after the update)
--   'not_found'     no approved organiser with that id
--   'self'          the organiser's own account
--   'limit'         already following p_max_follows organisers
--   'rate_limited'  over p_limit new follows per p_window
-- A transaction-scoped advisory lock on the account serialises one member's
-- follows, so concurrent requests can't both take the last slot under the cap.
create function private.follow_organiser(
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
  values (p_user_id, p_organiser_id, coalesce(p_notify, true))
  returning f.notify_new_events into notify;
  result := 'followed';
end;
$$;

-- Turns notifications off for the follow behind an unsubscribe link's token
-- hash (the follow is kept). Idempotent. Returns (result, organiser_id):
-- 'unsubscribed' or 'not_found'.
create function private.unsubscribe_follow(p_token_hash text, out result text, out organiser_id uuid)
language plpgsql
set search_path = ''
as $$
begin
  update public.organiser_follows f
     set notify_new_events = false
    from private.organiser_follow_tokens t
   where t.token_hash = p_token_hash and f.id = t.follow_id
  returning f.organiser_id into organiser_id;
  result := case when organiser_id is null then 'not_found' else 'unsubscribed' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Announcements and the outbox
-- ---------------------------------------------------------------------------

create table private.organiser_event_announcements (
  event_id uuid primary key references public.events (id) on delete cascade,
  organiser_id uuid not null references public.organisers (id) on delete cascade,
  announced_at timestamptz not null default now()
);

create index organiser_event_announcements_organiser_idx
  on private.organiser_event_announcements (organiser_id, announced_at);

alter table private.organiser_event_announcements enable row level security;
revoke all on private.organiser_event_announcements from public, anon, authenticated;

-- Every event approved before now has been "announced" (nobody followed
-- anyone yet), so publishing one of them again emails nobody.
insert into private.organiser_event_announcements (event_id, organiser_id, announced_at)
select e.id, e.organiser_id,
       coalesce((select min(l.created_at) from public.event_moderation_log l
                  where l.event_id = e.id and l.action = 'approved'), e.created_at)
  from public.events e
 where e.status = 'published'
    or exists (select 1 from public.event_moderation_log l where l.event_id = e.id and l.action = 'approved');

alter table private.email_outbox
  add column follow_id uuid references public.organiser_follows (id) on delete cascade,
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (kind in ('ticket_email', 'waitlist_available', 'organiser_new_events')),
  drop constraint email_outbox_kind_key,
  -- Each kind has exactly its own key.
  add constraint email_outbox_kind_key check (
    case kind
      when 'ticket_email' then order_id is not null and waitlist_entry_id is null and follow_id is null
      when 'waitlist_available' then waitlist_entry_id is not null and order_id is null and follow_id is null
      else follow_id is not null and order_id is null and waitlist_entry_id is null end);

-- At most one email waiting or being sent per follow (it lists every event announced since the last).
create unique index email_outbox_follow_active_key on private.email_outbox (follow_id)
  where status in ('pending', 'sending');
-- The follow cascade, whatever the job's status.
create index email_outbox_follow_idx on private.email_outbox (follow_id) where follow_id is not null;

-- As in 20261024000000_waitlist.sql, for the previous release during a
-- deploy: every kind it can deliver, never `organiser_new_events`.
create or replace function private.claim_outbox_jobs(
  p_limit integer, p_lease interval, p_max_attempts integer, p_order_id text default null, p_kind text default null
) returns table (
  job_id bigint, job_kind text, job_order_id text, job_waitlist_entry_id uuid, job_lease_token uuid, job_attempts integer)
language plpgsql
set search_path = ''
as $$
begin
  update private.email_outbox o
     set status = 'failed', lease_token = null, lease_expires_at = null,
         last_error = coalesce(o.last_error, 'the last attempt never finished')
   where o.kind in ('ticket_email', 'waitlist_available')
     and o.status = 'sending' and o.lease_expires_at <= now() and o.attempts >= p_max_attempts
     and (p_order_id is null or o.order_id = p_order_id)
     and (p_kind is null or o.kind = p_kind);

  return query
  with picked as (
    select o.id from private.email_outbox o
     where o.kind in ('ticket_email', 'waitlist_available')
       and ((o.status = 'pending' and o.next_attempt_at <= now())
         or (o.status = 'sending' and o.lease_expires_at <= now()))
       and (p_order_id is null or o.order_id = p_order_id)
       and (p_kind is null or o.kind = p_kind)
     order by o.next_attempt_at, o.id
     limit p_limit
     for update skip locked
  )
  update private.email_outbox o
     set status = 'sending', lease_token = gen_random_uuid(), lease_expires_at = now() + p_lease,
         attempts = o.attempts + 1
    from picked
   where o.id = picked.id
  returning o.id, o.kind, o.order_id, o.waitlist_entry_id, o.lease_token, o.attempts;
end;
$$;

-- claim_outbox_jobs for every kind, returning each job's key (order,
-- waitlist entry or follow). Same rules: leases up to p_limit due jobs (only
-- p_order_id's, and only of kind p_kind, when given), counting an attempt on
-- each; a lease that expired on the last allowed attempt is marked failed.
create function private.claim_email_outbox(
  p_limit integer, p_lease interval, p_max_attempts integer, p_order_id text default null, p_kind text default null
) returns table (
  job_id bigint, job_kind text, job_order_id text, job_waitlist_entry_id uuid, job_follow_id uuid,
  job_lease_token uuid, job_attempts integer)
language plpgsql
set search_path = ''
as $$
begin
  update private.email_outbox o
     set status = 'failed', lease_token = null, lease_expires_at = null,
         last_error = coalesce(o.last_error, 'the last attempt never finished')
   where o.status = 'sending' and o.lease_expires_at <= now() and o.attempts >= p_max_attempts
     and (p_order_id is null or o.order_id = p_order_id)
     and (p_kind is null or o.kind = p_kind);

  return query
  with picked as (
    select o.id from private.email_outbox o
     where ((o.status = 'pending' and o.next_attempt_at <= now())
         or (o.status = 'sending' and o.lease_expires_at <= now()))
       and (p_order_id is null or o.order_id = p_order_id)
       and (p_kind is null or o.kind = p_kind)
     order by o.next_attempt_at, o.id
     limit p_limit
     for update skip locked
  )
  update private.email_outbox o
     set status = 'sending', lease_token = gen_random_uuid(), lease_expires_at = now() + p_lease,
         attempts = o.attempts + 1
    from picked
   where o.id = picked.id
  returning o.id, o.kind, o.order_id, o.waitlist_entry_id, o.follow_id, o.lease_token, o.attempts;
end;
$$;

-- Queues new-event emails to p_event_id's organiser's followers, the first
-- time the event is published (see the header), and returns how many it
-- queued. Only for a published event that hasn't ended, of an approved
-- organiser. An advisory lock per organiser serialises calls; the follow
-- rows are locked (for update) as they're queued, so an unfollow waits.
create function private.notify_followers(p_event_id uuid) returns integer
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
     where f.organiser_id = v_organiser and f.notify_new_events
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

create function private.events_followers_announce() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.notify_followers(new.id);
  return null;
end;
$$;

-- Deferred to commit (like the waitlist's trigger), so it sees the
-- transaction's final state and runs only if that commits, whichever path
-- published the event (an approval, an admin's create or edit, SQL by hand).
create constraint trigger events_followers_announce
  after update of status on public.events
  deferrable initially deferred
  for each row
  when (new.status = 'published' and old.status is distinct from 'published')
  execute function private.events_followers_announce();

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- As in 20261024000100_member_profiles.sql, plus unsubscribe tokens 90 days
-- after their email. New OUT column, hence drop + create.
drop function private.purge_social_data();

create function private.purge_social_data(
  out event_attendees_deleted integer, out rate_limits_deleted integer,
  out conversations_deleted integer, out user_reports_deleted integer,
  out conversation_pairs_deleted integer, out waitlist_entries_deleted integer,
  out waitlist_tokens_deleted integer, out profile_moderation_deleted integer,
  out follow_tokens_deleted integer)
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.purge_social_data() from public, anon, authenticated;
revoke all on function private.edit_organiser_profile(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.admin_remove_featured_video(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.follow_organiser(uuid, uuid, boolean, integer, integer, interval) from public, anon, authenticated;
revoke all on function private.unsubscribe_follow(text) from public, anon, authenticated;
revoke all on function private.claim_outbox_jobs(integer, interval, integer, text, text) from public, anon, authenticated;
revoke all on function private.claim_email_outbox(integer, interval, integer, text, text) from public, anon, authenticated;
revoke all on function private.notify_followers(uuid) from public, anon, authenticated;
revoke all on function private.events_followers_announce() from public, anon, authenticated;
