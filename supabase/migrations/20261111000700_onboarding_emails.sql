-- Welcome emails: a member's welcome, an organiser's welcome (the pending
-- variant while the application waits, the approved one once approved) and an
-- organiser's "next steps" a little after approval. Each is sent at most once
-- per account, ever.
--
-- Sorts after 20261111000600_pin_search_path.sql. Needs
-- 20261014000000_email_outbox.sql and later (the outbox, as last changed by
-- 20261111000500_organiser_invite_links.sql), 20261014000100_free_order_protection.sql
-- (private.take_platform_rate_limit) and public.organisers.
--
--   * private.onboarding_emails: one row per (account, kind) ever queued,
--     kind member_welcome, organiser_welcome or organiser_next_steps; unique
--     (user_id, kind), so the same email is never queued twice, whatever
--     queues it and however often (a resubmitted application, a second
--     approval, a cron run racing another). It outlives its outbox job
--     (private.purge_operational_data deletes sent jobs after 90 days, never
--     these), which is what stops a purge from re-sending. Deleting the
--     account deletes the row and, through the outbox's foreign key, the job.
--   * private.email_outbox.onboarding_id and kind `onboarding`: the job for
--     one such row (a unique index: one job per row, ever). Keyed on its own
--     column, not on organiser_id or event_id: those carry unique indexes
--     shared by the admin review kinds, and private.drop_review_email deletes
--     by them across kinds. Both kind checks are redefined from
--     20261111000500_organiser_invite_links.sql with the new kind, and every
--     other kind now also requires onboarding_id to be null.
--   * private.lease_outbox_jobs (redefined from
--     20261111000500_organiser_invite_links.sql): without p_kind it now leases
--     only an explicit allowlist of the kinds that existed before this
--     release (ticket_email, waitlist_available, organiser_new_events,
--     event_review, organiser_review). Every other kind (organiser_joined,
--     onboarding, whatever comes next) is leased only when asked for by name,
--     so a previous app version leasing "every kind" can't take a job it
--     can't send and fail it as an unknown one. Behaviour for the allowlisted
--     kinds is unchanged.
--   * private.queue_onboarding_email(user, kind, due): inserts the row and,
--     only if it was new, its job (next_attempt_at = due). Returns whether it
--     queued. Idempotent.
--   * private.queue_member_welcomes(limit): called at the start of each run
--     of the email cron route. Queues a member_welcome for up to p_limit
--     accounts whose email is confirmed, that aren't banned or deleted, have
--     an email and have no member_welcome row yet; at most 300 a day
--     platform-wide (private.take_platform_rate_limit, bucket
--     'onboarding_emails_daily'): past that the rest wait for the next window.
--     Runs exclusively (a transaction-level advisory lock; a run that finds
--     another in progress queues nothing), so concurrent cron runs neither
--     double-queue nor waste cap.
--   * Deferred constraint triggers on public.organisers (like
--     organisers_review_email_insert / _review_email, so they see the
--     transaction's final state and fire only if it commits): an insert with
--     an owner queues organiser_welcome now, plus organiser_next_steps one
--     hour later if the organiser is inserted already approved (an invite or
--     an organiser link); an update of status to 'approved' from anything else
--     queues organiser_next_steps one hour later. Like the waitlist's
--     triggers (20261102000100_social_hardening.sql) they never fail the
--     organiser's change: an error is caught and reported as a warning with
--     the organiser id and SQLSTATE only.
--   * Backfill: a row (no job) for every account with a confirmed email
--     (member_welcome) and every organiser with an owner (organiser_welcome,
--     and organiser_next_steps if approved), so deploying sends nothing
--     about anyone who already has an account.
--
-- Who gets what is decided again at send time (lib/server/email-outbox.ts):
-- the account must still be confirmed, not banned or deleted, with an email;
-- an organiser's welcome is skipped if the organiser is now rejected, and its
-- variant (pending or approved) follows the status then. They go to the
-- account's own email address, never an organiser's public contact email.
--
-- Indexes: the unique indexes above (onboarding_emails (user_id, kind), which
-- also serves the account-delete cascade; email_outbox (onboarding_id), which
-- serves the cascade from onboarding_emails). The member candidate query
-- anti-joins auth.users against onboarding_emails_user_kind_key and is a scan
-- of auth.users (we can't index Supabase's table): at the MVP's size that's
-- cheap, and it's one query per cron run.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC and its
-- search_path pinned. No security definer.
--
-- Reversible, not destructive: drop the triggers and the four functions;
-- restore private.lease_outbox_jobs and the outbox's two kind checks from
-- 20261111000500_organiser_invite_links.sql after deleting `onboarding` jobs;
-- drop the column email_outbox.onboarding_id and the table
-- private.onboarding_emails. That forgets which accounts were welcomed, so
-- re-applying this migration later would backfill them again (nothing is sent
-- for those) but would not remember anyone welcomed since.

-- ---------------------------------------------------------------------------
-- The record of what each account was sent
-- ---------------------------------------------------------------------------

create table private.onboarding_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('member_welcome', 'organiser_welcome', 'organiser_next_steps')),
  queued_at timestamptz not null default now(),
  constraint onboarding_emails_user_kind_key unique (user_id, kind)
);

alter table private.onboarding_emails enable row level security;
revoke all on private.onboarding_emails from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------

alter table private.email_outbox
  add column onboarding_id uuid references private.onboarding_emails (id) on delete cascade;

-- One job per record, ever (and the cascade's lookup).
create unique index email_outbox_onboarding_key on private.email_outbox (onboarding_id);

alter table private.email_outbox
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (
    kind in ('ticket_email', 'waitlist_available', 'organiser_new_events', 'event_review', 'organiser_review',
             'ops_alert', 'event_published', 'organiser_joined', 'onboarding')),
  drop constraint email_outbox_kind_key,
  -- Each kind has exactly its own key.
  add constraint email_outbox_kind_key check (
    case kind
      when 'ticket_email' then order_id is not null and waitlist_entry_id is null and follow_id is null
                               and event_id is null and organiser_id is null
                               and payment_exception_id is null and ops_event_id is null and onboarding_id is null
      when 'waitlist_available' then waitlist_entry_id is not null and order_id is null and follow_id is null
                                     and event_id is null and organiser_id is null
                                     and payment_exception_id is null and ops_event_id is null and onboarding_id is null
      when 'organiser_new_events' then follow_id is not null and order_id is null and waitlist_entry_id is null
                                       and event_id is null and organiser_id is null
                                       and payment_exception_id is null and ops_event_id is null and onboarding_id is null
      when 'event_review' then event_id is not null and order_id is null and waitlist_entry_id is null
                               and follow_id is null and organiser_id is null
                               and payment_exception_id is null and ops_event_id is null and onboarding_id is null
      when 'event_published' then event_id is not null and order_id is null and waitlist_entry_id is null
                                  and follow_id is null and organiser_id is null
                                  and payment_exception_id is null and ops_event_id is null and onboarding_id is null
      when 'organiser_review' then organiser_id is not null and order_id is null and waitlist_entry_id is null
                                   and follow_id is null and event_id is null
                                   and payment_exception_id is null and ops_event_id is null and onboarding_id is null
      when 'organiser_joined' then organiser_id is not null and order_id is null and waitlist_entry_id is null
                                   and follow_id is null and event_id is null
                                   and payment_exception_id is null and ops_event_id is null and onboarding_id is null
      when 'onboarding' then onboarding_id is not null and order_id is null and waitlist_entry_id is null
                             and follow_id is null and event_id is null and organiser_id is null
                             and payment_exception_id is null and ops_event_id is null
      else (payment_exception_id is not null) <> (ops_event_id is not null)
           and order_id is null and waitlist_entry_id is null and follow_id is null
           and event_id is null and organiser_id is null and onboarding_id is null end);

-- As in 20261111000500_organiser_invite_links.sql, but without p_kind it
-- leases only the kinds a previous release sends (an allowlist), so a kind
-- added from now on (onboarding, and the admin kinds ops_alert,
-- event_published and organiser_joined that earlier releases excluded one by
-- one) is only ever leased when asked for by name.
create or replace function private.lease_outbox_jobs(
  p_limit integer, p_lease interval, p_max_attempts integer, p_order_id text default null, p_kind text default null
) returns table (
  job_id bigint, job_kind text, job_order_id text, job_waitlist_entry_id uuid, job_follow_id uuid,
  job_event_id uuid, job_organiser_id uuid, job_lease_token uuid, job_attempts integer)
language plpgsql
set search_path = ''
as $$
begin
  -- Without p_kind: the allowlist below, nothing else (not onboarding, not
  -- organiser_joined, not ops_alert or event_published). Those are leased
  -- only by name.
  update private.email_outbox o
     set status = 'failed', lease_token = null, lease_expires_at = null,
         last_error = coalesce(o.last_error, 'the last attempt never finished')
   where o.status = 'sending' and o.lease_expires_at <= now() and o.attempts >= p_max_attempts
     and (p_order_id is null or o.order_id = p_order_id)
     and (case when p_kind is null
               then o.kind in ('ticket_email', 'waitlist_available', 'organiser_new_events', 'event_review', 'organiser_review')
               else o.kind = p_kind end);

  return query
  with picked as (
    select o.id from private.email_outbox o
     where ((o.status = 'pending' and o.next_attempt_at <= now())
         or (o.status = 'sending' and o.lease_expires_at <= now()))
       and (p_order_id is null or o.order_id = p_order_id)
       and (case when p_kind is null
                 then o.kind in ('ticket_email', 'waitlist_available', 'organiser_new_events', 'event_review', 'organiser_review')
                 else o.kind = p_kind end)
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

-- Records that p_user is to get p_kind and queues its job to run at p_due.
-- Returns false (nothing written) if that account already has one: whatever
-- the reason (sent, waiting, purged), it is never queued twice.
create function private.queue_onboarding_email(p_user uuid, p_kind text, p_due timestamptz)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into private.onboarding_emails (user_id, kind)
  values (p_user, p_kind)
  on conflict (user_id, kind) do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  insert into private.email_outbox (kind, onboarding_id, next_attempt_at)
  values ('onboarding', v_id, p_due);
  return true;
end;
$$;

-- Queues member welcomes for up to p_limit accounts that have confirmed their
-- email and have none yet, oldest confirmation first, within the platform's
-- 300 a day. Returns how many it queued.
create function private.queue_member_welcomes(p_limit integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_queued integer := 0;
begin
  -- One run at a time: a second finds this held and leaves the work to the first.
  if not pg_try_advisory_xact_lock(hashtextextended('private.queue_member_welcomes', 0)) then
    return 0;
  end if;
  for v_user in
    select u.id from auth.users u
     where u.email_confirmed_at is not null and u.email is not null and u.email <> ''
       and (u.banned_until is null or u.banned_until <= now()) and u.deleted_at is null
       and not exists (select 1 from private.onboarding_emails e where e.user_id = u.id and e.kind = 'member_welcome')
     order by u.email_confirmed_at, u.id
     limit p_limit
  loop
    exit when not private.take_platform_rate_limit('onboarding_emails_daily', 300, interval '1 day');
    if private.queue_onboarding_email(v_user, 'member_welcome', now()) then
      v_queued := v_queued + 1;
    end if;
  end loop;
  return v_queued;
end;
$$;

-- An organiser with an owner is welcomed when it's created, and told the next
-- steps an hour after it's approved (created approved, or approved later).
-- Never fails the organiser's own change.
create function private.organisers_onboarding_email() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform private.queue_onboarding_email(new.owner_user_id, 'organiser_welcome', now());
      if new.status = 'approved' then
        perform private.queue_onboarding_email(new.owner_user_id, 'organiser_next_steps', now() + interval '1 hour');
      end if;
    else
      perform private.queue_onboarding_email(new.owner_user_id, 'organiser_next_steps', now() + interval '1 hour');
    end if;
  exception when others then
    raise warning 'onboarding emails for organiser % not queued (SQLSTATE %); the change itself is kept', new.id, sqlstate;
  end;
  return null;
end;
$$;

-- Deferred to commit, as the review emails' triggers are.
create constraint trigger organisers_onboarding_email_insert
  after insert on public.organisers
  deferrable initially deferred
  for each row
  when (new.owner_user_id is not null)
  execute function private.organisers_onboarding_email();

create constraint trigger organisers_onboarding_email_approved
  after update of status on public.organisers
  deferrable initially deferred
  for each row
  when (new.status = 'approved' and old.status is distinct from 'approved' and new.owner_user_id is not null)
  execute function private.organisers_onboarding_email();

-- ---------------------------------------------------------------------------
-- Backfill: everyone who already has an account has been "welcomed"
-- ---------------------------------------------------------------------------

insert into private.onboarding_emails (user_id, kind)
select u.id, 'member_welcome' from auth.users u where u.email_confirmed_at is not null
on conflict (user_id, kind) do nothing;

insert into private.onboarding_emails (user_id, kind)
select o.owner_user_id, 'organiser_welcome' from public.organisers o where o.owner_user_id is not null
on conflict (user_id, kind) do nothing;

insert into private.onboarding_emails (user_id, kind)
select o.owner_user_id, 'organiser_next_steps' from public.organisers o
 where o.owner_user_id is not null and o.status = 'approved'
on conflict (user_id, kind) do nothing;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.lease_outbox_jobs(integer, interval, integer, text, text) from public, anon, authenticated;
revoke all on function private.queue_onboarding_email(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function private.queue_member_welcomes(integer) from public, anon, authenticated;
revoke all on function private.organisers_onboarding_email() from public, anon, authenticated;
