-- Event reminders: one email to each ticket holder the day before (or the
-- morning of) an event they hold tickets for. Automatic, once per person per
-- event, with no unsubscribe: it is service information about a purchase the
-- person made (docs/architecture.md, "Event reminders").
--
-- Sorts after 20261117000000_ticket_release_lock.sql. Needs
-- 20261014000000_email_outbox.sql and later (the outbox, as last changed by
-- 20261111000700_onboarding_emails.sql), 20261017000000_free_order_caps.sql
-- (private.email_key) and public.events.time_zone
-- (20261110000000_event_place_time_zone.sql).
--
--   * private.email_recipient_hash(email): SHA-256, in hex, of
--     private.email_key(email) (lower-cased, trimmed, without a `+tag`, Gmail
--     dots folded). What identifies "one inbox" across orders, without storing
--     the address. Shared with the message feature (20261118000100).
--   * private.event_reminders: one row per (event, recipient) ever queued,
--     unique (event_id, recipient_hash), so the same person is never queued
--     twice for an event, however many orders they made, however often the
--     queueing runs and however many runs overlap. It outlives its outbox job
--     (private.purge_operational_data deletes sent jobs after 90 days, never
--     these before the event is a year old), which is what stops a purge from
--     sending a reminder again. `order_id` is the order whose address the
--     reminder goes to (its link is that order's ticket page); deleting the
--     order or the event deletes the row and, through the outbox's foreign
--     key, the job.
--   * private.email_outbox.reminder_id and kind `event_reminder`: the job for
--     one such row (a unique index: one job per row, ever). Keyed on its own
--     column, not on order_id or event_id: those carry unique indexes shared
--     by other kinds. Both kind checks are redefined from
--     20261111000700_onboarding_emails.sql with the new kind, and every other
--     kind now also requires reminder_id to be null.
--   * private.lease_outbox_jobs is NOT changed: since
--     20261111000700_onboarding_emails.sql it leases only an allowlist of the
--     original kinds unless a kind is asked for by name, so a previous app
--     release (which can't send this kind) never takes an event_reminder job.
--   * private.queue_event_reminders(p_limit, p_now, p_from_hour): called at the
--     start of each run of the email cron route. Queues a reminder for up to
--     p_limit holders (soonest events first) of published, Sheltüh-ticketed
--     events of approved organisers that start more than 3 hours from p_now
--     and before the end of tomorrow in the event's own time zone
--     (events.time_zone; DST-exact: the end of tomorrow is local midnight of
--     the day after, converted back to an instant). The holder is the buyer
--     of a `paid` order (a partly refunded order stays paid; pending, failed
--     and refunded ones are excluded; free member and confirmed guest orders
--     are paid orders too) at least 6 hours old (so a reminder never follows
--     the ticket email by minutes). One per recipient per event: of a
--     recipient's orders the oldest is used. An event more than a day away is
--     left alone, and with p_from_hour > 0 an event that is tomorrow (not
--     today) waits until the event's local clock reaches that hour (default
--     0: from local midnight). A holder who buys inside the last 3 hours, or
--     less than 6 hours before the cut-off, gets none. The row and its job
--     are inserted by one statement, so both exist or neither does. Runs
--     exclusively (a transaction-level advisory lock; a run that finds
--     another in progress queues nothing), and returns how many it queued.
--
-- What is sent, to whom, is decided again at send time
-- (lib/server/email-outbox.ts, deliverEventReminder): the order must still be
-- paid, the event still published and not started, the organiser still
-- approved, and the order's address a plain one. The platform sends at most
-- 800 reminders a day (private.take_platform_rate_limit, bucket
-- 'event_reminders_daily', taken just before sending): past it a job is put
-- back an hour without using an attempt, never dropped.
--
-- Indexes: the unique indexes above; event_reminders (order_id), which serves
-- the cascade from public.orders (deleting an order finds its rows without a
-- scan). The candidate query is served by events_status_starts_idx
-- (status, starts_at, id), bounded to the 50 hours ahead the window can reach
-- (two local days, plus an hour for a daylight-saving change), and by
-- orders_event_paid_created_idx (event_id, created_at) where paid.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC and its
-- search_path pinned. No security definer.
--
-- Additive. Reversible, not destructive: in one transaction, delete the
-- `event_reminder` jobs; restore the outbox's two kind checks from
-- 20261111000700_onboarding_emails.sql; drop the function
-- queue_event_reminders, drop the column email_outbox.reminder_id, then the
-- table private.event_reminders and the function email_recipient_hash. That
-- forgets whom was reminded, so re-applying this migration later would remind
-- them again for any event still ahead.

create function private.email_recipient_hash(p_email text) returns text
language sql
immutable strict
set search_path = ''
as $$
  select encode(sha256(convert_to(private.email_key(p_email), 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- The record of who was reminded
-- ---------------------------------------------------------------------------

create table private.event_reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  order_id text not null references public.orders (id) on delete cascade,
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  queued_at timestamptz not null default now(),
  constraint event_reminders_event_recipient_key unique (event_id, recipient_hash)
);

create index event_reminders_order_idx on private.event_reminders (order_id);

alter table private.event_reminders enable row level security;
revoke all on private.event_reminders from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------

alter table private.email_outbox
  add column reminder_id uuid references private.event_reminders (id) on delete cascade;

-- One job per record, ever (and the cascade's lookup).
create unique index email_outbox_reminder_key on private.email_outbox (reminder_id);

alter table private.email_outbox
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (
    kind in ('ticket_email', 'waitlist_available', 'organiser_new_events', 'event_review', 'organiser_review',
             'ops_alert', 'event_published', 'organiser_joined', 'onboarding', 'event_reminder')),
  drop constraint email_outbox_kind_key,
  -- Each kind has exactly its own key.
  add constraint email_outbox_kind_key check (
    case kind
      when 'ticket_email' then order_id is not null and waitlist_entry_id is null and follow_id is null
                               and event_id is null and organiser_id is null
                               and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                               and reminder_id is null
      when 'waitlist_available' then waitlist_entry_id is not null and order_id is null and follow_id is null
                                     and event_id is null and organiser_id is null
                                     and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                     and reminder_id is null
      when 'organiser_new_events' then follow_id is not null and order_id is null and waitlist_entry_id is null
                                       and event_id is null and organiser_id is null
                                       and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                       and reminder_id is null
      when 'event_review' then event_id is not null and order_id is null and waitlist_entry_id is null
                               and follow_id is null and organiser_id is null
                               and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                               and reminder_id is null
      when 'event_published' then event_id is not null and order_id is null and waitlist_entry_id is null
                                  and follow_id is null and organiser_id is null
                                  and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                  and reminder_id is null
      when 'organiser_review' then organiser_id is not null and order_id is null and waitlist_entry_id is null
                                   and follow_id is null and event_id is null
                                   and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                   and reminder_id is null
      when 'organiser_joined' then organiser_id is not null and order_id is null and waitlist_entry_id is null
                                   and follow_id is null and event_id is null
                                   and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                   and reminder_id is null
      when 'onboarding' then onboarding_id is not null and order_id is null and waitlist_entry_id is null
                             and follow_id is null and event_id is null and organiser_id is null
                             and payment_exception_id is null and ops_event_id is null and reminder_id is null
      when 'event_reminder' then reminder_id is not null and order_id is null and waitlist_entry_id is null
                                 and follow_id is null and event_id is null and organiser_id is null
                                 and payment_exception_id is null and ops_event_id is null and onboarding_id is null
      else (payment_exception_id is not null) <> (ops_event_id is not null)
           and order_id is null and waitlist_entry_id is null and follow_id is null
           and event_id is null and organiser_id is null and onboarding_id is null and reminder_id is null end);

-- ---------------------------------------------------------------------------
-- Queueing
-- ---------------------------------------------------------------------------

create function private.queue_event_reminders(
  p_limit integer, p_now timestamptz default now(), p_from_hour integer default 0
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_queued integer;
begin
  if p_limit is null or p_now is null or p_from_hour is null or p_from_hour not between 0 and 23 then
    raise exception 'queue_event_reminders: a limit, time or hour is missing or out of range';
  end if;
  -- One run at a time: a second finds this held and leaves the work to the first.
  if not pg_try_advisory_xact_lock(hashtextextended('private.queue_event_reminders', 0)) then
    return 0;
  end if;

  with candidates as (
    -- One row per (event, inbox): the oldest paid order at least 6 hours old.
    select distinct on (o.event_id, k.hash)
           o.event_id, o.id as order_id, k.hash as recipient_hash, e.starts_at, o.created_at
      from public.events e
      join public.organisers g on g.id = e.organiser_id and g.status = 'approved'
      join public.orders o on o.event_id = e.id and o.status = 'paid'
      cross join lateral (select private.email_recipient_hash(o.buyer_email) as hash) k
     where e.status = 'published'
       and e.ticketing_mode = 'sheltuh'
       -- More than 3 hours away, and (the second bound only lets the index
       -- prune) at most 50 hours away.
       and e.starts_at > p_now + interval '3 hours'
       and e.starts_at < p_now + interval '50 hours'
       -- Before the end of tomorrow in the event's zone: local midnight of the
       -- day after tomorrow, as an instant.
       and e.starts_at < ((p_now at time zone e.time_zone)::date + 2)::timestamp at time zone e.time_zone
       -- Tomorrow's events wait for the local hour; today's never do.
       and (p_from_hour = 0
            or e.starts_at < ((p_now at time zone e.time_zone)::date + 1)::timestamp at time zone e.time_zone
            or extract(hour from p_now at time zone e.time_zone) >= p_from_hour)
       and o.created_at <= p_now - interval '6 hours'
       and o.buyer_email is not null and btrim(o.buyer_email) <> ''
       and not exists (select 1 from private.event_reminders r
                        where r.event_id = o.event_id and r.recipient_hash = k.hash)
     order by o.event_id, k.hash, o.created_at, o.id
  ),
  picked as (
    select c.* from candidates c order by c.starts_at, c.created_at, c.order_id limit p_limit
  ),
  made as (
    insert into private.event_reminders (event_id, order_id, recipient_hash)
    select p.event_id, p.order_id, p.recipient_hash from picked p
    on conflict (event_id, recipient_hash) do nothing
    returning id
  ),
  jobs as (
    insert into private.email_outbox (kind, reminder_id)
    select 'event_reminder', m.id from made m
    returning 1
  )
  select count(*)::integer into v_queued from jobs;
  return v_queued;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.email_recipient_hash(text) from public, anon, authenticated;
revoke all on function private.queue_event_reminders(integer, timestamptz, integer) from public, anon, authenticated;
