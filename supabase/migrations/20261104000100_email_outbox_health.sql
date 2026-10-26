-- Email outbox health (payment audit plan, item 3; docs/architecture.md,
-- "Payment flow", and docs/supabase-setup.md §3).
--
-- Retries of failed ticket emails depend on something calling
-- GET /api/cron/email-outbox: Vercel Cron once a day on the Hobby plan, and
-- (once the owner sets it up) Supabase Cron with pg_net every 5 minutes. This
-- migration schedules nothing. It only makes the runner and the queue
-- visible to admins (GET /api/admin/emails/health):
--
--   * private.cron_runs: one row per cron route, written by the route when a
--     run finishes: when, and its counts (claimed, sent, retrying, failed).
--     Nothing else: no job, order or address. Only 'email_outbox' for now.
--   * private.email_outbox_health(p_overdue_after): per kind, counts of jobs
--     due now, overdue (due, or with an expired lease, for longer than
--     p_overdue_after: nobody has picked them up), the oldest overdue job's
--     age in seconds, waiting (a retry scheduled for later), being sent,
--     expired leases, failed (the dead letters an admin can resend) and
--     failed in the last 7 days. Sent jobs are left out (the bulk of the
--     table). Counts only. Also usable from the SQL editor:
--     `select * from private.email_outbox_health('15 minutes');`
--
-- Indexes: none added. The function reads only pending, sending and failed
-- rows: email_outbox_due_idx and email_outbox_leased_idx (partial, on the
-- pending and sending rows, which are few at any moment) and
-- email_outbox_status_created_idx (status first) for failed ones, which the
-- daily purge keeps to a year. private.cron_runs has one row per cron route.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated; the function pins its search_path and has execute revoked
-- from PUBLIC, anon and authenticated.
--
-- Reversible, not destructive: drop function
-- private.email_outbox_health(interval); drop table private.cron_runs (only
-- the last run's time and counts are lost). The app version before this one
-- never touches either.

create table private.cron_runs (
  name text primary key check (name in ('email_outbox')),
  -- When the run finished (the route's last statement).
  finished_at timestamptz not null,
  claimed integer not null check (claimed >= 0),
  sent integer not null check (sent >= 0),
  retrying integer not null check (retrying >= 0),
  failed integer not null check (failed >= 0)
);

alter table private.cron_runs enable row level security;
revoke all on private.cron_runs from public, anon, authenticated;

create function private.email_outbox_health(p_overdue_after interval)
returns table (
  kind text, due integer, overdue integer, oldest_overdue_seconds integer, waiting integer,
  sending integer, expired_leases integer, failed integer, failed_last_7_days integer)
language sql
stable
set search_path = ''
as $$
  select o.kind,
         (count(*) filter (where o.status = 'pending' and o.next_attempt_at <= now()))::integer,
         (count(*) filter (where (o.status = 'pending' and o.next_attempt_at <= now() - p_overdue_after)
                              or (o.status = 'sending' and o.lease_expires_at <= now() - p_overdue_after)))::integer,
         floor(extract(epoch from now() - min(case
           when o.status = 'pending' and o.next_attempt_at <= now() - p_overdue_after then o.next_attempt_at
           when o.status = 'sending' and o.lease_expires_at <= now() - p_overdue_after then o.lease_expires_at end)))::integer,
         (count(*) filter (where o.status = 'pending' and o.next_attempt_at > now()))::integer,
         (count(*) filter (where o.status = 'sending' and o.lease_expires_at > now()))::integer,
         (count(*) filter (where o.status = 'sending' and o.lease_expires_at <= now()))::integer,
         (count(*) filter (where o.status = 'failed'))::integer,
         (count(*) filter (where o.status = 'failed' and o.updated_at > now() - interval '7 days'))::integer
    from private.email_outbox o
   where o.status in ('pending', 'sending', 'failed')
   group by o.kind
   order by o.kind
$$;

revoke all on function private.email_outbox_health(interval) from public, anon, authenticated;
