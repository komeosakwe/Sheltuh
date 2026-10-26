-- "Waiting for your review" emails to admins (docs/architecture.md,
-- "Admin review emails"; owner request 25 Oct 2026).
--
-- When an organiser submits an event for review (draft or rejected →
-- pending_review, so a resubmission too), or someone applies to be an
-- organiser (or resubmits a rejected application: → pending), the admins get
-- an email saying something is waiting, with a link to the review queue.
--
--   * private.email_outbox gains two kinds: `event_review` (keyed on the new
--     event_id column) and `organiser_review` (organiser_id). As for every
--     kind, the job holds no address and no content: who's an admin (or
--     ADMIN_NOTIFY_EMAILS, which takes precedence) and what the email says
--     (title, organiser name, start) are read when it's sent, and nothing is
--     sent if the event or application has been reviewed by then.
--   * Queued by deferred constraint triggers on public.events and
--     public.organisers, so the job commits with the status change (it can't
--     be lost) whichever path made it (the submit and apply routes, SQL by
--     hand), and only if the transaction commits. Only for an owned
--     organiser's event or application: admins' own (platform-managed)
--     organisers and events never wait for review.
--   * Throttled (private.queue_review_email): at most one email waiting per
--     event or application (another submission while one waits adds
--     nothing), the next one no sooner than an hour after the last was sent
--     (it's queued for then, not dropped), at most 10 a day per account (the
--     organiser's owner or the applicant: `review_emails` in
--     private.rate_limits, so one account submitting draft after draft can't
--     use up the platform's day or flood the admins) and at most 100 a day
--     platform-wide (beyond either nothing is queued; the queue and the admin
--     home's counts still show everything waiting). The account's limit is
--     taken first, so a refusal there takes no platform slot.
--   * A job still waiting when its event or application leaves review (an
--     admin got there first) is deleted in the same transaction.
--   * private.email_job_recipients: one row per admin address a review job
--     has already reached (the address's SHA-256 only), so a retry after a
--     partial failure doesn't email the others again. Deleted with the job.
--   * private.lease_outbox_jobs claims every kind and returns every key;
--     private.claim_email_outbox (the previous release's) now leaves the two
--     new kinds alone, so a deploy still running it can't fail those jobs.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC, every
-- function's search_path pinned.
--
-- Indexes:
--   * email_outbox (event_id) and (organiser_id), each unique among pending
--     and sending jobs: one waiting email per event or application (and the
--     ON CONFLICT target).
--   * email_outbox (event_id, sent_at) and (organiser_id, sent_at), partial
--     on the key being set: the throttle's "last sent" and the cascades.
--   * email_job_recipients' primary key (job_id first): a job's recipients
--     and the cascade.
--   * The admin lookup (auth.users by app_metadata role) is a scan of
--     auth.users, once per email sent; the auth schema is Supabase's own and
--     gets no index from us. Fine while accounts number in the thousands.
--
-- Reversible, not destructive: drop the triggers and functions added here;
-- restore private.claim_email_outbox from 20261024000200_organiser_follows.sql;
-- drop table private.email_job_recipients; delete the outbox's
-- `event_review` and `organiser_review` jobs, restore its kind checks from
-- 20261024000200_organiser_follows.sql and drop its event_id and organiser_id
-- columns (that discards only those notifications' delivery history). The
-- `review_emails` rows in private.rate_limits can be left for
-- private.purge_social_data to clear.

-- ---------------------------------------------------------------------------
-- The outbox's two new kinds
-- ---------------------------------------------------------------------------

alter table private.email_outbox
  add column event_id uuid references public.events (id) on delete cascade,
  add column organiser_id uuid references public.organisers (id) on delete cascade,
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (
    kind in ('ticket_email', 'waitlist_available', 'organiser_new_events', 'event_review', 'organiser_review')),
  drop constraint email_outbox_kind_key,
  -- Each kind has exactly its own key.
  add constraint email_outbox_kind_key check (
    case kind
      when 'ticket_email' then order_id is not null and waitlist_entry_id is null and follow_id is null
                               and event_id is null and organiser_id is null
      when 'waitlist_available' then waitlist_entry_id is not null and order_id is null and follow_id is null
                                     and event_id is null and organiser_id is null
      when 'organiser_new_events' then follow_id is not null and order_id is null and waitlist_entry_id is null
                                       and event_id is null and organiser_id is null
      when 'event_review' then event_id is not null and order_id is null and waitlist_entry_id is null
                               and follow_id is null and organiser_id is null
      else organiser_id is not null and order_id is null and waitlist_entry_id is null and follow_id is null
           and event_id is null end);

-- At most one review email waiting or being sent per event, and per application.
create unique index email_outbox_event_review_active_key on private.email_outbox (event_id)
  where status in ('pending', 'sending');
create unique index email_outbox_organiser_review_active_key on private.email_outbox (organiser_id)
  where status in ('pending', 'sending');
-- The throttle's last sent email, and the events and organisers cascades, whatever the job's status.
create index email_outbox_event_idx on private.email_outbox (event_id, sent_at) where event_id is not null;
create index email_outbox_organiser_idx on private.email_outbox (organiser_id, sent_at) where organiser_id is not null;

create table private.email_job_recipients (
  job_id bigint not null references private.email_outbox (id) on delete cascade,
  -- SHA-256 (hex) of the lower-cased address: who already has this email, never the address.
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  sent_at timestamptz not null default now(),
  primary key (job_id, recipient_hash)
);

alter table private.email_job_recipients enable row level security;
revoke all on private.email_job_recipients from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Workers
-- ---------------------------------------------------------------------------

-- As in 20261024000200_organiser_follows.sql, for the previous release during
-- a deploy: every kind it can deliver, never the review emails.
create or replace function private.claim_email_outbox(
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
   where o.kind in ('ticket_email', 'waitlist_available', 'organiser_new_events')
     and o.status = 'sending' and o.lease_expires_at <= now() and o.attempts >= p_max_attempts
     and (p_order_id is null or o.order_id = p_order_id)
     and (p_kind is null or o.kind = p_kind);

  return query
  with picked as (
    select o.id from private.email_outbox o
     where o.kind in ('ticket_email', 'waitlist_available', 'organiser_new_events')
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
  returning o.id, o.kind, o.order_id, o.waitlist_entry_id, o.follow_id, o.lease_token, o.attempts;
end;
$$;

-- claim_email_outbox for every kind, returning each job's key (order,
-- waitlist entry, follow, event or organiser). Same rules: leases up to
-- p_limit due jobs (only p_order_id's, and only of kind p_kind, when given),
-- counting an attempt on each; a lease that expired on the last allowed
-- attempt is marked failed.
create function private.lease_outbox_jobs(
  p_limit integer, p_lease interval, p_max_attempts integer, p_order_id text default null, p_kind text default null
) returns table (
  job_id bigint, job_kind text, job_order_id text, job_waitlist_entry_id uuid, job_follow_id uuid,
  job_event_id uuid, job_organiser_id uuid, job_lease_token uuid, job_attempts integer)
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
  returning o.id, o.kind, o.order_id, o.waitlist_entry_id, o.follow_id, o.event_id, o.organiser_id,
            o.lease_token, o.attempts;
end;
$$;

-- ---------------------------------------------------------------------------
-- Queueing
-- ---------------------------------------------------------------------------

-- Queues the admins' "waiting for your review" email for an event
-- (p_kind 'event_review') or an organiser application ('organiser_review'),
-- and returns whether it did. Nothing is queued unless the subject is still
-- waiting for review and belongs to an account (not a platform-managed
-- organiser), nor when an email about it is already waiting or being sent (it
-- will say the same thing), nor over 10 a day for the account that owns the
-- organiser (or applied), nor over the platform's 100 a day. The email is
-- due an hour after the last one about the same subject was sent, or now.
-- An advisory lock per subject serialises calls (the status change that
-- triggers this already holds the subject's row lock).
create function private.queue_review_email(p_kind text, p_subject_id uuid) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_last_sent timestamptz;
  v_owner uuid;
begin
  if p_kind = 'event_review' then
    select o.owner_user_id into v_owner from public.events e join public.organisers o on o.id = e.organiser_id
     where e.id = p_subject_id and e.status = 'pending_review';
  elsif p_kind = 'organiser_review' then
    select o.owner_user_id into v_owner from public.organisers o
     where o.id = p_subject_id and o.status = 'pending';
  else
    raise exception 'unknown review email kind: %', p_kind;
  end if;
  if v_owner is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('review_email:' || p_kind || ':' || p_subject_id::text, 0));

  if p_kind = 'event_review' then
    perform 1 from private.email_outbox j where j.event_id = p_subject_id and j.status in ('pending', 'sending');
    if found then
      return false;
    end if;
    select max(j.sent_at) into v_last_sent from private.email_outbox j
     where j.event_id = p_subject_id and j.status = 'sent';
  else
    perform 1 from private.email_outbox j where j.organiser_id = p_subject_id and j.status in ('pending', 'sending');
    if found then
      return false;
    end if;
    select max(j.sent_at) into v_last_sent from private.email_outbox j
     where j.organiser_id = p_subject_id and j.status = 'sent';
  end if;

  -- The account's own limit first: a refusal there takes no platform slot.
  if not private.take_rate_limit(v_owner, 'review_emails', 10, interval '24 hours') then
    return false;
  end if;
  if not private.take_platform_rate_limit('admin_review_emails_daily', 100, interval '24 hours') then
    return false;
  end if;

  if p_kind = 'event_review' then
    insert into private.email_outbox (kind, event_id, next_attempt_at)
    values ('event_review', p_subject_id, greatest(now(), coalesce(v_last_sent + interval '1 hour', now())))
    on conflict (event_id) where status in ('pending', 'sending') do nothing;
  else
    insert into private.email_outbox (kind, organiser_id, next_attempt_at)
    values ('organiser_review', p_subject_id, greatest(now(), coalesce(v_last_sent + interval '1 hour', now())))
    on conflict (organiser_id) where status in ('pending', 'sending') do nothing;
  end if;
  return found;
end;
$$;

create function private.events_review_email() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.queue_review_email('event_review', new.id);
  return null;
end;
$$;

create function private.organisers_review_email() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.queue_review_email('organiser_review', new.id);
  return null;
end;
$$;

-- Deferred to commit (like the followers' and the waitlist's triggers), so
-- they see the transaction's final state and queue only if it commits.
create constraint trigger events_review_email_insert
  after insert on public.events
  deferrable initially deferred
  for each row
  when (new.status = 'pending_review')
  execute function private.events_review_email();

create constraint trigger events_review_email
  after update of status on public.events
  deferrable initially deferred
  for each row
  when (new.status = 'pending_review' and old.status is distinct from 'pending_review')
  execute function private.events_review_email();

create constraint trigger organisers_review_email_insert
  after insert on public.organisers
  deferrable initially deferred
  for each row
  when (new.status = 'pending' and new.owner_user_id is not null)
  execute function private.organisers_review_email();

create constraint trigger organisers_review_email
  after update of status on public.organisers
  deferrable initially deferred
  for each row
  when (new.status = 'pending' and old.status is distinct from 'pending' and new.owner_user_id is not null)
  execute function private.organisers_review_email();

-- An event or application leaving review (approved, rejected, an organiser
-- suspended): its review email, if still waiting, has nothing left to say.
-- One a worker is sending checks the status itself and sends nothing.
create function private.drop_review_email() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'events' then
    delete from private.email_outbox j where j.event_id = new.id and j.status = 'pending';
  else
    delete from private.email_outbox j where j.organiser_id = new.id and j.status = 'pending';
  end if;
  return null;
end;
$$;

create trigger events_review_email_drop
  after update of status on public.events
  for each row
  when (old.status = 'pending_review' and new.status is distinct from 'pending_review')
  execute function private.drop_review_email();

create trigger organisers_review_email_drop
  after update of status on public.organisers
  for each row
  when (old.status = 'pending' and new.status is distinct from 'pending')
  execute function private.drop_review_email();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.claim_email_outbox(integer, interval, integer, text, text) from public, anon, authenticated;
revoke all on function private.lease_outbox_jobs(integer, interval, integer, text, text) from public, anon, authenticated;
revoke all on function private.queue_review_email(text, uuid) from public, anon, authenticated;
revoke all on function private.events_review_email() from public, anon, authenticated;
revoke all on function private.organisers_review_email() from public, anon, authenticated;
revoke all on function private.drop_review_email() from public, anon, authenticated;
