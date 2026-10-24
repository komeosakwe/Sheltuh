-- Sheltuh: the 29 migrations production is missing (per scripts/check-applied-migrations.sql, 23 Oct 2026), in filename order, in ONE transaction: if any statement fails, nothing is applied.
begin;

-- ===== 20260930000000_event_images_lockdown.sql =====
-- event_images was created with row-level security on but, unlike every other
-- table in the init migration, without revoking Supabase's default grants.
-- RLS with no policies already blocks the Data API, but the rule in
-- docs/architecture.md is "no client grants at all", so one mistaken policy or
-- RLS toggle couldn't expose the table to the public key. Match the others.
revoke all on public.event_images from anon, authenticated;


-- ===== 20261005000000_favourites.sql =====
-- Favourites: a signed-in member's private list of events.
--
--   * Only a published event can be favourited. Unpublishing keeps the row,
--     but the API hides it until the event is published again.
--   * At most p_limit (500, lib/api/types.ts MAX_FAVOURITES) per account,
--     enforced atomically by private.add_favourite.
--   * Nobody but the member sees their favourites; no count is exposed.
--   * Deleting the account or the event deletes its favourites (cascade).
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, and the new function's execute revoked from PUBLIC. Only the
-- API (lib/server/handlers/favourites.ts) reads or writes it.
--
-- Reversible: drop function private.add_favourite and drop table
-- public.event_favourites. Dropping the table deletes every member's
-- favourites, so reversing it after launch is destructive.

create table public.event_favourites (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One row per (member, event): favouriting twice is a no-op.
  primary key (user_id, event_id)
);

-- "My favourites, newest first" (the list and the ids endpoint), keyset-ready
-- on (created_at, event_id). The primary key already serves "is it a
-- favourite", the per-account count and the auth.users FK cascade. No index
-- on event_id alone: events are never deleted by the app (only by hand), and
-- no feature counts favourites per event.
create index event_favourites_user_created_idx on public.event_favourites (user_id, created_at desc, event_id desc);

alter table public.event_favourites enable row level security;
revoke all on public.event_favourites from anon, authenticated;

-- Favourites p_event_id for p_user_id. Returns:
--   'added'     newly favourited
--   'exists'    already a favourite (idempotent: also when at the limit)
--   'not_found' no such event, or it isn't published, or the account was
--               deleted mid-call
--   'limit'     the account already has p_limit favourites
-- A transaction-scoped advisory lock on the account serialises one member's
-- adds, so two concurrent requests can't both take the last slot. (A hash
-- collision with another account only makes the two wait for each other.)
-- The event isn't locked: if it's unpublished a moment later, the row is
-- kept and hidden, exactly as for an older favourite.
create function private.add_favourite(p_user_id uuid, p_event_id uuid, p_limit integer) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events e where e.id = p_event_id and e.status = 'published';
  if not found then
    return 'not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('event_favourites:' || p_user_id::text, 0));

  if exists (select 1 from public.event_favourites f where f.user_id = p_user_id and f.event_id = p_event_id) then
    return 'exists';
  end if;

  if (select count(*) from public.event_favourites f where f.user_id = p_user_id) >= p_limit then
    return 'limit';
  end if;

  insert into public.event_favourites (user_id, event_id) values (p_user_id, p_event_id);
  return 'added';
exception
  when foreign_key_violation then
    -- The account (or the event) was deleted mid-call.
    return 'not_found';
end;
$$;

revoke all on function private.add_favourite(uuid, uuid, integer) from public, anon, authenticated;


-- ===== 20261006000000_event_analytics.sql =====
-- Organiser analytics, stages A (views, sales) and B (tracking links).
--
-- Privacy first: page views are aggregate counters only, one row per
-- (event, Melbourne day, source bucket, tracking code). No cookie, IP
-- address, user id, email, user agent or referrer URL is stored anywhere.
-- Sales figures are computed from the existing `paid` orders.
--
--   * public.event_view_counts: daily view counters, incremented by
--     private.record_view (one atomic upsert). Rows older than 25 months are
--     deleted by private.purge_analytics (daily, Supabase Cron).
--   * private.event_rate_limits + private.take_event_rate_limit: a
--     fixed-window counter keyed on the *event* (never on a person), so one
--     client can't inflate an event's views beyond a per-minute cap.
--   * public.event_tracking_links: up to 20 organiser-labelled codes per
--     event (private.create_tracking_link enforces the cap atomically).
--   * orders.tracking_code: the tracking code a checkout came through,
--     checked against the event's links when the order is created.
--   * private.analytics_settings.views_tracked_since: the Melbourne day view
--     counting started (when this migration ran), so reports can say "not
--     counted" rather than "0" for earlier days.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC.
--
-- Reversible: drop functions private.purge_analytics, private.record_view,
-- private.create_tracking_link and private.take_event_rate_limit; drop index
-- orders_organiser_paid_created_idx; drop column orders.tracking_code; drop
-- tables private.analytics_settings, private.event_rate_limits,
-- public.event_view_counts and public.event_tracking_links. That discards
-- every view count, tracking link and order attribution, so reversing it
-- after launch is destructive.

-- ---------------------------------------------------------------------------
-- Tracking links
-- ---------------------------------------------------------------------------

create table public.event_tracking_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- Made by the server (lib/server/tracking-codes.ts): no 0/1/i/l/o, so it
  -- survives being read aloud or retyped.
  code text not null check (code ~ '^[2-9a-hjkmnp-z]{6,10}$'),
  -- Organiser-supplied; the API trims it and refuses control and invisible
  -- characters. Ends up in CSV exports, which neutralise formulas.
  label text not null check (char_length(label) between 1 and 40 and label = btrim(label)),
  created_at timestamptz not null default now(),
  constraint event_tracking_links_event_code_key unique (event_id, code)
);

-- One label per event, ignoring case (so the organiser can tell links apart).
create unique index event_tracking_links_event_label_key on public.event_tracking_links (event_id, lower(label));
-- event_tracking_links_event_code_key serves "this event's links" and "is this
-- code one of the event's", which are the only lookups.

-- ---------------------------------------------------------------------------
-- View counters
-- ---------------------------------------------------------------------------

create table public.event_view_counts (
  event_id uuid not null references public.events (id) on delete cascade,
  -- The Australia/Melbourne calendar day the view was counted on.
  day date not null,
  source text not null check (source in (
    'direct', 'search', 'instagram', 'facebook', 'x', 'tiktok', 'email', 'eventbrite', 'other', 'tracking')),
  -- Only for source 'tracking': one of the event's codes when the view was
  -- counted. Not a foreign key: a deleted link's counts are kept, under its code.
  link_code text check (link_code ~ '^[2-9a-hjkmnp-z]{6,10}$'),
  views integer not null check (views >= 1),
  constraint event_view_counts_code_only_for_tracking check (link_code is null or source = 'tracking')
);

-- The counter's key (a primary key can't hold an expression, and link_code is
-- nullable). Also serves every read: one event's rows over a range of days,
-- and the events FK cascade. No index on day alone: only the daily purge
-- filters on it without an event.
create unique index event_view_counts_key on public.event_view_counts (event_id, day, source, coalesce(link_code, ''));

-- ---------------------------------------------------------------------------
-- Per-event rate limits (keyed on the event, never on a person)
-- ---------------------------------------------------------------------------

create table private.event_rate_limits (
  event_id uuid not null references public.events (id) on delete cascade,
  bucket text not null check (char_length(bucket) between 1 and 64),
  window_started_at timestamptz not null,
  hits integer not null check (hits >= 1),
  primary key (event_id, bucket)
);

-- Same semantics as private.take_rate_limit (20261002000000_whos_going_hardening.sql):
-- records one hit, returns whether it's within p_limit per p_window. One
-- upsert, so concurrent hits can't both take the last slot; `hits` stops at
-- p_limit + 1.
create function private.take_event_rate_limit(p_event_id uuid, p_bucket text, p_limit integer, p_window interval)
returns boolean
language sql
set search_path = ''
as $$
  insert into private.event_rate_limits as r (event_id, bucket, window_started_at, hits)
  values (p_event_id, p_bucket, now(), 1)
  on conflict (event_id, bucket) do update
     set window_started_at = case when r.window_started_at <= now() - p_window then now() else r.window_started_at end,
         hits = case when r.window_started_at <= now() - p_window then 1 else least(r.hits + 1, p_limit + 1) end
  returning hits <= p_limit;
$$;

-- ---------------------------------------------------------------------------
-- When view counting started
-- ---------------------------------------------------------------------------

create table private.analytics_settings (
  -- A single row.
  id boolean primary key default true check (id),
  views_tracked_since date not null
);

insert into private.analytics_settings (views_tracked_since)
values ((now() at time zone 'Australia/Melbourne')::date);

-- ---------------------------------------------------------------------------
-- Order attribution
-- ---------------------------------------------------------------------------

-- Nullable with no default: a metadata-only change. Set only by the checkout
-- API, and only to a code that belonged to the event's links at that moment.
alter table public.orders
  add column tracking_code text check (tracking_code ~ '^[2-9a-hjkmnp-z]{6,10}$');

-- The analytics overview reads one organiser's paid orders over a date range.
-- Partial (paid only), like orders_event_paid_email_idx, which already serves
-- the per-event reports (event_id, status = 'paid').
create index orders_organiser_paid_created_idx on public.orders (organiser_id, created_at) where status = 'paid';

-- ---------------------------------------------------------------------------
-- Lock the Data API out
-- ---------------------------------------------------------------------------

alter table public.event_tracking_links enable row level security;
alter table public.event_view_counts enable row level security;
alter table private.event_rate_limits enable row level security;
alter table private.analytics_settings enable row level security;

revoke all on public.event_tracking_links, public.event_view_counts from anon, authenticated;
revoke all on private.event_rate_limits, private.analytics_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Count a view
-- ---------------------------------------------------------------------------

-- Counts one view of p_event_id. p_source must be one of the buckets (else
-- 'other'). p_code, if it's one of the event's tracking codes, makes the view
-- source 'tracking' under that code; an unknown code is ignored, and
-- 'tracking' without a valid code becomes 'other'. Returns:
--   'recorded'     counted
--   'not_found'    no such event, or it isn't published
--   'rate_limited' over p_limit views per p_window for this event: not counted
-- No row lock on the event: a view landing as the event is unpublished is
-- harmless, and locking would make every view write to the events table. No
-- exception block either (it would cost a subtransaction per view): an event
-- deleted mid-call (only ever by hand) fails the insert, and the API answers
-- 204 regardless.
create function private.record_view(p_event_id uuid, p_source text, p_code text, p_limit integer, p_window interval)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_source text := p_source;
  v_code text;
begin
  perform 1 from public.events e where e.id = p_event_id and e.status = 'published';
  if not found then
    return 'not_found';
  end if;

  if v_source is null or v_source not in (
       'direct', 'search', 'instagram', 'facebook', 'x', 'tiktok', 'email', 'eventbrite', 'other', 'tracking') then
    v_source := 'other';
  end if;

  if p_code is not null then
    select l.code into v_code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_code;
  end if;
  if v_code is not null then
    v_source := 'tracking';
  elsif v_source = 'tracking' then
    v_source := 'other';
  end if;

  if not private.take_event_rate_limit(p_event_id, 'views', p_limit, p_window) then
    return 'rate_limited';
  end if;

  insert into public.event_view_counts as c (event_id, day, source, link_code, views)
  values (p_event_id, (now() at time zone 'Australia/Melbourne')::date, v_source, v_code, 1)
  on conflict (event_id, day, source, coalesce(link_code, '')) do update set views = c.views + 1;
  return 'recorded';
end;
$$;

-- ---------------------------------------------------------------------------
-- Create a tracking link
-- ---------------------------------------------------------------------------

-- Adds a link to p_event_id if it belongs to p_organiser_id. Returns
-- (result, link_id, link_created_at):
--   'created'     done
--   'not_found'   no such event, or not the organiser's
--   'limit'       the event already has p_limit links
--   'label_taken' the event already has a link with that label (any case)
--   'code_taken'  the code collided with one of the event's codes: the API
--                 retries with a fresh code
-- A transaction-scoped advisory lock on the event serialises one event's
-- creates, so two concurrent requests can't both take the last slot. The
-- events row itself isn't locked (that would hold up checkouts).
create function private.create_tracking_link(
  p_event_id uuid, p_organiser_id uuid, p_code text, p_label text, p_limit integer,
  out result text, out link_id uuid, out link_created_at timestamptz)
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id;
  if not found then
    result := 'not_found';
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('event_tracking_links:' || p_event_id::text, 0));

  if (select count(*) from public.event_tracking_links l where l.event_id = p_event_id) >= p_limit then
    result := 'limit';
    return;
  end if;
  if exists (select 1 from public.event_tracking_links l
              where l.event_id = p_event_id and lower(l.label) = lower(p_label)) then
    result := 'label_taken';
    return;
  end if;

  begin
    insert into public.event_tracking_links (event_id, code, label)
    values (p_event_id, p_code, p_label)
    returning id, created_at into link_id, link_created_at;
  exception
    when unique_violation then
      result := 'code_taken';
      return;
    when foreign_key_violation then
      result := 'not_found';
      return;
  end;
  result := 'created';
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- Deletes view counters for days more than 25 months ago (two full years to
-- compare against, plus a month of slack), and per-event rate-limit rows idle
-- for over a day. Idempotent; run daily by Supabase Cron
-- (docs/supabase-setup.md), not from this migration.
create function private.purge_analytics(out event_view_counts_deleted integer, out event_rate_limits_deleted integer)
language plpgsql
set search_path = ''
as $$
begin
  delete from public.event_view_counts
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;
  get diagnostics event_view_counts_deleted = row_count;

  delete from private.event_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics event_rate_limits_deleted = row_count;
end;
$$;

revoke all on function private.take_event_rate_limit(uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function private.record_view(uuid, text, text, integer, interval) from public, anon, authenticated;
revoke all on function private.create_tracking_link(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function private.purge_analytics() from public, anon, authenticated;


-- ===== 20261014000000_email_outbox.sql =====
-- Reliable ticket email (docs/REMEDIATION_PLAN.md, fix 2).
--
-- Until now the ticket email was sent once, best-effort, straight after an
-- order was paid; a failure was logged and never retried. Now:
--
--   * private.email_outbox: a durable job per (order, kind), transactional
--     mail only. It holds no address or content: the recipient and the
--     tickets are read from the order when the job runs, so the outbox
--     duplicates no personal data.
--   * private.fulfil_order enqueues the ticket email in the same transaction
--     that marks the order paid, so a paid order always has its job, and a
--     duplicate webhook (fulfil_order returns early for an order that isn't
--     pending) or the unique (order_id, kind) key can't make a second one.
--   * private.claim_email_jobs leases due jobs with `for update skip locked`,
--     so concurrent workers (the after-response attempt and the cron route)
--     never take the same job. A worker that dies mid-send leaves a lease
--     that expires and is taken again: delivery is at-least-once.
--   * private.finish_email_job records the outcome, but only for the worker
--     still holding the lease. The retry delay is chosen by the API
--     (lib/server/email-outbox.ts: 1 min, 5 min, 30 min, 2 h, 6 h with
--     jitter, then `failed` after 6 attempts).
--   * private.resend_email_job: an admin's manual resend.
--   * fulfil_order now pins its search_path (it already schema-qualified
--     every name); its behaviour is otherwise unchanged.
--
-- Paid orders whose email never went out (tickets_emailed_at is null) get a
-- `failed` job, so they show up in the admin list for a manual resend; none
-- is sent automatically.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC.
--
-- Reversible: drop functions private.resend_email_job,
-- private.finish_email_job and private.claim_email_jobs; restore fulfil_order
-- from 20260927000000_review_fixes.sql; drop table private.email_outbox. That
-- discards the delivery history (orders.tickets_emailed_at is kept).

create table private.email_outbox (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('ticket_email')),
  order_id text not null references public.orders (id) on delete cascade,
  -- pending: waiting for next_attempt_at. sending: leased to a worker until
  -- lease_expires_at. sent / failed: done (an admin resend makes it pending).
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  -- Attempts made, counted when a worker takes the job.
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  -- Redacted by the API (no addresses), at most 200 characters.
  last_error text check (char_length(last_error) <= 200),
  last_resend_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_outbox_order_kind_key unique (order_id, kind),
  constraint email_outbox_lease_only_while_sending
    check ((status = 'sending') = (lease_token is not null and lease_expires_at is not null)),
  constraint email_outbox_sent_has_time check (status <> 'sent' or sent_at is not null)
);

-- Due jobs, in order (the claim's main path). Partial: only pending rows,
-- which are few at any moment.
create index email_outbox_due_idx on private.email_outbox (next_attempt_at, id) where status = 'pending';
-- Leases that may have expired (a worker died mid-send).
create index email_outbox_leased_idx on private.email_outbox (lease_expires_at) where status = 'sending';
-- The admin list: one status, newest first.
create index email_outbox_status_created_idx on private.email_outbox (status, created_at desc, id desc);
-- email_outbox_order_kind_key (order_id first) serves the orders FK cascade
-- and "this order's job".

create trigger email_outbox_set_updated_at before update on private.email_outbox
  for each row execute function public.set_updated_at();

alter table private.email_outbox enable row level security;
revoke all on private.email_outbox from public, anon, authenticated;

-- Paid orders from before the outbox whose email never went out: listed for
-- an admin to resend, never sent automatically.
insert into private.email_outbox (kind, order_id, status, last_error)
select 'ticket_email', o.id, 'failed', 'not sent before the outbox existed'
  from public.orders o
 where o.status = 'paid' and o.buyer_email is not null and o.tickets_emailed_at is null;

-- ---------------------------------------------------------------------------
-- fulfil_order: unchanged, plus the ticket email job and a pinned search_path
-- ---------------------------------------------------------------------------

create or replace function private.fulfil_order(
  p_order_id text, p_buyer_email text, p_payment_intent_id text, p_tickets jsonb
) returns public.order_status
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
  v_line jsonb;
  v_event_status public.event_status;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return null;
  end if;
  if v_order.status <> 'pending' then
    return v_order.status;
  end if;

  begin
    select status into v_event_status from public.events where id = v_order.event_id for share;
    if v_event_status is distinct from 'published' then
      raise exception 'event % is not published', v_order.event_id using errcode = 'SH409';
    end if;

    -- Fixed lock order across concurrent orders avoids deadlocks.
    for v_line in
      select value from jsonb_array_elements(v_order.line_items) order by value ->> 'ticketTypeId'
    loop
      update public.ticket_types
      set quantity_sold = quantity_sold + (v_line ->> 'quantity')::integer
      where event_id = v_order.event_id
        and id = v_line ->> 'ticketTypeId'
        and quantity_sold + (v_line ->> 'quantity')::integer <= quantity_available;

      if not found then
        raise exception 'sold out: %', v_line ->> 'ticketTypeId' using errcode = 'SH409';
      end if;
    end loop;

    insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name)
    select t ->> 'ticketCode', p_order_id, v_order.event_id, t ->> 'ticketTypeId', t ->> 'ticketTypeName'
    from jsonb_array_elements(p_tickets) t;

    update public.orders
    set status = 'paid',
        buyer_email = coalesce(p_buyer_email, buyer_email),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;

    -- The ticket email, committed with the payment: it can't be lost, and a
    -- redelivered webhook never reaches here (the order isn't pending).
    if coalesce(p_buyer_email, v_order.buyer_email) is not null then
      insert into private.email_outbox (kind, order_id) values ('ticket_email', p_order_id)
      on conflict (order_id, kind) do nothing;
    end if;
    return 'paid';
  exception when sqlstate 'SH409' then
    -- Everything in this block (partial reservations included) is rolled back.
    update public.orders
    set status = 'oversold_refund_required',
        buyer_email = coalesce(p_buyer_email, buyer_email),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;
    return 'oversold_refund_required';
  end;
end;
$$;

revoke all on function private.fulfil_order(text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Workers
-- ---------------------------------------------------------------------------

-- Leases up to p_limit due jobs (only p_order_id's, if given) for p_lease,
-- counting an attempt on each. Due: pending and past next_attempt_at, or
-- leased and past lease_expires_at (its worker died). A lease that expired on
-- the last allowed attempt (p_max_attempts) is marked failed instead.
-- `skip locked`: concurrent workers each get different jobs, never wait on
-- each other, and never take a job twice.
create function private.claim_email_jobs(
  p_limit integer, p_lease interval, p_max_attempts integer, p_order_id text default null
) returns table (job_id bigint, job_order_id text, job_lease_token uuid, job_attempts integer)
language plpgsql
set search_path = ''
as $$
begin
  update private.email_outbox o
     set status = 'failed', lease_token = null, lease_expires_at = null,
         last_error = coalesce(o.last_error, 'the last attempt never finished')
   where o.status = 'sending' and o.lease_expires_at <= now() and o.attempts >= p_max_attempts
     and (p_order_id is null or o.order_id = p_order_id);

  return query
  with picked as (
    select o.id from private.email_outbox o
     where ((o.status = 'pending' and o.next_attempt_at <= now())
         or (o.status = 'sending' and o.lease_expires_at <= now()))
       and (p_order_id is null or o.order_id = p_order_id)
     order by o.next_attempt_at, o.id
     limit p_limit
     for update skip locked
  )
  update private.email_outbox o
     set status = 'sending', lease_token = gen_random_uuid(), lease_expires_at = now() + p_lease,
         attempts = o.attempts + 1
    from picked
   where o.id = picked.id
  returning o.id, o.order_id, o.lease_token, o.attempts;
end;
$$;

-- Records a leased job's outcome. Only the worker still holding the lease
-- (p_lease_token) can: one whose lease expired and was taken over gets
-- 'lease_lost' and changes nothing. Returns:
--   'sent'       delivered; the order's tickets_emailed_at is set
--   'retry'      failed; pending again in p_retry_in
--   'failed'     failed for good (p_retry_in is null)
--   'lease_lost' not this worker's job any more
create function private.finish_email_job(
  p_job_id bigint, p_lease_token uuid, p_sent boolean, p_error text, p_retry_in interval
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_order_id text;
begin
  if p_sent then
    update private.email_outbox o
       set status = 'sent', sent_at = now(), lease_token = null, lease_expires_at = null, last_error = null
     where o.id = p_job_id and o.status = 'sending' and o.lease_token = p_lease_token
     returning o.order_id into v_order_id;
    if not found then
      return 'lease_lost';
    end if;
    update public.orders set tickets_emailed_at = now() where id = v_order_id;
    return 'sent';
  end if;

  update private.email_outbox o
     set status = case when p_retry_in is null then 'failed' else 'pending' end,
         next_attempt_at = case when p_retry_in is null then o.next_attempt_at else now() + p_retry_in end,
         lease_token = null, lease_expires_at = null,
         last_error = left(p_error, 200)
   where o.id = p_job_id and o.status = 'sending' and o.lease_token = p_lease_token;
  if not found then
    return 'lease_lost';
  end if;
  return case when p_retry_in is null then 'failed' else 'retry' end;
end;
$$;

-- An admin's manual resend: the job is due now, with a fresh set of attempts.
-- Returns:
--   'queued'      done
--   'not_found'   no such job
--   'in_progress' a worker holds it right now
--   'too_soon'    it was resent less than p_min_interval ago
create function private.resend_email_job(p_job_id bigint, p_min_interval interval, out result text, out order_id text)
language plpgsql
set search_path = ''
as $$
declare
  v_job private.email_outbox;
begin
  select * into v_job from private.email_outbox o where o.id = p_job_id for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  order_id := v_job.order_id;
  if v_job.status = 'sending' then
    result := 'in_progress';
    return;
  end if;
  if v_job.last_resend_at is not null and v_job.last_resend_at > now() - p_min_interval then
    result := 'too_soon';
    return;
  end if;
  update private.email_outbox o
     set status = 'pending', attempts = 0, next_attempt_at = now(), last_resend_at = now(), last_error = null
   where o.id = p_job_id;
  result := 'queued';
end;
$$;

revoke all on function private.claim_email_jobs(integer, interval, integer, text) from public, anon, authenticated;
revoke all on function private.finish_email_job(bigint, uuid, boolean, text, interval) from public, anon, authenticated;
revoke all on function private.resend_email_job(bigint, interval) from public, anon, authenticated;


-- ===== 20261014000100_free_order_protection.sql =====
-- Free-ticket abuse protection (docs/REMEDIATION_PLAN.md, fix 1).
--
-- Free checkout used to issue tickets to anyone, instantly, for any address,
-- with no limit. Now (no IP addresses, no CAPTCHA):
--
--   * A signed-in member booking with their own verified email gets the
--     tickets straight away (private.place_free_order), at most 10 free
--     orders per account per 24 hours.
--   * Anyone else gets an emailed confirmation link
--     (private.request_free_order): the order is recorded as pending with
--     only a SHA-256 hash of the link's token, holds no inventory, and
--     expires after 24 hours. Tickets are issued only when the link's page
--     POSTs the token back (private.confirm_free_order).
--   * At most 4 free tickets per order (checked by the API), and 4 per person
--     per event, counted on a normalised address (private.email_key: case,
--     a `+tag`, and dots for Gmail) under an advisory lock on (event, person)
--     so concurrent claims can't both take the last allowance.
--   * At most 3 unconfirmed links per address per hour (advisory lock on the
--     address), and 300 confirmation emails an hour platform-wide
--     (private.platform_rate_limits).
--   * private.free_order_refusals counts refusals per Melbourne day and
--     reason: no address, account, event or IP.
--   * private.purge_operational_data (daily, Supabase Cron) deletes
--     unconfirmed free orders a week after their link expired, idle
--     platform counters, refusal counts after 13 months, and old outbox jobs.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC.
--
-- Reversible: drop functions private.purge_operational_data,
-- private.confirm_free_order, private.request_free_order,
-- private.place_free_order, private.record_free_order_refusal,
-- private.take_platform_rate_limit and private.email_key; drop tables
-- private.free_order_refusals and private.platform_rate_limits; drop indexes
-- orders_free_person_idx and orders_guest_links_idx; drop constraint
-- orders_confirmation_pair and columns orders.confirmation_expires_at,
-- orders.confirmation_token_hash and orders.buyer_email_key. Unconfirmed free
-- orders would then look like ordinary pending ones; delete them first.

-- ---------------------------------------------------------------------------
-- One person, one key
-- ---------------------------------------------------------------------------

-- The address a free-ticket allowance is counted on: lower-cased and trimmed,
-- without a `+tag` (most providers deliver fan+1@ and fan+2@ to fan@), and for
-- Gmail without dots and with googlemail.com folded into gmail.com.
create function private.email_key(p_email text) returns text
language sql
immutable strict
set search_path = ''
as $$
  with e as (select lower(btrim(p_email)) as v),
  parts as (
    select substr(v, 1, length(v) - strpos(reverse(v), '@')) as local,
           substr(v, length(v) - strpos(reverse(v), '@') + 2) as domain
      from e
  )
  select case when domain in ('gmail.com', 'googlemail.com')
              then replace(split_part(local, '+', 1), '.', '') || '@gmail.com'
              else split_part(local, '+', 1) || '@' || domain
         end
    from parts;
$$;

-- ---------------------------------------------------------------------------
-- Orders: the key, and guest confirmation links
-- ---------------------------------------------------------------------------

alter table public.orders
  -- private.email_key(buyer_email), for free orders only.
  add column buyer_email_key text check (char_length(buyer_email_key) <= 320),
  -- SHA-256 (hex) of a guest's confirmation token. The token itself is only
  -- ever in the email. Kept after confirmation so a second click is harmless.
  add column confirmation_token_hash text unique check (confirmation_token_hash ~ '^[0-9a-f]{64}$'),
  add column confirmation_expires_at timestamptz,
  add constraint orders_confirmation_pair
    check ((confirmation_token_hash is null) = (confirmation_expires_at is null));

-- Free tickets issued to one person for one event (the per-person cap).
create index orders_free_person_idx on public.orders (event_id, buyer_email_key)
  where total_cents = 0 and status = 'paid';
-- Guest links not (yet) confirmed, by age. Serves both "this address's links
-- in the last hour" (at most a few hundred rows: the platform cap bounds how
-- many are made an hour) and the purge of expired ones. Confirmed links drop
-- out of it, so it stays small.
create index orders_guest_links_idx on public.orders (created_at)
  where confirmation_token_hash is not null and status in ('pending', 'failed');

-- Existing free orders get their key, so they count towards the cap.
update public.orders set buyer_email_key = private.email_key(buyer_email)
 where total_cents = 0 and buyer_email is not null;

-- ---------------------------------------------------------------------------
-- Platform-wide counters and refusal counts (no personal data)
-- ---------------------------------------------------------------------------

create table private.platform_rate_limits (
  bucket text primary key check (char_length(bucket) between 1 and 64),
  window_started_at timestamptz not null,
  hits integer not null check (hits >= 1)
);

-- Same semantics as private.take_rate_limit, for a counter that belongs to
-- no one: records one hit and returns whether it's within p_limit per p_window.
create function private.take_platform_rate_limit(p_bucket text, p_limit integer, p_window interval)
returns boolean
language sql
set search_path = ''
as $$
  insert into private.platform_rate_limits as r (bucket, window_started_at, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
     set window_started_at = case when r.window_started_at <= now() - p_window then now() else r.window_started_at end,
         hits = case when r.window_started_at <= now() - p_window then 1 else least(r.hits + 1, p_limit + 1) end
  returning hits <= p_limit;
$$;

create table private.free_order_refusals (
  -- Australia/Melbourne calendar day.
  day date not null,
  reason text not null check (reason in (
    'order_too_large', 'member_daily_limit', 'person_event_limit', 'address_hourly_limit', 'platform_hourly_limit')),
  refusals integer not null check (refusals >= 1),
  primary key (day, reason)
);

create function private.record_free_order_refusal(p_reason text) returns void
language sql
set search_path = ''
as $$
  insert into private.free_order_refusals as r (day, reason, refusals)
  values ((now() at time zone 'Australia/Melbourne')::date, p_reason, 1)
  on conflict (day, reason) do update set refusals = r.refusals + 1;
$$;

alter table private.platform_rate_limits enable row level security;
alter table private.free_order_refusals enable row level security;
revoke all on private.platform_rate_limits, private.free_order_refusals from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared check: one person's free tickets for one event
-- ---------------------------------------------------------------------------

-- Takes the (event, person) lock for the rest of the transaction and returns
-- how many free tickets that person already holds for the event.
create function private.lock_free_allowance(p_event_id uuid, p_key text) returns integer
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('free_tickets:' || p_event_id::text || ':' || p_key, 0));
  return (select count(*)::integer
            from public.orders o
            join public.tickets t on t.order_id = o.id
           where o.event_id = p_event_id and o.buyer_email_key = p_key
             and o.total_cents = 0 and o.status = 'paid');
end;
$$;

-- ---------------------------------------------------------------------------
-- Members: tickets straight away
-- ---------------------------------------------------------------------------

-- Creates and fulfils a free order for a member whose verified email is
-- p_buyer_email, in one step. p_line_items is the API's priced snapshot (all
-- free); p_tickets the codes to issue. Returns:
--   'paid'               done (the ticket email is queued by fulfil_order)
--   'person_event_limit' the address would hold more than p_person_limit
--                        free tickets for the event
--   'member_daily_limit' over p_daily_limit free orders per p_daily_window
--   'sold_out'           not enough left, or the event isn't published
-- Nothing is written on a refusal (beyond the refusal count): the daily
-- allowance is only used by an order that's issued. A clashing ticket code
-- (unique_violation) is raised for the API to retry with new codes.
create function private.place_free_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_user_id uuid, p_tickets jsonb,
  p_person_limit integer, p_daily_limit integer, p_daily_window interval
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_key text := private.email_key(p_buyer_email);
  v_quantity integer := jsonb_array_length(p_tickets);
begin
  if private.lock_free_allowance(p_event_id, v_key) + v_quantity > p_person_limit then
    perform private.record_free_order_refusal('person_event_limit');
    return 'person_event_limit';
  end if;

  begin
    if not private.take_rate_limit(p_user_id, 'free_claims', p_daily_limit, p_daily_window) then
      raise exception 'daily free claims' using errcode = 'SH429';
    end if;
    insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
       buyer_fee_cents, total_cents, application_fee_cents, buyer_email, buyer_email_key, tracking_code)
    values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, 0, 0, 0, 0,
       p_buyer_email, v_key,
       (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code));
    if private.fulfil_order(p_order_id, null, null, p_tickets) is distinct from 'paid' then
      raise exception 'sold out' using errcode = 'SH409';
    end if;
  exception
    -- Undoes the allowance hit, the order and any reservation.
    when sqlstate 'SH429' then
      perform private.record_free_order_refusal('member_daily_limit');
      return 'member_daily_limit';
    when sqlstate 'SH409' then
      return 'sold_out';
  end;
  return 'paid';
end;
$$;

-- ---------------------------------------------------------------------------
-- Guests: a pending order and an emailed link
-- ---------------------------------------------------------------------------

-- Records a guest's free order as pending, holding no inventory, with the
-- hash of the token the API is about to email, valid for p_ttl. Returns:
--   'requested'        recorded: the API sends the link
--   'address_limited'  the address already has p_address_limit unconfirmed
--                      links from the last p_address_window: nothing recorded
--                      (the API answers exactly as for 'requested', so the
--                      response says nothing about the address)
--   'platform_limited' over p_platform_limit confirmation emails per
--                      p_platform_window, platform-wide: nothing recorded
-- An advisory lock on the address serialises its requests, so concurrent
-- ones can't all slip under the hourly limit.
create function private.request_free_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_token_hash text, p_ttl interval,
  p_address_limit integer, p_address_window interval, p_platform_limit integer, p_platform_window interval
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_key text := private.email_key(p_buyer_email);
begin
  perform pg_advisory_xact_lock(hashtextextended('free_links:' || v_key, 0));
  if (select count(*) from public.orders o
       where o.confirmation_token_hash is not null and o.status = 'pending'
         and o.created_at > now() - p_address_window and o.buyer_email_key = v_key) >= p_address_limit then
    perform private.record_free_order_refusal('address_hourly_limit');
    return 'address_limited';
  end if;
  if not private.take_platform_rate_limit('free_order_confirmations', p_platform_limit, p_platform_window) then
    perform private.record_free_order_refusal('platform_hourly_limit');
    return 'platform_limited';
  end if;

  insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
     buyer_fee_cents, total_cents, application_fee_cents, buyer_email, buyer_email_key, tracking_code,
     confirmation_token_hash, confirmation_expires_at)
  values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, 0, 0, 0, 0,
     p_buyer_email, v_key,
     (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
     p_token_hash, now() + p_ttl);
  return 'requested';
end;
$$;

-- Confirms a guest's free order by its token's hash, issuing p_tickets.
-- Returns (result, confirmed_order_id):
--   'confirmed'          issued now (the ticket email is queued)
--   'already_confirmed'  issued by an earlier click: nothing changes
--   'not_found'          no such link
--   'expired'            past its expiry: nothing issued
--   'unavailable'        it was refused before (sold out, or the cap)
--   'person_event_limit' the address already holds too many free tickets
--                        for the event: the order is marked failed
--   'sold_out'           not enough left, or the event isn't published: the
--                        order is marked failed
-- confirmed_order_id is set for the two confirmed results only. Locks the
-- order, then (event, person), then fulfil_order's own locks, so two clicks,
-- or confirmations of two orders by one person, run one after the other.
create function private.confirm_free_order(
  p_token_hash text, p_tickets jsonb, p_person_limit integer,
  out result text, out confirmed_order_id text)
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders o where o.confirmation_token_hash = p_token_hash for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  if v_order.status = 'paid' then
    result := 'already_confirmed';
    confirmed_order_id := v_order.id;
    return;
  end if;
  if v_order.status <> 'pending' then
    result := 'unavailable';
    return;
  end if;
  if v_order.confirmation_expires_at <= now() then
    result := 'expired';
    return;
  end if;

  if private.lock_free_allowance(v_order.event_id, v_order.buyer_email_key) + jsonb_array_length(p_tickets)
       > p_person_limit then
    update public.orders set status = 'failed' where id = v_order.id;
    perform private.record_free_order_refusal('person_event_limit');
    result := 'person_event_limit';
    return;
  end if;
  if private.fulfil_order(v_order.id, null, null, p_tickets) is distinct from 'paid' then
    -- Nothing was charged, so there's nothing to refund.
    update public.orders set status = 'failed' where id = v_order.id;
    result := 'sold_out';
    return;
  end if;
  result := 'confirmed';
  confirmed_order_id := v_order.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- Deletes guest free orders that were never confirmed (or were refused) a
-- week after their link expired, platform counters idle for a day, refusal
-- counts after 13 months, sent ticket-email jobs after 90 days and failed
-- ones after a year. Idempotent; run daily by Supabase Cron
-- (docs/supabase-setup.md). Paid orders are financial records and are kept.
create function private.purge_operational_data(
  out unconfirmed_orders_deleted integer, out platform_rate_limits_deleted integer,
  out free_order_refusals_deleted integer, out email_jobs_deleted integer)
language plpgsql
set search_path = ''
as $$
begin
  delete from public.orders o
   where o.confirmation_token_hash is not null and o.status in ('pending', 'failed')
     and o.created_at < now() - interval '7 days'
     and o.confirmation_expires_at < now() - interval '7 days';
  get diagnostics unconfirmed_orders_deleted = row_count;

  delete from private.platform_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics platform_rate_limits_deleted = row_count;

  delete from private.free_order_refusals
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '13 months')::date;
  get diagnostics free_order_refusals_deleted = row_count;

  delete from private.email_outbox j
   where (j.status = 'sent' and j.sent_at < now() - interval '90 days')
      or (j.status = 'failed' and j.updated_at < now() - interval '1 year');
  get diagnostics email_jobs_deleted = row_count;
end;
$$;

revoke all on function private.email_key(text) from public, anon, authenticated;
revoke all on function private.take_platform_rate_limit(text, integer, interval) from public, anon, authenticated;
revoke all on function private.record_free_order_refusal(text) from public, anon, authenticated;
revoke all on function private.lock_free_allowance(uuid, text) from public, anon, authenticated;
revoke all on function private.place_free_order(text, uuid, uuid, text, jsonb, text, text, uuid, jsonb, integer, integer, interval)
  from public, anon, authenticated;
revoke all on function private.request_free_order(text, uuid, uuid, text, jsonb, text, text, text, interval, integer, interval, integer, interval)
  from public, anon, authenticated;
revoke all on function private.confirm_free_order(text, jsonb, integer) from public, anon, authenticated;
revoke all on function private.purge_operational_data() from public, anon, authenticated;


-- ===== 20261015000000_analytics_hardening.sql =====
-- Analytics and favourites hardening (security review of the analytics
-- backend, and code review notes).
--
--   F1. A flood against POST /api/events/{id}/view can fill an event's shared
--       per-minute view cap, so real views are dropped silently. Now it's
--       visible: the first refused view of a window records a per-event,
--       per-Melbourne-day marker (private.event_view_cap_days), and reports
--       flag those days `viewsUnreliable` with no conversion rate. The flood
--       still costs the event its view counts for that minute (accepted:
--       docs/architecture.md, "Accepted risks (analytics)").
--   F2. private.take_event_rate_limit did an upsert (a row write) on every
--       call, even once over the cap, so a flood turned into a write per
--       request on one hot row. It now reads first and refuses without
--       writing while the window is live and already over.
--   Favourites: the 500 cap counted favourites of unpublished events, which
--       members can't see (or remove from the app). It now counts only
--       favourites of published events (see docs/architecture.md,
--       "Favourites").
--
-- Markers hold an event id and a day: no data about any visitor. Deleted with
-- the event, and by private.purge_analytics with the view counts (25 months).
--
-- Reversible: restore take_event_rate_limit and record_view from
-- 20261006000000_event_analytics.sql, purge_analytics likewise, and
-- add_favourite from 20261005000000_favourites.sql; drop table
-- private.event_view_cap_days (discards the markers only).

create table private.event_view_cap_days (
  event_id uuid not null references public.events (id) on delete cascade,
  -- The Australia/Melbourne day the event's view cap was reached.
  day date not null,
  primary key (event_id, day)
);
-- The primary key serves the reports (one event's days over a range) and the
-- events FK cascade. The overview joins through events on organiser_id first.

alter table private.event_view_cap_days enable row level security;
revoke all on private.event_view_cap_days from public, anon, authenticated;

-- Records one hit and returns whether it's within p_limit per p_window, as
-- before; but a window that's live and already over the limit is refused
-- with a plain read, without writing anything. (A concurrent hit can still
-- slip through the read and be refused by the upsert: harmless.)
create or replace function private.take_event_rate_limit(p_event_id uuid, p_bucket text, p_limit integer, p_window interval)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_hits integer;
  v_started timestamptz;
  v_ok boolean;
begin
  select r.hits, r.window_started_at into v_hits, v_started
    from private.event_rate_limits r
   where r.event_id = p_event_id and r.bucket = p_bucket;
  if found and v_started > now() - p_window and v_hits > p_limit then
    return false;
  end if;

  insert into private.event_rate_limits as r (event_id, bucket, window_started_at, hits)
  values (p_event_id, p_bucket, now(), 1)
  on conflict (event_id, bucket) do update
     set window_started_at = case when r.window_started_at <= now() - p_window then now() else r.window_started_at end,
         hits = case when r.window_started_at <= now() - p_window then 1 else least(r.hits + 1, p_limit + 1) end
  returning r.hits <= p_limit into v_ok;
  return v_ok;
end;
$$;

-- As in 20261006000000_event_analytics.sql, plus: a view refused by the cap
-- records that the event's cap was reached today. After the first, that
-- insert finds the row and writes nothing.
create or replace function private.record_view(p_event_id uuid, p_source text, p_code text, p_limit integer, p_window interval)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_source text := p_source;
  v_code text;
begin
  perform 1 from public.events e where e.id = p_event_id and e.status = 'published';
  if not found then
    return 'not_found';
  end if;

  if v_source is null or v_source not in (
       'direct', 'search', 'instagram', 'facebook', 'x', 'tiktok', 'email', 'eventbrite', 'other', 'tracking') then
    v_source := 'other';
  end if;

  if p_code is not null then
    select l.code into v_code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_code;
  end if;
  if v_code is not null then
    v_source := 'tracking';
  elsif v_source = 'tracking' then
    v_source := 'other';
  end if;

  if not private.take_event_rate_limit(p_event_id, 'views', p_limit, p_window) then
    insert into private.event_view_cap_days (event_id, day)
    values (p_event_id, (now() at time zone 'Australia/Melbourne')::date)
    on conflict (event_id, day) do nothing;
    return 'rate_limited';
  end if;

  insert into public.event_view_counts as c (event_id, day, source, link_code, views)
  values (p_event_id, (now() at time zone 'Australia/Melbourne')::date, v_source, v_code, 1)
  on conflict (event_id, day, source, coalesce(link_code, '')) do update set views = c.views + 1;
  return 'recorded';
end;
$$;

-- As before, plus the cap markers, on the same 25-month horizon as the view
-- counts (not reported separately, so the function's result is unchanged and
-- an existing Supabase Cron job keeps working).
create or replace function private.purge_analytics(out event_view_counts_deleted integer, out event_rate_limits_deleted integer)
language plpgsql
set search_path = ''
as $$
begin
  delete from public.event_view_counts
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;
  get diagnostics event_view_counts_deleted = row_count;

  delete from private.event_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics event_rate_limits_deleted = row_count;

  delete from private.event_view_cap_days
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;
end;
$$;

-- As in 20261005000000_favourites.sql, except that the cap counts only
-- favourites of published events: the ones the member can see and remove.
-- Hidden ones are kept, and come back if their event is published again, so
-- an account can then briefly hold more than p_limit visible favourites.
create or replace function private.add_favourite(p_user_id uuid, p_event_id uuid, p_limit integer) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events e where e.id = p_event_id and e.status = 'published';
  if not found then
    return 'not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('event_favourites:' || p_user_id::text, 0));

  if exists (select 1 from public.event_favourites f where f.user_id = p_user_id and f.event_id = p_event_id) then
    return 'exists';
  end if;

  if (select count(*) from public.event_favourites f
        join public.events e on e.id = f.event_id and e.status = 'published'
       where f.user_id = p_user_id) >= p_limit then
    return 'limit';
  end if;

  insert into public.event_favourites (user_id, event_id) values (p_user_id, p_event_id);
  return 'added';
exception
  when foreign_key_violation then
    -- The account (or the event) was deleted mid-call.
    return 'not_found';
end;
$$;

revoke all on function private.take_event_rate_limit(uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function private.record_view(uuid, text, text, integer, interval) from public, anon, authenticated;
revoke all on function private.purge_analytics() from public, anon, authenticated;
revoke all on function private.add_favourite(uuid, uuid, integer) from public, anon, authenticated;


-- ===== 20261016000000_organiser_public_profile.sql =====
-- Public organiser profile: "who posted this event", with their social links.
--
-- Social profiles are stored as handles, never as free-form URLs: the server
-- builds the https URLs itself (lib/server/organiser-input.ts), so a stored
-- value can't point anywhere but the network it names. The CHECKs mirror the
-- API's validation (which also strips a leading '@'), so a bad handle can't
-- get in by any other path. Every new column is nullable: unset means the
-- organiser hasn't given one.
--
-- website_url gains a CHECK that it's an http(s) URL of at most 2048
-- characters. The API has only ever accepted http(s) URLs (optionalUrl in
-- lib/server/validation.ts), so existing rows pass; if one didn't, this
-- migration would fail (and change nothing) rather than alter data.
--
-- No new table, policy or grant: public.organisers keeps RLS on with no
-- policies, and anon/authenticated still have no grants (init migration).
-- New columns get no column grants either.
--
-- Indexes: none added. The public profile reads one organiser by primary key,
-- then its published events by organiser_id; events_organiser_created_idx
-- (organiser_id, created_at desc) already narrows that to one organiser's
-- events (a handful each), which are then filtered and sorted in memory.
--
-- Reversible, not destructive: drop the four columns (discards any handles
-- entered since) and the website_url constraint.

alter table public.organisers
  add column instagram_handle text
    constraint organisers_instagram_handle_check
    check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$' and instagram_handle ~ '[A-Za-z0-9]'),
  add column tiktok_handle text
    constraint organisers_tiktok_handle_check
    check (tiktok_handle ~ '^[A-Za-z0-9._]{1,30}$' and tiktok_handle ~ '[A-Za-z0-9]'),
  add column facebook_page text
    constraint organisers_facebook_page_check
    check (facebook_page ~ '^[A-Za-z0-9.]{5,50}$' and facebook_page ~ '[A-Za-z0-9]'),
  add column x_handle text
    constraint organisers_x_handle_check
    check (x_handle ~ '^[A-Za-z0-9_]{1,15}$' and x_handle ~ '[A-Za-z0-9]'),
  add constraint organisers_website_url_check
    check (website_url ~* '^https?://' and char_length(website_url) <= 2048);


-- ===== 20261017000000_free_order_caps.sql =====
-- Free-ticket and outbox review fixes (code and security review of acc5e86).
--
--   H1. Guest confirmation emails share the Google Workspace SMTP quota
--       (about 2,000 messages a day) with ticket emails, and the hourly cap
--       alone allowed thousands a day. private.request_free_order now also
--       takes a platform-wide 24-hour bucket
--       ('free_order_confirmations_daily'; the API passes 400, and its hourly
--       cap is now 60) and returns 'platform_daily_limited' (the API's same
--       503) when it's used up. New refusal reason: 'platform_daily_limit'.
--   Platform caps first. request_free_order checks (read-only) whether either
--       platform cap is used up before it looks at the address, so a refusal
--       for the platform doesn't depend on which address asked. The buckets
--       are only taken (written) for a link that's about to be sent.
--   No writes once over a cap. private.take_platform_rate_limit reads first
--       and refuses without writing while its window is live and over (as
--       private.take_event_rate_limit does), and
--       private.record_free_order_refusal stops counting at 10,000 refusals
--       per day and reason (read first, then no write), so a flood isn't a
--       write per request on one hot row.
--   Confirmation. private.confirm_free_order now refuses an expired link even
--       once it's been confirmed ('expired_confirmed'; a confirmed link still
--       answers with its page within its 24 hours), and refuses
--       ('no_longer_free', the order marked failed, nothing issued) if any of
--       the order's ticket types is no longer free (or no longer exists).
--   L2. private.email_key('+promo@gmail.com') was '@gmail.com': everything
--       before the first '+' is empty, so every such address shared one key
--       (and one per-person allowance). When that part is empty (or, for
--       Gmail, only dots), the key now keeps the whole local part. Existing
--       keys are recomputed where they differ (only addresses of that shape).
--   L3. An admin's resend used a slot of their hourly allowance (20) even when
--       the job didn't exist, was being sent, or had just been resent.
--       private.admin_resend_email_job takes the slot only for a resend that's
--       actually queued, in the same transaction.
--
-- The previous 13-argument private.request_free_order is kept, delegating to
-- the new one with the same daily cap, so an app still running the previous
-- release during a deploy keeps working (and can't skip the daily cap). The
-- app no longer calls it; dropping it is a separate, approved change.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC. No new
-- tables, columns or indexes: the new reads are by primary key
-- (platform_rate_limits.bucket, free_order_refusals (day, reason),
-- ticket_types (event_id, id)).
--
-- Reversible, not destructive: restore private.email_key,
-- private.take_platform_rate_limit, private.record_free_order_refusal,
-- private.confirm_free_order and the 13-argument private.request_free_order
-- from 20261014000100_free_order_protection.sql (then recompute
-- orders.buyer_email_key the same way as below); drop functions
-- private.admin_resend_email_job, private.platform_rate_limit_used_up and the
-- 15-argument private.request_free_order; restore the free_order_refusals
-- reason check without 'platform_daily_limit' (after deleting any rows with
-- that reason). No data is deleted here: the backfill only rewrites a
-- derived column.

-- ---------------------------------------------------------------------------
-- L2: one person, one key, even with nothing before the '+'
-- ---------------------------------------------------------------------------

-- The address a free-ticket allowance is counted on: lower-cased and trimmed,
-- without a `+tag` (most providers deliver fan+1@ and fan+2@ to fan@), and for
-- Gmail without dots and with googlemail.com folded into gmail.com. If that
-- leaves nothing before the '@' (an address like +promo@example.com), the
-- whole local part is kept, so such addresses don't all share one key.
create or replace function private.email_key(p_email text) returns text
language sql
immutable strict
set search_path = ''
as $$
  with e as (select lower(btrim(p_email)) as v),
  parts as (
    select substr(v, 1, length(v) - strpos(reverse(v), '@')) as local,
           substr(v, length(v) - strpos(reverse(v), '@') + 2) as domain
      from e
  ),
  keyed as (
    select local,
           domain in ('gmail.com', 'googlemail.com') as is_gmail,
           case when domain in ('gmail.com', 'googlemail.com')
                then replace(split_part(local, '+', 1), '.', '')
                else split_part(local, '+', 1)
           end as base,
           domain
      from parts
  )
  select case when base = '' then local else base end
         || '@' || case when is_gmail then 'gmail.com' else domain end
    from keyed;
$$;

-- Only keys the old definition got wrong change. buyer_email_key is set for
-- free orders only (it's what the per-person cap counts), so so is this.
update public.orders
   set buyer_email_key = private.email_key(buyer_email)
 where buyer_email_key is not null
   and buyer_email is not null
   and buyer_email_key is distinct from private.email_key(buyer_email);

-- ---------------------------------------------------------------------------
-- Counters that stop writing once they're over
-- ---------------------------------------------------------------------------

-- Same semantics as before (records one hit, returns whether it's within
-- p_limit per p_window), but while the window is live and already over the
-- limit it refuses with a plain read and writes nothing.
create or replace function private.take_platform_rate_limit(p_bucket text, p_limit integer, p_window interval)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  -- Already refused in this window: the upsert below would only re-write limit + 1.
  perform 1 from private.platform_rate_limits r
   where r.bucket = p_bucket and r.hits > p_limit and r.window_started_at > now() - p_window;
  if found then
    return false;
  end if;

  insert into private.platform_rate_limits as r (bucket, window_started_at, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
     set window_started_at = case when r.window_started_at <= now() - p_window then now() else r.window_started_at end,
         hits = case when r.window_started_at <= now() - p_window then 1 else least(r.hits + 1, p_limit + 1) end
  returning r.hits <= p_limit into v_ok;
  return v_ok;
end;
$$;

-- Whether p_bucket's live window already has p_limit hits (so the next take
-- would be refused). Read-only: nothing is recorded.
create function private.platform_rate_limit_used_up(p_bucket text, p_limit integer, p_window interval)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from private.platform_rate_limits r
     where r.bucket = p_bucket and r.hits >= p_limit and r.window_started_at > now() - p_window);
$$;

-- Counts one refusal for today (Australia/Melbourne) and p_reason, up to
-- 10,000: past that, a read finds the count full and nothing is written.
create or replace function private.record_free_order_refusal(p_reason text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Australia/Melbourne')::date;
begin
  perform 1 from private.free_order_refusals r
   where r.day = v_day and r.reason = p_reason and r.refusals >= 10000;
  if found then
    return;
  end if;
  insert into private.free_order_refusals as r (day, reason, refusals)
  values (v_day, p_reason, 1)
  on conflict (day, reason) do update set refusals = least(r.refusals + 1, 10000);
end;
$$;

-- ---------------------------------------------------------------------------
-- H1: a daily platform cap on confirmation emails, checked first
-- ---------------------------------------------------------------------------

alter table private.free_order_refusals
  drop constraint free_order_refusals_reason_check,
  add constraint free_order_refusals_reason_check check (reason in (
    'order_too_large', 'member_daily_limit', 'person_event_limit', 'address_hourly_limit',
    'platform_hourly_limit', 'platform_daily_limit'));

-- Records a guest's free order as pending, holding no inventory, with the
-- hash of the token the API is about to email, valid for p_ttl. Returns:
--   'requested'              recorded: the API sends the link
--   'platform_limited'       p_platform_limit confirmation emails already sent
--                            in this p_platform_window, platform-wide
--   'platform_daily_limited' likewise for p_platform_daily_limit per
--                            p_platform_daily_window
--   'address_limited'        the address already has p_address_limit
--                            unconfirmed links from the last p_address_window
--                            (the API answers exactly as for 'requested')
-- Nothing is recorded on a refusal beyond its count. The platform caps are
-- checked before the address, so their refusal is the same for every
-- address; they're only taken (hourly, then daily) for a link about to be
-- sent, and taking can still refuse if a concurrent request took the last
-- one. An advisory lock on the address serialises its requests, so
-- concurrent ones can't all slip under the hourly address limit.
create function private.request_free_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_token_hash text, p_ttl interval,
  p_address_limit integer, p_address_window interval, p_platform_limit integer, p_platform_window interval,
  p_platform_daily_limit integer, p_platform_daily_window interval
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_key text := private.email_key(p_buyer_email);
begin
  if private.platform_rate_limit_used_up('free_order_confirmations', p_platform_limit, p_platform_window) then
    perform private.record_free_order_refusal('platform_hourly_limit');
    return 'platform_limited';
  end if;
  if private.platform_rate_limit_used_up('free_order_confirmations_daily', p_platform_daily_limit, p_platform_daily_window) then
    perform private.record_free_order_refusal('platform_daily_limit');
    return 'platform_daily_limited';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('free_links:' || v_key, 0));
  if (select count(*) from public.orders o
       where o.confirmation_token_hash is not null and o.status = 'pending'
         and o.created_at > now() - p_address_window and o.buyer_email_key = v_key) >= p_address_limit then
    perform private.record_free_order_refusal('address_hourly_limit');
    return 'address_limited';
  end if;

  if not private.take_platform_rate_limit('free_order_confirmations', p_platform_limit, p_platform_window) then
    perform private.record_free_order_refusal('platform_hourly_limit');
    return 'platform_limited';
  end if;
  if not private.take_platform_rate_limit('free_order_confirmations_daily', p_platform_daily_limit, p_platform_daily_window) then
    perform private.record_free_order_refusal('platform_daily_limit');
    return 'platform_daily_limited';
  end if;

  insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
     buyer_fee_cents, total_cents, application_fee_cents, buyer_email, buyer_email_key, tracking_code,
     confirmation_token_hash, confirmation_expires_at)
  values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, 0, 0, 0, 0,
     p_buyer_email, v_key,
     (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
     p_token_hash, now() + p_ttl);
  return 'requested';
end;
$$;

-- The previous signature, for the previous release during a deploy: the same,
-- with the daily cap the API uses (lib/server/handlers/free-orders.ts).
create or replace function private.request_free_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_token_hash text, p_ttl interval,
  p_address_limit integer, p_address_window interval, p_platform_limit integer, p_platform_window interval
) returns text
language sql
set search_path = ''
as $$
  select private.request_free_order(
    p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items,
    p_buyer_email, p_tracking_code, p_token_hash, p_ttl,
    p_address_limit, p_address_window, p_platform_limit, p_platform_window,
    400, interval '24 hours');
$$;

-- ---------------------------------------------------------------------------
-- Confirmation: expiry always, and only tickets that are still free
-- ---------------------------------------------------------------------------

-- Confirms a guest's free order by its token's hash, issuing p_tickets.
-- Returns (result, confirmed_order_id):
--   'confirmed'          issued now (the ticket email is queued)
--   'already_confirmed'  issued by an earlier click, link not yet expired:
--                        nothing changes
--   'expired_confirmed'  issued by an earlier click, but the link has expired
--   'not_found'          no such link
--   'expired'            past its expiry: nothing issued
--   'unavailable'        it was refused before (sold out, the cap, a price)
--   'person_event_limit' the address already holds too many free tickets
--                        for the event: the order is marked failed
--   'no_longer_free'     one of its ticket types now has a price, or is
--                        gone: the order is marked failed, nothing issued
--   'sold_out'           not enough left, or the event isn't published: the
--                        order is marked failed
-- confirmed_order_id is set for 'confirmed' and 'already_confirmed' only.
-- Locks the order, then (event, person), then the event (share, as
-- fulfil_order does next, so the prices read can't change before the
-- tickets are issued: a published event's ticket types aren't edited), then
-- fulfil_order's own locks.
create or replace function private.confirm_free_order(
  p_token_hash text, p_tickets jsonb, p_person_limit integer,
  out result text, out confirmed_order_id text)
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders o where o.confirmation_token_hash = p_token_hash for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  if v_order.confirmation_expires_at <= now() then
    result := case when v_order.status = 'paid' then 'expired_confirmed' else 'expired' end;
    return;
  end if;
  if v_order.status = 'paid' then
    result := 'already_confirmed';
    confirmed_order_id := v_order.id;
    return;
  end if;
  if v_order.status <> 'pending' then
    result := 'unavailable';
    return;
  end if;

  if private.lock_free_allowance(v_order.event_id, v_order.buyer_email_key) + jsonb_array_length(p_tickets)
       > p_person_limit then
    update public.orders set status = 'failed' where id = v_order.id;
    perform private.record_free_order_refusal('person_event_limit');
    result := 'person_event_limit';
    return;
  end if;

  perform 1 from public.events e where e.id = v_order.event_id for share;
  if exists (
    select 1
      from jsonb_array_elements(v_order.line_items) li
      left join public.ticket_types t on t.event_id = v_order.event_id and t.id = li.value ->> 'ticketTypeId'
     where t.id is null or t.price_cents <> 0
  ) then
    update public.orders set status = 'failed' where id = v_order.id;
    result := 'no_longer_free';
    return;
  end if;

  if private.fulfil_order(v_order.id, null, null, p_tickets) is distinct from 'paid' then
    -- Nothing was charged, so there's nothing to refund.
    update public.orders set status = 'failed' where id = v_order.id;
    result := 'sold_out';
    return;
  end if;
  result := 'confirmed';
  confirmed_order_id := v_order.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- L3: an admin's resend uses their allowance only when it's queued
-- ---------------------------------------------------------------------------

-- private.resend_email_job, then (only if it queued the job) one hit on the
-- admin's 'email_resends' allowance. Over the allowance, the resend is undone.
-- Returns (result, order_id): resend_email_job's results ('queued',
-- 'not_found', 'in_progress', 'too_soon'), or 'rate_limited' (nothing
-- changed). Locks the job, then the admin's rate-limit row.
create function private.admin_resend_email_job(
  p_admin_id uuid, p_job_id bigint, p_min_interval interval, p_limit integer, p_window interval,
  out result text, out order_id text)
language plpgsql
set search_path = ''
as $$
begin
  begin
    select r.result, r.order_id into result, order_id
      from private.resend_email_job(p_job_id, p_min_interval) r;
    if result = 'queued' and not private.take_rate_limit(p_admin_id, 'email_resends', p_limit, p_window) then
      raise exception 'resend allowance used up' using errcode = 'SH429';
    end if;
  exception
    -- Undoes the resend (and the refused hit).
    when sqlstate 'SH429' then
      result := 'rate_limited';
      order_id := null;
  end;
end;
$$;

revoke all on function private.email_key(text) from public, anon, authenticated;
revoke all on function private.take_platform_rate_limit(text, integer, interval) from public, anon, authenticated;
revoke all on function private.platform_rate_limit_used_up(text, integer, interval) from public, anon, authenticated;
revoke all on function private.record_free_order_refusal(text) from public, anon, authenticated;
revoke all on function private.request_free_order(text, uuid, uuid, text, jsonb, text, text, text, interval, integer, interval, integer, interval)
  from public, anon, authenticated;
revoke all on function private.request_free_order(text, uuid, uuid, text, jsonb, text, text, text, interval, integer, interval, integer, interval, integer, interval)
  from public, anon, authenticated;
revoke all on function private.confirm_free_order(text, jsonb, integer) from public, anon, authenticated;
revoke all on function private.admin_resend_email_job(uuid, bigint, interval, integer, interval) from public, anon, authenticated;


-- ===== 20261018000000_organiser_profile_moderation.sql =====
-- Organiser profile moderation (security review of organiser profiles, MEDIUM-1).
--
-- An approved organiser edits their public profile (bio, website, social
-- handles) without a new review. The compensating controls:
--
--   * private.organiser_profile_edits: an append-only log of every profile
--     change (old and new value of each changed field) and every admin
--     takedown (with its reason), shown to admins on the organiser queue.
--     Written in the same transaction as the change it records.
--   * private.edit_organiser_profile: the approved organiser's PATCH, as one
--     step: lock the row, check it's still approved, work out which fields
--     really change, update only those and log them.
--   * private.suspend_organiser: an admin takedown of an approved organiser,
--     as one step: status 'rejected' with the reason and reviewer recorded;
--     every published event unpublished (back to draft) and every event
--     waiting for review rejected, each through private.transition_event so
--     event_moderation_log records it with the same reason; and the
--     takedown logged. Nothing is deleted: orders, tickets, drafts and
--     earlier rejected events are left alone. A payment already under way
--     for an unpublished event is refused and refunded by fulfil_order (it
--     only fulfils published events), as for any unpublished event.
--
-- Locks: the organiser row first (for update), then its events in id order
-- (for update). Event approval (lib/server/handlers/admin.ts) share-locks
-- the organiser row before it touches the event, the same order, so an
-- approval and a takedown can't deadlock or interleave: whichever is second
-- sees the other's result.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC and its
-- search_path pinned.
--
-- Index: organiser_profile_edits (organiser_id, id desc) serves the only
-- read, the admin queue's newest 20 entries per organiser (a top-N per
-- organiser in a lateral subquery), and the cascade when an organiser is
-- deleted.
--
-- Reversible, not destructive: drop functions private.suspend_organiser,
-- private.edit_organiser_profile and private.organiser_profile_edits_append_only,
-- then table private.organiser_profile_edits (discarding the log). No
-- existing table, column or row is changed.

create table private.organiser_profile_edits (
  id bigint generated always as identity primary key,
  organiser_id uuid not null references public.organisers (id) on delete cascade,
  -- profile_edit: the organiser changed their profile. suspended: an admin took them down.
  kind text not null check (kind in ('profile_edit', 'suspended')),
  -- The organiser's owner for a profile edit, the admin for a takedown.
  actor_id uuid references auth.users (id) on delete set null,
  -- {"<column>": {"old": <text or null>, "new": <text or null>}, ...}: only
  -- the columns that changed (for a takedown, "status").
  changed_fields jsonb not null check (jsonb_typeof(changed_fields) = 'object' and changed_fields <> '{}'::jsonb),
  reason text check (char_length(reason) between 1 and 500),
  edited_at timestamptz not null default now(),
  constraint organiser_profile_edits_reason check ((kind = 'suspended') = (reason is not null))
);

create index organiser_profile_edits_organiser_idx on private.organiser_profile_edits (organiser_id, id desc);

alter table private.organiser_profile_edits enable row level security;
revoke all on private.organiser_profile_edits from public, anon, authenticated;

-- Append-only: an entry can't be rewritten. The one update allowed is the
-- foreign key's own `on delete set null` of actor_id when that account is
-- deleted. Deletes are allowed only so the log goes with its organiser.
create function private.organiser_profile_edits_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.actor_id is null
     and old.actor_id is not null
     and (new.id, new.organiser_id, new.kind, new.changed_fields, new.edited_at)
         = (old.id, old.organiser_id, old.kind, old.changed_fields, old.edited_at)
     and new.reason is not distinct from old.reason then
    return new;
  end if;
  raise exception 'private.organiser_profile_edits is append-only';
end;
$$;

create trigger organiser_profile_edits_append_only
  before update on private.organiser_profile_edits
  for each row execute function private.organiser_profile_edits_append_only();

-- An approved organiser's profile edit. p_changes holds only the columns
-- being set ("description", "website_url", "instagram_handle",
-- "tiktok_handle", "facebook_page", "x_handle"; JSON null clears one),
-- already validated by the API (the check constraints re-check them). Other
-- keys are ignored. Returns:
--   'updated'      something changed; the change is logged
--   'unchanged'    every value sent equals the stored one: nothing written
--   'not_approved' the caller's organiser isn't approved (any more)
--   'not_found'    the caller has no organiser
create function private.edit_organiser_profile(p_owner_user_id uuid, p_changes jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_old public.organisers;
  v_changed jsonb;
begin
  select * into v_old from public.organisers where owner_user_id = p_owner_user_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_old.status <> 'approved' then
    return 'not_approved';
  end if;

  select coalesce(jsonb_object_agg(c.field, jsonb_build_object('old', c.old_value, 'new', p_changes -> c.field)), '{}'::jsonb)
    into v_changed
    from (values ('description', v_old.description),
                 ('website_url', v_old.website_url),
                 ('instagram_handle', v_old.instagram_handle),
                 ('tiktok_handle', v_old.tiktok_handle),
                 ('facebook_page', v_old.facebook_page),
                 ('x_handle', v_old.x_handle)) as c (field, old_value)
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
    x_handle = case when v_changed ? 'x_handle' then p_changes ->> 'x_handle' else x_handle end
  where id = v_old.id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
  values (v_old.id, 'profile_edit', p_owner_user_id, v_changed);

  return 'updated';
end;
$$;

-- Takes an approved organiser down (see the header). Only from 'approved', so
-- two admins acting at once can't both succeed. result:
--   'suspended'    done; events_unpublished / submissions_rejected say how many events moved
--   'not_approved' the organiser isn't approved (pending, rejected, or already taken down)
--   'not_found'    no such organiser
create function private.suspend_organiser(p_organiser_id uuid, p_admin_id uuid, p_reason text)
returns table (result text, events_unpublished integer, submissions_rejected integer)
language plpgsql
set search_path = ''
as $$
declare
  v_status public.organiser_status;
  v_event record;
  v_unpublished integer := 0;
  v_rejected integer := 0;
begin
  select o.status into v_status from public.organisers o where o.id = p_organiser_id for update;
  if not found then
    return query select 'not_found'::text, 0, 0;
    return;
  end if;
  if v_status <> 'approved' then
    return query select 'not_approved'::text, 0, 0;
    return;
  end if;

  update public.organisers
     set status = 'rejected', rejection_reason = p_reason, reviewed_by = p_admin_id, reviewed_at = now()
   where id = p_organiser_id;

  for v_event in
    select e.id, e.status from public.events e
     where e.organiser_id = p_organiser_id and e.status in ('published', 'pending_review')
     order by e.id
       for update
  loop
    if v_event.status = 'published' then
      perform private.transition_event(v_event.id, array['published']::public.event_status[], 'draft',
                                       'unpublished', p_admin_id, p_reason);
      v_unpublished := v_unpublished + 1;
    else
      perform private.transition_event(v_event.id, array['pending_review']::public.event_status[], 'rejected',
                                       'rejected', p_admin_id, p_reason);
      v_rejected := v_rejected + 1;
    end if;
  end loop;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields, reason)
  values (p_organiser_id, 'suspended', p_admin_id,
          jsonb_build_object('status', jsonb_build_object('old', 'approved', 'new', 'rejected')), p_reason);

  return query select 'suspended'::text, v_unpublished, v_rejected;
end;
$$;

revoke all on function private.organiser_profile_edits_append_only() from public, anon, authenticated;
revoke all on function private.edit_organiser_profile(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.suspend_organiser(uuid, uuid, text) from public, anon, authenticated;


-- ===== 20261020000000_payment_refunds.sql =====
-- Refunds made outside the app (QR check-in plan, step B0).
--
-- Until now Stripe's `charge.refunded` was ignored: a payment refunded in the
-- Stripe dashboard left its order `paid`, its tickets valid and its inventory
-- taken. Now the webhook (lib/server/handlers/orders.ts) passes every
-- `charge.refunded` to private.record_payment_refund:
--
--   * Full refund of a `paid` order: the order becomes `refunded`, the amount
--     is recorded, and its inventory is released (each line item's quantity
--     comes off its ticket type's quantity_sold, the exact reverse of
--     fulfil_order). The ticket rows are kept (history, and the tickets FK
--     that stops a sold ticket type being deleted), but a refunded order's
--     tickets are void: the API no longer returns their codes and the ticket
--     email refuses an order that isn't paid.
--   * Partial refund of a `paid` order: only orders.amount_refunded_cents is
--     recorded. The order stays `paid` and its tickets stay valid; the API
--     logs it for manual follow-up.
--   * Anything else (pending, failed, the automatic oversold refund path,
--     already refunded) is left alone: 'unchanged'. Oversold orders keep
--     their own path (refund.updated / refund.failed by refund id).
--
-- Idempotent: Stripe redelivers webhooks, and charge.refunded carries the
-- charge's cumulative amount_refunded, so a delivery that doesn't increase
-- the recorded amount (or finds the order already refunded) changes nothing.
--
-- Locks: the order row first (for update), then its ticket types in
-- ticketTypeId order, the same order as fulfil_order, so a refund and a
-- fulfilment of another order for the same event can't deadlock. Two
-- deliveries of one refund serialise on the order row; the second sees
-- `refunded` and changes nothing, so inventory is released exactly once.
--
-- Index: orders_stripe_payment_intent_idx, partial (only orders that reached
-- Stripe payment have a payment intent; free and pending ones don't), serves
-- the webhook's only lookup, by payment intent. Not unique, deliberately:
-- the column has never been constrained, and a violation would make the
-- payment webhook fail. A Checkout Session (one per order) has one payment
-- intent, so a match is one order in practice; if there were ever two, the
-- function acts on the lowest order id, deterministically.
--
-- Access model as everywhere else: caller's rights (not security definer),
-- search_path pinned, execute revoked from PUBLIC, anon and authenticated.
--
-- Reversible, not destructive: drop function private.record_payment_refund,
-- drop index public.orders_stripe_payment_intent_idx, and drop column
-- public.orders.amount_refunded_cents (that discards the recorded refund
-- amounts; the Stripe dashboard still has them). Orders already marked
-- `refunded` by this function stay refunded. Adding the column with a
-- constant default doesn't rewrite the table.

alter table public.orders
  add column amount_refunded_cents integer not null default 0
    constraint orders_amount_refunded_cents_check check (amount_refunded_cents >= 0);

create index orders_stripe_payment_intent_idx on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- p_amount_refunded_cents is the charge's cumulative amount_refunded, and
-- p_fully_refunded its `refunded` flag (Stripe sets it once the whole amount
-- has been refunded). Returns the result and, when an order was found, its
-- id (for the API to log by short reference). result:
--   'refunded'   a paid order fully refunded: now `refunded`, inventory released
--   'partial'    a paid order partly refunded: amount recorded, still `paid`
--   'unchanged'  found, but nothing to do (not paid, or a redelivery)
--   'not_found'  no order has this payment intent
create function private.record_payment_refund(
  p_payment_intent_id text, p_amount_refunded_cents integer, p_fully_refunded boolean,
  out result text, out order_id text
)
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders;
  v_line jsonb;
begin
  if p_amount_refunded_cents is null or p_amount_refunded_cents < 0 or p_fully_refunded is null then
    raise exception 'invalid refund amount or flag' using errcode = '22023';
  end if;

  select * into v_order from public.orders o
   where o.stripe_payment_intent_id = p_payment_intent_id
   order by o.id
   limit 1
   for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  order_id := v_order.id;

  -- Only a paid order is ours to change here. pending/failed never took
  -- inventory; oversold_refund_required and refunded belong to the
  -- automatic refund path, or this refund has already been recorded.
  if v_order.status <> 'paid' then
    result := 'unchanged';
    return;
  end if;

  if p_fully_refunded then
    -- The reverse of fulfil_order's reservation, in the same lock order.
    for v_line in
      select value from jsonb_array_elements(v_order.line_items) order by value ->> 'ticketTypeId'
    loop
      update public.ticket_types
         set quantity_sold = greatest(quantity_sold - (v_line ->> 'quantity')::integer, 0)
       where event_id = v_order.event_id
         and id = v_line ->> 'ticketTypeId';
    end loop;

    update public.orders
       set status = 'refunded',
           amount_refunded_cents = greatest(amount_refunded_cents, p_amount_refunded_cents)
     where id = v_order.id;
    result := 'refunded';
    return;
  end if;

  -- Partial: amount_refunded only grows, so an older or repeated delivery
  -- (same or smaller amount) changes nothing.
  if p_amount_refunded_cents <= v_order.amount_refunded_cents then
    result := 'unchanged';
    return;
  end if;
  update public.orders set amount_refunded_cents = p_amount_refunded_cents where id = v_order.id;
  result := 'partial';
end;
$$;

revoke all on function private.record_payment_refund(text, integer, boolean) from public, anon, authenticated;


-- ===== 20261021000000_ticket_check_in.sql =====
-- Ticket check-in at the door (QR check-in plan, step B1; docs/REMEDIATION_PLAN.md, Fix 3).
--
-- An organiser scans (or types) a ticket code for one of their events. The
-- API (lib/server/handlers/check-ins.ts) calls private.check_in_ticket, which
-- in one transaction decides the outcome, marks the ticket checked in when it
-- admits it, and appends one row to public.ticket_check_ins:
--
--   admitted            a ticket of this event, its order `paid`, not yet in:
--                       tickets.checked_in_at is set now
--   already_checked_in  it's in already (the first check-in time is returned)
--   not_admissible      its order isn't `paid` (refunded in Stripe, for
--                       example): the ticket is void
--   other_event         a ticket for another event of the same organiser
--   invalid             malformed, unknown, or another organiser's ticket.
--                       The last two look exactly the same, so check-in can't
--                       be used to learn about anyone else's tickets, and the
--                       scanned text is never stored (ticket_code is null)
--   undone              an admission reversed with a reason (undo_check_in)
--
-- Re-entry is refused: a ticket admits once, until an undo.
--
-- Idempotent on the client's request id: a retry after a lost response
-- (same event, same request id) gets the original result back, unchanged and
-- without a second log row, so a retried scan that admitted someone says
-- "admitted", not "already checked in".
--
-- Rate limit: private.take_rate_limit, per acting account, bucket 'check_in',
-- shared by check-ins and undos (the API passes 600 per 5 minutes). Refused
-- calls write no log row. Taken before the request-id replay, so retries count.
--
-- Locks, in this order: the event (for key share: it can't be deleted while a
-- log row is written for it), the caller's rate-limit row (take_rate_limit's
-- upsert), an advisory lock on (event, request id), then the ticket's order
-- (for share) and finally the ticket (for update). fulfil_order and
-- record_payment_refund lock the order first too (for update) and never lock
-- a ticket row, so neither can deadlock with a check-in: a refund committed
-- first makes the check-in see `refunded` (not_admissible); a check-in
-- committed first makes the refund wait for it, and the refund then voids the
-- ticket for any later scan. Two scans of one ticket serialise on the ticket
-- row: exactly one is admitted.
--
-- Privacy: the log holds the event, the ticket code (null for invalid
-- scans), the acting account, the result, an undo reason and the time. No
-- buyer data. The functions return the ticket type, "ticket n of N" in the
-- same order as the ticket email (ticket type id, then code), the code's last
-- four characters and check-in time: never the buyer's email or name, or the
-- order id. Retention: private.purge_analytics (redefined below, same
-- result columns so an existing Supabase Cron job keeps working) deletes the
-- log and clears tickets.checked_in_at 25 months after the event ends.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated (table and identity sequence), every function caller's
-- rights with search_path pinned and execute revoked from PUBLIC.
--
-- Indexes:
--   * tickets (event_id, ticket_type_id): the check-in summary and the
--     analytics attendance count tickets per event and ticket type (until now
--     tickets were only indexed by order), and it serves the tickets ->
--     ticket_types foreign key when replace_ticket_types deletes a dropped
--     ticket type (previously a sequential scan of every ticket). Built
--     without CONCURRENTLY: the migration runs in a transaction, and before
--     launch the table is small.
--   * ticket_check_ins unique (event_id, request_id): the replay lookup, the
--     idempotency guarantee itself, and the events foreign key's cascade.
--   * ticket_check_ins (event_id, id desc): the summary's newest 20 entries.
--   * ticket_check_ins (ticket_code) where not null: undo's "latest admission
--     of this ticket" lookup and the tickets foreign key's cascade.
--   No index on actor_user_id: nothing queries by it, and its set-null only
--   runs when an account is deleted, which an organiser's owner can't be
--   (organisers.owner_user_id is on delete restrict).
--
-- Reversible. Adding a nullable column and a table changes no existing row.
-- To revert: restore private.purge_analytics from
-- 20261015000000_analytics_hardening.sql; drop functions
-- private.undo_check_in and private.check_in_ticket; drop table
-- public.ticket_check_ins; drop index public.tickets_event_type_idx; drop
-- column public.tickets.checked_in_at. Reverting after go-live discards the
-- check-in records (destructive for that data only).

alter table public.tickets add column checked_in_at timestamptz;

create index tickets_event_type_idx on public.tickets (event_id, ticket_type_id);

create table public.ticket_check_ins (
  id bigint generated always as identity primary key,
  -- The event being checked in to (the scanner's event, not necessarily the ticket's).
  event_id uuid not null references public.events (id) on delete cascade,
  -- Null exactly for invalid scans: unknown or someone else's codes are never stored.
  ticket_code text references public.tickets (code) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  -- The client's idempotency key (one per scan); undo rows get a fresh one.
  request_id uuid not null,
  result text not null check (result in ('admitted', 'already_checked_in', 'invalid', 'not_admissible', 'other_event', 'undone')),
  reason text check (char_length(reason) between 3 and 200),
  created_at timestamptz not null default now(),
  constraint ticket_check_ins_request_unique unique (event_id, request_id),
  constraint ticket_check_ins_invalid_has_no_code check ((result = 'invalid') = (ticket_code is null)),
  constraint ticket_check_ins_reason_only_for_undo check ((result = 'undone') = (reason is not null))
);

create index ticket_check_ins_event_idx on public.ticket_check_ins (event_id, id desc);
create index ticket_check_ins_code_idx on public.ticket_check_ins (ticket_code) where ticket_code is not null;

alter table public.ticket_check_ins enable row level security;
revoke all on public.ticket_check_ins from public, anon, authenticated;
revoke all on sequence public.ticket_check_ins_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Check in
-- ---------------------------------------------------------------------------

-- p_code: the canonical code (lib/ticket-code.ts), or null for a scan that
-- isn't one (logged as invalid). p_limit / p_window: the caller's allowance.
-- result 'not_found' (not the organiser's event) and 'rate_limited' write
-- nothing; every other result writes exactly one log row (check_in_id).
-- ticket_* / code_last4 describe the ticket for every result but invalid;
-- first_checked_in_at is the admission time for admitted and
-- already_checked_in; other_event_title is set for other_event only.
create function private.check_in_ticket(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_code text, p_request_id uuid,
  p_limit integer, p_window interval,
  out result text, out check_in_id bigint, out ticket_type_name text, out ticket_number integer,
  out ticket_count integer, out code_last4 text, out first_checked_in_at timestamptz, out other_event_title text
)
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
  v_order_id text;
  v_ticket_event uuid;
  v_ticket_organiser uuid;
  v_status public.order_status;
  v_checked_in_at timestamptz;
  v_log record;
begin
  if p_event_id is null or p_organiser_id is null or p_actor_id is null or p_request_id is null then
    raise exception 'missing argument' using errcode = '22023';
  end if;

  -- 1. The organiser's own event.
  perform 1 from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id for key share;
  if not found then
    result := 'not_found';
    return;
  end if;

  -- 2. The caller's allowance. Over it: nothing logged.
  if not private.take_rate_limit(p_actor_id, 'check_in', p_limit, p_window) then
    result := 'rate_limited';
    return;
  end if;

  -- 3. A retried request gets its original result back.
  perform pg_advisory_xact_lock(hashtextextended('ticket_check_in:' || p_event_id::text || ':' || p_request_id::text, 0));
  select c.id, c.result, c.ticket_code, c.created_at into v_log
    from public.ticket_check_ins c
   where c.event_id = p_event_id and c.request_id = p_request_id;

  if found then
    result := v_log.result;
    check_in_id := v_log.id;
    v_code := v_log.ticket_code;
    if v_log.result = 'admitted' then
      first_checked_in_at := v_log.created_at;
    elsif v_log.result = 'already_checked_in' then
      -- The admission that request saw: the latest one logged before it.
      select max(c.created_at) into first_checked_in_at
        from public.ticket_check_ins c
       where c.ticket_code = v_log.ticket_code and c.result = 'admitted' and c.id < v_log.id;
    end if;
  else
    -- 4. Only a well-formed code of one of this organiser's tickets goes any
    --    further. Unknown and someone else's are the same 'invalid'.
    if p_code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' then
      select t.code, t.order_id, t.event_id, e.organiser_id
        into v_code, v_order_id, v_ticket_event, v_ticket_organiser
        from public.tickets t
        join public.events e on e.id = t.event_id
       where t.code = p_code;
      if v_ticket_organiser is distinct from p_organiser_id then
        v_code := null;
      end if;
    end if;

    if v_code is null then
      result := 'invalid';
    elsif v_ticket_event <> p_event_id then
      -- 5. The same organiser's ticket for another of their events.
      result := 'other_event';
    else
      -- 6. Order, then ticket (see the header).
      select o.status into v_status from public.orders o where o.id = v_order_id for share;
      select t.checked_in_at into v_checked_in_at from public.tickets t where t.code = v_code for update;

      if v_status is distinct from 'paid' then
        -- 7. Refunded (or otherwise not paid): void.
        result := 'not_admissible';
      elsif v_checked_in_at is not null then
        -- 8. No re-entry.
        result := 'already_checked_in';
        first_checked_in_at := v_checked_in_at;
      else
        -- 9. In.
        update public.tickets set checked_in_at = now() where code = v_code;
        result := 'admitted';
        first_checked_in_at := now();
      end if;
    end if;

    insert into public.ticket_check_ins (event_id, ticket_code, actor_user_id, request_id, result)
    values (p_event_id, v_code, p_actor_id, p_request_id, result)
    returning id into check_in_id;
  end if;

  if v_code is null then
    return;
  end if;

  -- What the door sees about the ticket: its type, its place in the order
  -- (the ticket email's order), and the code's last four characters.
  select x.ticket_type_name, x.n, x.total, right(x.code, 4)
    into ticket_type_name, ticket_number, ticket_count, code_last4
    from (select t.code, t.ticket_type_name,
                 (row_number() over (order by t.ticket_type_id, t.code))::integer as n,
                 (count(*) over ())::integer as total
            from public.tickets t
           where t.order_id = (select t2.order_id from public.tickets t2 where t2.code = v_code)) x
   where x.code = v_code;

  if result = 'other_event' then
    select e.title into other_event_title
      from public.tickets t join public.events e on e.id = t.event_id
     where t.code = v_code;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Undo
-- ---------------------------------------------------------------------------

-- Reverses an admission (p_check_in_id: an 'admitted' log row of this event)
-- with a reason (3-200 characters; anything else is an error, which the API
-- validates first). Locks as check_in_ticket. result:
--   'undone'          the ticket is no longer checked in; an 'undone' row is
--                     logged (check_in_id) with the reason
--   'not_found'       not the organiser's event, or no such admission in it
--   'not_checked_in'  the ticket isn't checked in now (already undone)
--   'superseded'      the ticket was undone and admitted again since; undo
--                     the newer admission instead
--   'rate_limited'    over the caller's allowance (shared with check-ins)
-- Only 'undone' writes a log row.
create function private.undo_check_in(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_check_in_id bigint, p_reason text,
  p_limit integer, p_window interval,
  out result text, out check_in_id bigint, out ticket_type_name text, out code_last4 text
)
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
  v_order_id text;
  v_checked_in_at timestamptz;
begin
  if p_event_id is null or p_organiser_id is null or p_actor_id is null or p_check_in_id is null then
    raise exception 'missing argument' using errcode = '22023';
  end if;
  if p_reason is null or char_length(p_reason) not between 3 and 200 then
    raise exception 'a reason of 3 to 200 characters is required' using errcode = '22023';
  end if;

  perform 1 from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id for key share;
  if not found then
    result := 'not_found';
    return;
  end if;

  if not private.take_rate_limit(p_actor_id, 'check_in', p_limit, p_window) then
    result := 'rate_limited';
    return;
  end if;

  select c.ticket_code into v_code
    from public.ticket_check_ins c
   where c.id = p_check_in_id and c.event_id = p_event_id and c.result = 'admitted';
  if not found then
    result := 'not_found';
    return;
  end if;

  select t.order_id, t.ticket_type_name, right(t.code, 4) into v_order_id, ticket_type_name, code_last4
    from public.tickets t where t.code = v_code;

  perform 1 from public.orders o where o.id = v_order_id for share;
  select t.checked_in_at into v_checked_in_at from public.tickets t where t.code = v_code for update;

  if v_checked_in_at is null then
    result := 'not_checked_in';
    return;
  end if;
  if exists (select 1 from public.ticket_check_ins c
              where c.ticket_code = v_code and c.result = 'admitted' and c.id > p_check_in_id) then
    result := 'superseded';
    return;
  end if;

  update public.tickets set checked_in_at = null where code = v_code;
  insert into public.ticket_check_ins (event_id, ticket_code, actor_user_id, request_id, result, reason)
  values (p_event_id, v_code, p_actor_id, gen_random_uuid(), 'undone', p_reason)
  returning id into check_in_id;
  result := 'undone';
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention: as in 20261015000000_analytics_hardening.sql, plus the check-in
-- log and check-in times, 25 months after the event ends. The result columns
-- are unchanged, so an existing Supabase Cron job keeps working.
-- ---------------------------------------------------------------------------

create or replace function private.purge_analytics(out event_view_counts_deleted integer, out event_rate_limits_deleted integer)
language plpgsql
set search_path = ''
as $$
begin
  delete from public.event_view_counts
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;
  get diagnostics event_view_counts_deleted = row_count;

  delete from private.event_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics event_rate_limits_deleted = row_count;

  delete from private.event_view_cap_days
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;

  delete from public.ticket_check_ins c
   using public.events e
   where e.id = c.event_id and e.ends_at < now() - interval '25 months';

  update public.tickets t
     set checked_in_at = null
    from public.events e
   where e.id = t.event_id and e.ends_at < now() - interval '25 months' and t.checked_in_at is not null;
end;
$$;

revoke all on function private.check_in_ticket(uuid, uuid, uuid, text, uuid, integer, interval) from public, anon, authenticated;
revoke all on function private.undo_check_in(uuid, uuid, uuid, bigint, text, integer, interval) from public, anon, authenticated;
revoke all on function private.purge_analytics() from public, anon, authenticated;


-- ===== 20261021120000_listing_fixes.sql =====
-- Listing fixes (docs/FEATURE_PLAN.md, B1).
--
-- 1. events.is_free means "has ticket types, and every one is free". It was
--    `not exists (a paid ticket type)`, which is also true for an event with
--    no ticket types at all, so such an event showed up under the public
--    feed's pricing=free filter. The API doesn't accept an event without a
--    ticket type today, but external ticketing (B2) will, so the rule is
--    fixed in the one function that maintains the column. pricing=paid now
--    checks for a paid ticket type (lib/server/handlers/public-events.ts), so
--    an event with no ticket types is neither free nor paid.
--
-- 2. GET /api/events?upcoming=1 (used by the home page and /events) filters
--    on ends_at > now(). The only events index orders by starts_at, so that
--    scan would step over every past published event before reaching the
--    upcoming ones, a cost that grows with history. (status, ends_at) lets
--    the planner range-scan just the events that haven't ended and sort that
--    small set instead.
--
-- Reversible: re-create replace_ticket_types from 20260925000000_init.sql
-- and drop events_status_ends_idx. The is_free backfill below only touches
-- events with no ticket types, which the API can't create, so it's expected
-- to change no rows; reverting it isn't meaningful (the old value was wrong).
-- Nothing is dropped or deleted.

create or replace function private.replace_ticket_types(p_event_id uuid, p_ticket_types jsonb) returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.ticket_types t
  where t.event_id = p_event_id
    and not exists (select 1 from jsonb_array_elements(p_ticket_types) e where e ->> 'id' = t.id);

  insert into public.ticket_types
    (event_id, id, position, name, description, price_cents, fee_policy, quantity_available)
  select p_event_id,
         x.e ->> 'id',
         x.ord::integer - 1,
         x.e ->> 'name',
         nullif(x.e ->> 'description', ''),
         (x.e ->> 'priceCents')::integer,
         (x.e ->> 'feePolicy')::public.fee_policy,
         (x.e ->> 'quantityAvailable')::integer
  from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)
  on conflict (event_id, id) do update set
    position = excluded.position,
    name = excluded.name,
    description = excluded.description,
    price_cents = excluded.price_cents,
    fee_policy = excluded.fee_policy,
    quantity_available = excluded.quantity_available;

  -- Free only with at least one ticket type and none of them paid.
  update public.events
  set is_free = exists (select 1 from public.ticket_types where event_id = p_event_id)
            and not exists (select 1 from public.ticket_types where event_id = p_event_id and price_cents > 0)
  where id = p_event_id;
end;
$$;

revoke all on function private.replace_ticket_types(uuid, jsonb) from public, anon, authenticated;

update public.events e
   set is_free = false
 where e.is_free
   and not exists (select 1 from public.ticket_types t where t.event_id = e.id);

create index events_status_ends_idx on public.events (status, ends_at);


-- ===== 20261021130000_check_in_followups.sql =====
-- Check-in follow-ups (code and security review of 20261021000000_ticket_check_in.sql).
--
-- 1. A per-row public id for the check-in log. The log's primary key is a
--    global identity, so the ids an organiser saw (an admission's
--    checkInId, the summary's log entries) revealed how many check-ins the
--    whole platform had logged between two scans. public.ticket_check_ins
--    gains `public_id uuid` (random, unique), and the API only ever shows
--    that: as an admission's checkInId, in the summary's log, and as the
--    undo route's id. The bigint id stays the internal key and the log's
--    order. An old numeric id is no longer accepted by the API (404 without
--    a query); the functions below take the uuid.
--
-- 2. Undo from the refusal panel. check_in_ticket now also returns
--    admission_id: for `admitted`, the new row's public id; for
--    `already_checked_in`, the public id of the ticket's current admission
--    (the latest `admitted` row for the ticket, while checked_in_at is set),
--    so the door can offer "Undo check-in" right there instead of only from
--    the newest 20 log rows. On a replay of an already_checked_in request,
--    it's the admission that request saw, and only while that is still the
--    ticket's current admission (otherwise null: the time the panel shows
--    and the admission undo would reverse must be the same one).
--    check_in_id is now the log row's public id.
--
-- 3. A replayed request id whose code isn't the logged one is a conflict.
--    A retry carries the same code, so a request id reused with a different
--    code is a client bug (or tampering), and replaying the original answer
--    would describe another ticket. The submitted code is resolved exactly
--    as for a new scan (the organiser's own ticket, or nothing) and compared
--    with the logged code: different is result 'conflict' (the API's 409),
--    with nothing logged. An `invalid` row has no code, so any submission
--    that also resolves to nothing replays it (the answer is the same).
--    The resolution is a plain read, before the replay lookup, under the
--    same advisory lock; lock order is otherwise unchanged.
--
-- Both functions change their result columns or argument types, so they're
-- dropped and recreated (create or replace can't change either). Same
-- access model: caller's rights, search_path pinned, execute revoked from
-- PUBLIC, anon and authenticated.
--
-- Index: ticket_check_ins_public_id_key (the unique constraint) serves
-- undo's lookup by public id (then filtered by event and result). The
-- admission lookups by ticket use the existing ticket_check_ins_code_idx.
--
-- Reversible. Adding the column backfills a random uuid for every existing
-- row (a table rewrite: the log is small before launch) and changes no
-- other data. To revert: drop functions private.check_in_ticket(uuid, uuid,
-- uuid, text, uuid, integer, interval) and private.undo_check_in(uuid, uuid,
-- uuid, uuid, text, integer, interval), recreate both (and their revokes)
-- from 20261021000000_ticket_check_in.sql, then drop column
-- public.ticket_check_ins.public_id. The application code must be reverted
-- with it (it reads public_id and passes uuids to undo).

alter table public.ticket_check_ins add column public_id uuid not null default gen_random_uuid();
alter table public.ticket_check_ins add constraint ticket_check_ins_public_id_key unique (public_id);

-- ---------------------------------------------------------------------------
-- Check in
-- ---------------------------------------------------------------------------

drop function private.check_in_ticket(uuid, uuid, uuid, text, uuid, integer, interval);

-- As in 20261021000000_ticket_check_in.sql, plus: result 'conflict' (a
-- replayed request id with another code; nothing logged), check_in_id is the
-- log row's public id, and admission_id is the admission an undo would
-- reverse (admitted: this row; already_checked_in: the ticket's current
-- admission; otherwise null).
create function private.check_in_ticket(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_code text, p_request_id uuid,
  p_limit integer, p_window interval,
  out result text, out check_in_id uuid, out admission_id uuid, out ticket_type_name text, out ticket_number integer,
  out ticket_count integer, out code_last4 text, out first_checked_in_at timestamptz, out other_event_title text
)
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
  v_order_id text;
  v_ticket_event uuid;
  v_ticket_organiser uuid;
  v_status public.order_status;
  v_checked_in_at timestamptz;
  v_log record;
  v_seen record;
begin
  if p_event_id is null or p_organiser_id is null or p_actor_id is null or p_request_id is null then
    raise exception 'missing argument' using errcode = '22023';
  end if;

  -- 1. The organiser's own event.
  perform 1 from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id for key share;
  if not found then
    result := 'not_found';
    return;
  end if;

  -- 2. The caller's allowance. Over it: nothing logged.
  if not private.take_rate_limit(p_actor_id, 'check_in', p_limit, p_window) then
    result := 'rate_limited';
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ticket_check_in:' || p_event_id::text || ':' || p_request_id::text, 0));

  -- 3. Only a well-formed code of one of this organiser's tickets goes any
  --    further. Unknown and someone else's are the same: no code.
  if p_code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' then
    select t.code, t.order_id, t.event_id, e.organiser_id
      into v_code, v_order_id, v_ticket_event, v_ticket_organiser
      from public.tickets t
      join public.events e on e.id = t.event_id
     where t.code = p_code;
    if v_ticket_organiser is distinct from p_organiser_id then
      v_code := null;
      v_order_id := null;
      v_ticket_event := null;
    end if;
  end if;

  -- 4. A retried request gets its original result back, if it's for the same code.
  select c.id, c.public_id, c.result, c.ticket_code, c.created_at into v_log
    from public.ticket_check_ins c
   where c.event_id = p_event_id and c.request_id = p_request_id;

  if found then
    if v_log.ticket_code is distinct from v_code then
      result := 'conflict';
      return;
    end if;
    result := v_log.result;
    check_in_id := v_log.public_id;
    if v_log.result = 'admitted' then
      first_checked_in_at := v_log.created_at;
      admission_id := v_log.public_id;
    elsif v_log.result = 'already_checked_in' then
      -- The admission that request saw: the latest one logged before it.
      select c.id, c.public_id, c.created_at into v_seen
        from public.ticket_check_ins c
       where c.ticket_code = v_log.ticket_code and c.result = 'admitted' and c.id < v_log.id
       order by c.id desc
       limit 1;
      if found then
        first_checked_in_at := v_seen.created_at;
        -- Undoable only while it's still the ticket's current admission.
        if exists (select 1 from public.tickets t where t.code = v_log.ticket_code and t.checked_in_at is not null)
           and not exists (select 1 from public.ticket_check_ins c
                            where c.ticket_code = v_log.ticket_code and c.result = 'admitted' and c.id > v_seen.id) then
          admission_id := v_seen.public_id;
        end if;
      end if;
    end if;
  else
    if v_code is null then
      result := 'invalid';
    elsif v_ticket_event <> p_event_id then
      -- 5. The same organiser's ticket for another of their events.
      result := 'other_event';
    else
      -- 6. Order, then ticket (see 20261021000000_ticket_check_in.sql).
      select o.status into v_status from public.orders o where o.id = v_order_id for share;
      select t.checked_in_at into v_checked_in_at from public.tickets t where t.code = v_code for update;

      if v_status is distinct from 'paid' then
        -- 7. Refunded (or otherwise not paid): void.
        result := 'not_admissible';
      elsif v_checked_in_at is not null then
        -- 8. No re-entry. The ticket row is locked and checked in, so its
        --    latest admission is the current one.
        result := 'already_checked_in';
        first_checked_in_at := v_checked_in_at;
        select c.public_id into admission_id
          from public.ticket_check_ins c
         where c.ticket_code = v_code and c.result = 'admitted'
         order by c.id desc
         limit 1;
      else
        -- 9. In.
        update public.tickets set checked_in_at = now() where code = v_code;
        result := 'admitted';
        first_checked_in_at := now();
      end if;
    end if;

    insert into public.ticket_check_ins (event_id, ticket_code, actor_user_id, request_id, result)
    values (p_event_id, v_code, p_actor_id, p_request_id, result)
    returning public_id into check_in_id;
    if result = 'admitted' then
      admission_id := check_in_id;
    end if;
  end if;

  if v_code is null then
    return;
  end if;

  -- What the door sees about the ticket: its type, its place in the order
  -- (the ticket email's order), and the code's last four characters.
  select x.ticket_type_name, x.n, x.total, right(x.code, 4)
    into ticket_type_name, ticket_number, ticket_count, code_last4
    from (select t.code, t.ticket_type_name,
                 (row_number() over (order by t.ticket_type_id, t.code))::integer as n,
                 (count(*) over ())::integer as total
            from public.tickets t
           where t.order_id = (select t2.order_id from public.tickets t2 where t2.code = v_code)) x
   where x.code = v_code;

  if result = 'other_event' then
    select e.title into other_event_title
      from public.tickets t join public.events e on e.id = t.event_id
     where t.code = v_code;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Undo
-- ---------------------------------------------------------------------------

drop function private.undo_check_in(uuid, uuid, uuid, bigint, text, integer, interval);

-- As in 20261021000000_ticket_check_in.sql, but p_check_in_id is the
-- admission's public id (an 'admitted' row of this event), and check_in_id
-- (for 'undone') is the undo row's public id.
create function private.undo_check_in(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_check_in_id uuid, p_reason text,
  p_limit integer, p_window interval,
  out result text, out check_in_id uuid, out ticket_type_name text, out code_last4 text
)
language plpgsql
set search_path = ''
as $$
declare
  v_admission_id bigint;
  v_code text;
  v_order_id text;
  v_checked_in_at timestamptz;
begin
  if p_event_id is null or p_organiser_id is null or p_actor_id is null or p_check_in_id is null then
    raise exception 'missing argument' using errcode = '22023';
  end if;
  if p_reason is null or char_length(p_reason) not between 3 and 200 then
    raise exception 'a reason of 3 to 200 characters is required' using errcode = '22023';
  end if;

  perform 1 from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id for key share;
  if not found then
    result := 'not_found';
    return;
  end if;

  if not private.take_rate_limit(p_actor_id, 'check_in', p_limit, p_window) then
    result := 'rate_limited';
    return;
  end if;

  select c.id, c.ticket_code into v_admission_id, v_code
    from public.ticket_check_ins c
   where c.public_id = p_check_in_id and c.event_id = p_event_id and c.result = 'admitted';
  if not found then
    result := 'not_found';
    return;
  end if;

  select t.order_id, t.ticket_type_name, right(t.code, 4) into v_order_id, ticket_type_name, code_last4
    from public.tickets t where t.code = v_code;

  perform 1 from public.orders o where o.id = v_order_id for share;
  select t.checked_in_at into v_checked_in_at from public.tickets t where t.code = v_code for update;

  if v_checked_in_at is null then
    result := 'not_checked_in';
    return;
  end if;
  if exists (select 1 from public.ticket_check_ins c
              where c.ticket_code = v_code and c.result = 'admitted' and c.id > v_admission_id) then
    result := 'superseded';
    return;
  end if;

  update public.tickets set checked_in_at = null where code = v_code;
  insert into public.ticket_check_ins (event_id, ticket_code, actor_user_id, request_id, result, reason)
  values (p_event_id, v_code, p_actor_id, gen_random_uuid(), 'undone', p_reason)
  returning public_id into check_in_id;
  result := 'undone';
end;
$$;

revoke all on function private.check_in_ticket(uuid, uuid, uuid, text, uuid, integer, interval) from public, anon, authenticated;
revoke all on function private.undo_check_in(uuid, uuid, uuid, uuid, text, integer, interval) from public, anon, authenticated;


-- ===== 20261022000000_external_ticketing.sql =====
-- External ticketing (docs/FEATURE_PLAN.md, B2; docs/architecture.md,
-- "External ticketing"): an event whose tickets are sold on another site,
-- which Sheltüh lists and links to.
--
--   * events.ticketing_mode ('sheltuh' | 'external'), external_ticket_url,
--     external_free. An external event has a ticket link and no ticket types,
--     orders, Who's Going or check-in; a Sheltüh-ticketed one has no link.
--     is_free follows external_free for external events (the feed's
--     pricing=free filter), and the ticket-type rule otherwise.
--   * The ticket link's rules are a check constraint as well as the API's
--     (lib/ticketing.ts): https, a plain DNS host (no IP address, port,
--     credentials, localhost or other non-public name, or link shortener),
--     printable ASCII (the URL parser's own form), at most 2048 characters.
--   * Triggers keep external events free of ticket types and orders, so no
--     code path can sell Sheltüh tickets for one.
--   * private.edit_event_draft replaces private.update_event_draft for the
--     organiser's PATCH: same rules, plus the ticketing fields, which are
--     frozen once the event has ever been approved ('ticketing_frozen').
--   * private.admin_set_event_ticketing: an admin's change to an event's
--     ticketing (any status), logged in event_moderation_log as
--     'ticketing_changed' with the old and new values in the new `details`
--     column.
--   * public.event_outbound_clicks + private.record_outbound_click: clicks on
--     an external event's ticket link, counted per event per Melbourne day
--     like page views (no visitor data, a per-event per-minute cap).
--   * private.set_going refuses external events; purge_analytics also
--     deletes outbound clicks after 25 months.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated; every new function pins its search_path and has execute
-- revoked from PUBLIC.
--
-- Additive. Reversible before launch: drop the functions
-- private.record_outbound_click, private.admin_set_event_ticketing,
-- private.edit_event_draft, private.external_ticket_url_ok and the trigger
-- functions; drop table public.event_outbound_clicks (its counts are lost);
-- drop the triggers, the new events constraints and columns (any external
-- event's link is lost, so convert or delete those first) and
-- event_moderation_log.details; restore create_event_draft,
-- replace_ticket_types, set_going and purge_analytics from their previous
-- migrations. The enum value 'ticketing_changed' can't be removed from
-- public.moderation_action without recreating the type (harmless if left).

alter type public.moderation_action add value if not exists 'ticketing_changed';

-- ---------------------------------------------------------------------------
-- The ticket link's rules
-- ---------------------------------------------------------------------------

-- True if p_url is an acceptable stored ticket link. The URL is stored as the
-- browser's URL parser writes it (lib/ticketing.ts, checkExternalTicketUrl):
-- printable ASCII, host lower case and punycode. Mirrors the API's rules;
-- tests/server/external-ticketing.test.ts checks the two agree, shortener
-- and non-public lists included.
create function private.external_ticket_url_ok(p_url text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
     and char_length(p_url) <= 2048
     -- Printable ASCII, no space; no backslash (URL parsers read it as "/").
     and p_url ~ '^[!-~]+$'
     and strpos(p_url, chr(92)) = 0
     -- https://, then a host of DNS labels (so no credentials, port, IPv6
     -- literal or trailing dot), then optionally a path, query or fragment.
     and p_url ~ '^https://[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$'
     and not exists (
       select 1
         from (select substring(p_url from '^https://([^/?#]+)') as host) h
        where h.host ~ '^[0-9.]+$'
           or h.host ~ '(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan|test|invalid|example|onion)$'
           or h.host ~ ('(^|\.)(adf\.ly|bit\.do|bit\.ly|bitly\.com|bl\.ink|buff\.ly|cutt\.ly|dub\.sh|fb\.me|goo\.gl'
                        || '|is\.gd|lnkd\.in|ow\.ly|rb\.gy|rebrand\.ly|s\.id|short\.io|shorturl\.at|t\.co|t\.ly'
                        || '|tiny\.cc|tinyurl\.com|trib\.al|v\.gd)$')
     );
$$;

revoke all on function private.external_ticket_url_ok(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- Constant defaults: metadata-only on Postgres 11+, no table rewrite. Every
-- existing event is Sheltüh-ticketed with no link, so every constraint holds.
alter table public.events
  add column ticketing_mode text not null default 'sheltuh',
  add column external_ticket_url text,
  add column external_free boolean not null default false,
  add constraint events_ticketing_mode_check check (ticketing_mode in ('sheltuh', 'external')),
  -- External: a link. Sheltüh-ticketed: no link and not externally free.
  add constraint events_ticketing_fields check (
    case when ticketing_mode = 'external'
         then external_ticket_url is not null
         else external_ticket_url is null and not external_free end),
  -- The feed's pricing=free filter reads is_free: for an external event it's the organiser's free flag.
  add constraint events_external_is_free check (ticketing_mode <> 'external' or is_free = external_free),
  add constraint events_external_ticket_url_valid check (
    external_ticket_url is null or private.external_ticket_url_ok(external_ticket_url));

-- Context for a log entry, e.g. the old and new ticketing values of a
-- 'ticketing_changed' entry. Null for the other actions. Shown to admins and
-- to the event's organiser (EventRecord.moderationLog[].changes), never
-- publicly.
alter table public.event_moderation_log
  add column details jsonb,
  add constraint event_moderation_log_details_object check (details is null or jsonb_typeof(details) = 'object');

-- ---------------------------------------------------------------------------
-- External events never have ticket types or orders
-- ---------------------------------------------------------------------------

-- A ticket type for an external event is refused. Every insert comes through
-- private.replace_ticket_types, called after its event row was updated (so
-- row-locked) in the same transaction.
create function private.ticket_types_sheltuh_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.events e where e.id = new.event_id and e.ticketing_mode = 'external') then
    raise exception 'An event with external ticketing has no ticket types.'
      using errcode = 'check_violation', constraint = 'ticket_types_sheltuh_only';
  end if;
  return new;
end;
$$;

create trigger ticket_types_sheltuh_only before insert on public.ticket_types
  for each row execute function private.ticket_types_sheltuh_only();

-- An event can't become external while it has ticket types (remove them first).
create function private.events_external_without_ticket_types() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ticketing_mode = 'external' and old.ticketing_mode <> 'external'
     and exists (select 1 from public.ticket_types t where t.event_id = new.id) then
    raise exception 'Remove the ticket types before switching to external ticketing.'
      using errcode = 'check_violation', constraint = 'events_external_no_ticket_types';
  end if;
  return new;
end;
$$;

create trigger events_external_without_ticket_types before update of ticketing_mode on public.events
  for each row execute function private.events_external_without_ticket_types();

-- An order for an external event is refused. The event row is share-locked,
-- so an order racing private.admin_set_event_ticketing (which locks the event
-- row, then refuses if the event has any order) either commits first, and
-- the switch is refused, or waits and then sees the event is external.
create function private.orders_sheltuh_only() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode text;
begin
  select e.ticketing_mode into v_mode from public.events e where e.id = new.event_id for share;
  if v_mode = 'external' then
    raise exception 'Tickets for this event are sold on another site.'
      using errcode = 'check_violation', constraint = 'orders_sheltuh_only';
  end if;
  return new;
end;
$$;

create trigger orders_sheltuh_only before insert on public.orders
  for each row execute function private.orders_sheltuh_only();

-- Triggers don't need the caller to hold execute on their function.
revoke all on function private.ticket_types_sheltuh_only() from public, anon, authenticated;
revoke all on function private.events_external_without_ticket_types() from public, anon, authenticated;
revoke all on function private.orders_sheltuh_only() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- is_free: as in 20261021120000_listing_fixes.sql, except that an external
-- event's is_free is its external_free.
-- ---------------------------------------------------------------------------

create or replace function private.replace_ticket_types(p_event_id uuid, p_ticket_types jsonb) returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.ticket_types t
  where t.event_id = p_event_id
    and not exists (select 1 from jsonb_array_elements(p_ticket_types) e where e ->> 'id' = t.id);

  insert into public.ticket_types
    (event_id, id, position, name, description, price_cents, fee_policy, quantity_available)
  select p_event_id,
         x.e ->> 'id',
         x.ord::integer - 1,
         x.e ->> 'name',
         nullif(x.e ->> 'description', ''),
         (x.e ->> 'priceCents')::integer,
         (x.e ->> 'feePolicy')::public.fee_policy,
         (x.e ->> 'quantityAvailable')::integer
  from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)
  on conflict (event_id, id) do update set
    position = excluded.position,
    name = excluded.name,
    description = excluded.description,
    price_cents = excluded.price_cents,
    fee_policy = excluded.fee_policy,
    quantity_available = excluded.quantity_available;

  -- External: the organiser's free flag. Otherwise free only with at least
  -- one ticket type and none of them paid.
  update public.events e
  set is_free = case when e.ticketing_mode = 'external' then e.external_free
                     else exists (select 1 from public.ticket_types where event_id = p_event_id)
                          and not exists (select 1 from public.ticket_types where event_id = p_event_id and price_cents > 0)
                end
  where e.id = p_event_id;
end;
$$;

revoke all on function private.replace_ticket_types(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Creating and editing drafts
-- ---------------------------------------------------------------------------

-- As in 20260925000000_init.sql, plus the ticketing fields, read from
-- p_fields: ticketingMode (default 'sheltuh'), externalTicketUrl,
-- externalFree (default false). Already validated by
-- lib/server/event-input.ts; the constraints and triggers above hold whatever
-- is sent. Same signature, so a caller that doesn't send them gets a
-- Sheltüh-ticketed event, as before. Now pins its search_path.
create or replace function private.create_event_draft(
  p_organiser_id uuid, p_slug text, p_fields jsonb, p_ticket_types jsonb
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
begin
  insert into public.events
    (organiser_id, slug, title, description, category, venue_name, venue_address, suburb, starts_at, ends_at,
     ticketing_mode, external_ticket_url, external_free, is_free)
  values (
    p_organiser_id,
    p_slug,
    p_fields ->> 'title',
    p_fields ->> 'description',
    (p_fields ->> 'category')::public.event_category,
    p_fields ->> 'venueName',
    p_fields ->> 'venueAddress',
    p_fields ->> 'suburb',
    (p_fields ->> 'startsAt')::timestamptz,
    (p_fields ->> 'endsAt')::timestamptz,
    v_mode,
    p_fields ->> 'externalTicketUrl',
    v_free,
    v_mode = 'external' and v_free
  )
  returning id into v_id;

  perform private.replace_ticket_types(v_id, p_ticket_types);
  return v_id;
end;
$$;

revoke all on function private.create_event_draft(uuid, text, jsonb, jsonb) from public, anon, authenticated;

-- The organiser's edit (PATCH /api/events/{id}). Same rules as
-- private.update_event_draft (still there, unchanged, for the deploy window),
-- plus the ticketing fields. Locks the event row first. Returns:
--   'updated'           saved
--   'not_found'         no such event, or not p_organiser_id's
--   'not_editable'      not draft or rejected
--   'ticketing_frozen'  the event has been approved before (published at some
--                       point) and the edit would change its ticketing mode or
--                       ticket link: only an admin can now
--                       (private.admin_set_event_ticketing)
-- Switching to external removes the ticket types first (a sold one can't be:
-- the tickets foreign key fails, which the API reports as a 409; only an
-- event approved before can have sales, and its ticketing is frozen anyway).
create function private.edit_event_draft(
  p_event_id uuid, p_organiser_id uuid, p_fields jsonb, p_ticket_types jsonb
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_url text := p_fields ->> 'externalTicketUrl';
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
begin
  select e.status, e.ticketing_mode, e.external_ticket_url into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if (v_event.ticketing_mode is distinct from v_mode or v_event.external_ticket_url is distinct from v_url)
     and exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'ticketing_frozen';
  end if;

  if v_mode = 'external' then
    perform private.replace_ticket_types(p_event_id, '[]'::jsonb);
  end if;

  update public.events set
    title = p_fields ->> 'title',
    description = p_fields ->> 'description',
    category = (p_fields ->> 'category')::public.event_category,
    venue_name = p_fields ->> 'venueName',
    venue_address = p_fields ->> 'venueAddress',
    suburb = p_fields ->> 'suburb',
    starts_at = (p_fields ->> 'startsAt')::timestamptz,
    ends_at = (p_fields ->> 'endsAt')::timestamptz,
    ticketing_mode = v_mode,
    external_ticket_url = v_url,
    external_free = v_free,
    is_free = case when v_mode = 'external' then v_free else is_free end
  where id = p_event_id;

  if v_mode <> 'external' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;
  return 'updated';
end;
$$;

revoke all on function private.edit_event_draft(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An admin's change to an event's ticketing
-- ---------------------------------------------------------------------------

-- Sets p_event_id's ticketing, whatever its status, and logs it. Locks the
-- event row first. Returns:
--   'updated'     changed, and a 'ticketing_changed' moderation log entry
--                 written with p_reason and, in `details`, the old and new
--                 value of each field that changed
--   'unchanged'   nothing would change: nothing written
--   'not_found'   no such event
--   'has_orders'  switching to external, but the event has orders (of any
--                 status): its tickets can't be dropped
-- Switching to external deletes the event's ticket types (it has no orders,
-- so none has sales). Switching back to Sheltüh ticketing leaves it with no
-- ticket types: neither free nor paid, and not on sale until the organiser
-- adds some (after an unpublish).
create function private.admin_set_event_ticketing(
  p_event_id uuid, p_admin_id uuid, p_mode text, p_url text, p_free boolean, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_details jsonb := '{}'::jsonb;
begin
  select e.ticketing_mode, e.external_ticket_url, e.external_free into v_event
    from public.events e where e.id = p_event_id
     for no key update;
  if not found then
    return 'not_found';
  end if;

  if v_event.ticketing_mode is distinct from p_mode then
    v_details := v_details || jsonb_build_object('ticketingMode', jsonb_build_object('old', v_event.ticketing_mode, 'new', p_mode));
  end if;
  if v_event.external_ticket_url is distinct from p_url then
    v_details := v_details
      || jsonb_build_object('externalTicketUrl', jsonb_build_object('old', v_event.external_ticket_url, 'new', p_url));
  end if;
  if v_event.external_free is distinct from p_free then
    v_details := v_details || jsonb_build_object('externalFree', jsonb_build_object('old', v_event.external_free, 'new', p_free));
  end if;
  if v_details = '{}'::jsonb then
    return 'unchanged';
  end if;

  if p_mode = 'external' and v_event.ticketing_mode <> 'external' then
    if exists (select 1 from public.orders o where o.event_id = p_event_id) then
      return 'has_orders';
    end if;
    delete from public.ticket_types t where t.event_id = p_event_id;
  end if;

  update public.events e set
    ticketing_mode = p_mode,
    external_ticket_url = p_url,
    external_free = p_free,
    is_free = case when p_mode = 'external' then p_free
                   else exists (select 1 from public.ticket_types t where t.event_id = p_event_id)
                        and not exists (select 1 from public.ticket_types t where t.event_id = p_event_id and t.price_cents > 0)
              end
  where e.id = p_event_id;

  insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
  values (p_event_id, 'ticketing_changed', p_admin_id, p_reason, v_details);
  return 'updated';
end;
$$;

revoke all on function private.admin_set_event_ticketing(uuid, uuid, text, text, boolean, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who's Going: as in 20261002000000_whos_going_hardening.sql, except that an
-- external event has none ('event_unavailable').
-- ---------------------------------------------------------------------------

create or replace function private.set_going(p_event_id uuid, p_user_id uuid, p_email text) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events
   where id = p_event_id and status = 'published' and whos_going_enabled and ends_at > now()
     and ticketing_mode = 'sheltuh'
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
-- Outbound clicks
-- ---------------------------------------------------------------------------

create table public.event_outbound_clicks (
  event_id uuid not null references public.events (id) on delete cascade,
  -- The Australia/Melbourne calendar day the clicks were counted on.
  day date not null,
  clicks integer not null check (clicks >= 0),
  -- The event's per-minute click cap was reached that day: clicks is a lower bound.
  cap_reached boolean not null default false,
  primary key (event_id, day)
);
-- The primary key serves every read (one event's days over a range), the
-- upsert and the events FK cascade. The overview joins through events on
-- organiser_id (events_organiser_created_idx) first. No index on day alone:
-- only the daily purge filters on it without an event.

alter table public.event_outbound_clicks enable row level security;
revoke all on public.event_outbound_clicks from anon, authenticated;

-- Counts one click on p_event_id's ticket link. Returns:
--   'recorded'     counted
--   'not_found'    no such event, it isn't published, or it isn't external
--   'rate_limited' over p_limit clicks per p_window for this event: not
--                  counted, and the day marked cap_reached (once: after that
--                  the conflict update's condition is false, so no write)
-- Like private.record_view: no row lock on the event and no exception block,
-- to keep the hot path to two small upserts.
create function private.record_outbound_click(p_event_id uuid, p_limit integer, p_window interval)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Australia/Melbourne')::date;
begin
  perform 1 from public.events e
   where e.id = p_event_id and e.status = 'published' and e.ticketing_mode = 'external';
  if not found then
    return 'not_found';
  end if;

  if not private.take_event_rate_limit(p_event_id, 'outbound', p_limit, p_window) then
    insert into public.event_outbound_clicks as c (event_id, day, clicks, cap_reached)
    values (p_event_id, v_day, 0, true)
    on conflict (event_id, day) do update set cap_reached = true where not c.cap_reached;
    return 'rate_limited';
  end if;

  insert into public.event_outbound_clicks as c (event_id, day, clicks)
  values (p_event_id, v_day, 1)
  on conflict (event_id, day) do update set clicks = c.clicks + 1;
  return 'recorded';
end;
$$;

revoke all on function private.record_outbound_click(uuid, integer, interval) from public, anon, authenticated;

-- Retention: as in 20261021000000_ticket_check_in.sql, plus outbound clicks
-- on the view counts' 25-month horizon. The result columns are unchanged, so
-- an existing Supabase Cron job keeps working.
create or replace function private.purge_analytics(out event_view_counts_deleted integer, out event_rate_limits_deleted integer)
language plpgsql
set search_path = ''
as $$
begin
  delete from public.event_view_counts
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;
  get diagnostics event_view_counts_deleted = row_count;

  delete from private.event_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics event_rate_limits_deleted = row_count;

  delete from private.event_view_cap_days
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;

  delete from public.event_outbound_clicks
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '25 months')::date;

  delete from public.ticket_check_ins c
   using public.events e
   where e.id = c.event_id and e.ends_at < now() - interval '25 months';

  update public.tickets t
     set checked_in_at = null
    from public.events e
   where e.id = t.event_id and e.ends_at < now() - interval '25 months' and t.checked_in_at is not null;
end;
$$;

revoke all on function private.purge_analytics() from public, anon, authenticated;


-- ===== 20261022000100_admin_event_authoring.sql =====
-- Admin event authoring (docs/FEATURE_PLAN.md, B3; docs/architecture.md,
-- "Admin authoring"): admins create platform-managed organisers (no owner
-- account) and create or edit events for any organiser.
--
--   * public.moderation_action gains 'created' (an admin created the event),
--     'edited' (an admin changed it; `details` holds the old and new value of
--     each changed field, like 'ticketing_changed') and 'curated' (reserved
--     for B4's curation; nothing writes it yet).
--   * Platform-managed organisers (owner_user_id null) sell no paid Sheltüh
--     tickets and have no check-in, enforced here whatever the code does:
--       - organisers_platform_no_payouts: no Stripe account or payouts;
--       - ticket_types_platform_free_only: no ticket type with a price;
--       - orders_platform_free_only: no order with a price;
--       - events_platform_free_only / organisers_platform_free_only: an event
--         with a paid ticket type can't move to such an organiser, and an
--         organiser with one can't lose its owner;
--       - ticket_check_ins_owned_organiser_only (trigger
--         ticket_check_ins_guard): no check-in row (scan or undo) for such
--         an organiser's event.
--   * ticket_check_ins_guard also refuses check-in rows for an external
--     event (ticket_check_ins_sheltuh_only), so the API needs no read of the
--     event before each scan (code review of B2).
--     Free Sheltüh tickets and external ticketing stay available to them.
--   * private.admin_create_event: an admin's new event for an approved
--     organiser, logged 'created', and optionally published through
--     private.transition_event ('approved'), in one step.
--   * private.admin_edit_event: an admin's edit of any field of any event,
--     whatever its status, with optimistic concurrency (the caller's
--     expected updated_at, to the millisecond, or 'stale'). Ticketing changes
--     go through private.admin_set_event_ticketing (logged
--     'ticketing_changed', as B2's endpoint); every other change is one
--     'edited' entry. Optionally publishes, as above.
--   * private.admin_put_event_image / admin_delete_event_image: an admin's
--     photo change on any event, logged 'edited' ({"image": {old, new}}).
--
-- Locks: the organiser row first (for share), then the event row, the order
-- event approval and private.suspend_organiser already use, so an edit, an
-- approval and a takedown can't deadlock.
--
-- Access model as everywhere else: no new table; every new function pins its
-- search_path and has execute revoked from PUBLIC, anon and authenticated.
-- No new index: every new query is by primary key, or by the existing
-- ticket_types (event_id, id), orders (event_id) and event_moderation_log
-- (event_id, id) indexes.
--
-- Additive. Reversible before launch: drop the functions
-- private.admin_create_event, private.admin_edit_event,
-- private.admin_put_event_image, private.admin_delete_event_image, the five
-- triggers and their functions, and the organisers_platform_no_payouts
-- constraint. The enum values can't be removed from public.moderation_action
-- without recreating the type (harmless if left). Applying it fails if an
-- organiser without an owner already has a Stripe account (none should).
-- Existing paid ticket types of platform-managed organisers (dev seed data
-- from before this migration) are left alone, but can't be saved again with
-- a price.

alter type public.moderation_action add value if not exists 'created';
alter type public.moderation_action add value if not exists 'edited';
alter type public.moderation_action add value if not exists 'curated';

-- ---------------------------------------------------------------------------
-- Platform-managed organisers: free Sheltüh tickets or external ticketing only
-- ---------------------------------------------------------------------------

-- No owner, so nobody can onboard to Stripe Connect for it: never paid out.
alter table public.organisers
  add constraint organisers_platform_no_payouts
  check (owner_user_id is not null or (stripe_account_id is null and not payouts_enabled));

-- Every ticket type insert comes through private.replace_ticket_types (an
-- upsert: this BEFORE INSERT trigger sees the new price even when the row
-- then updates an existing one).
create function private.ticket_types_platform_free_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.price_cents > 0 and exists (
    select 1 from public.events e join public.organisers o on o.id = e.organiser_id
     where e.id = new.event_id and o.owner_user_id is null
  ) then
    raise exception 'A platform-managed organiser''s event can only have free Sheltüh tickets.'
      using errcode = 'check_violation', constraint = 'ticket_types_platform_free_only';
  end if;
  return new;
end;
$$;

create trigger ticket_types_platform_free_only before insert or update of price_cents on public.ticket_types
  for each row execute function private.ticket_types_platform_free_only();

-- Belt and braces behind the ticket types: no order with a price.
create function private.orders_platform_free_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.subtotal_cents > 0 or new.total_cents > 0) and exists (
    select 1 from public.events e join public.organisers o on o.id = e.organiser_id
     where e.id = new.event_id and o.owner_user_id is null
  ) then
    raise exception 'A platform-managed organiser''s event has no paid Sheltüh tickets.'
      using errcode = 'check_violation', constraint = 'orders_platform_free_only';
  end if;
  return new;
end;
$$;

create trigger orders_platform_free_only before insert on public.orders
  for each row execute function private.orders_platform_free_only();

-- No API moves an event to another organiser or removes an organiser's
-- owner; these keep a by-hand change from getting round the rule.
create function private.events_platform_free_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organiser_id is distinct from old.organiser_id
     and exists (select 1 from public.organisers o where o.id = new.organiser_id and o.owner_user_id is null)
     and exists (select 1 from public.ticket_types t where t.event_id = new.id and t.price_cents > 0) then
    raise exception 'An event with paid tickets can''t move to a platform-managed organiser.'
      using errcode = 'check_violation', constraint = 'events_platform_free_only';
  end if;
  return new;
end;
$$;

create trigger events_platform_free_only before update of organiser_id on public.events
  for each row execute function private.events_platform_free_only();

create function private.organisers_platform_free_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_user_id is null and old.owner_user_id is not null and exists (
    select 1 from public.events e join public.ticket_types t on t.event_id = e.id
     where e.organiser_id = new.id and t.price_cents > 0
  ) then
    raise exception 'An organiser with paid tickets can''t become platform-managed.'
      using errcode = 'check_violation', constraint = 'organisers_platform_free_only';
  end if;
  return new;
end;
$$;

create trigger organisers_platform_free_only before update of owner_user_id on public.organisers
  for each row execute function private.organisers_platform_free_only();

-- Check-in is the owning organiser's (private.check_in_ticket and
-- undo_check_in check ownership through the caller's organiser). A
-- platform-managed organiser has no owner to sign in as; this refuses its
-- events' check-in rows outright, so neither function can ever admit or undo
-- for one, whoever calls it. It also refuses rows for an external event
-- (no Sheltüh tickets): a scan of one rolls back, its rate-limit hit
-- included, and the API answers 409 without reading the event first.
create function private.ticket_check_ins_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
begin
  select o.owner_user_id is null as platform_managed, e.ticketing_mode into v_event
    from public.events e join public.organisers o on o.id = e.organiser_id
   where e.id = new.event_id;
  if v_event.platform_managed then
    raise exception 'A platform-managed organiser''s event has no check-in.'
      using errcode = 'check_violation', constraint = 'ticket_check_ins_owned_organiser_only';
  end if;
  if v_event.ticketing_mode = 'external' then
    raise exception 'Tickets for this event are sold on another site: there''s no check-in.'
      using errcode = 'check_violation', constraint = 'ticket_check_ins_sheltuh_only';
  end if;
  return new;
end;
$$;

create trigger ticket_check_ins_guard before insert on public.ticket_check_ins
  for each row execute function private.ticket_check_ins_guard();

-- Triggers don't need the caller to hold execute on their function.
revoke all on function private.ticket_types_platform_free_only() from public, anon, authenticated;
revoke all on function private.orders_platform_free_only() from public, anon, authenticated;
revoke all on function private.events_platform_free_only() from public, anon, authenticated;
revoke all on function private.organisers_platform_free_only() from public, anon, authenticated;
revoke all on function private.ticket_check_ins_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An admin's new event
-- ---------------------------------------------------------------------------

-- p_fields and p_ticket_types as private.create_event_draft's (already
-- validated by lib/server/event-input.ts). Returns:
--   result 'created'                 a draft, logged 'created' by p_admin_id
--          'published'               the same, then published through
--                                    private.transition_event ('approved')
--          'organiser_not_found'     no such organiser: nothing written
--          'organiser_not_approved'  the organiser isn't approved: nothing written
--          'platform_paid'           a platform-managed organiser and a paid
--                                    Sheltüh ticket type: nothing written
--   new_event_id                     the event's id ('created' / 'published')
-- A slug that's taken raises unique_violation (events_slug_key): the API
-- retries with another, and nothing from the failed attempt is kept.
create function private.admin_create_event(
  p_organiser_id uuid, p_admin_id uuid, p_slug text, p_fields jsonb, p_ticket_types jsonb, p_publish boolean,
  out result text, out new_event_id uuid
)
language plpgsql
set search_path = ''
as $$
declare
  v_org record;
begin
  -- The organiser first (share), as event approval does: a takedown can't
  -- interleave, so a published event's organiser is approved when it commits.
  select o.status, o.owner_user_id into v_org from public.organisers o where o.id = p_organiser_id for share;
  if not found then
    result := 'organiser_not_found';
    return;
  end if;
  if v_org.status <> 'approved' then
    result := 'organiser_not_approved';
    return;
  end if;
  if v_org.owner_user_id is null
     and coalesce(p_fields ->> 'ticketingMode', 'sheltuh') = 'sheltuh'
     and exists (select 1 from jsonb_array_elements(p_ticket_types) t where (t ->> 'priceCents')::integer > 0) then
    result := 'platform_paid';
    return;
  end if;

  new_event_id := private.create_event_draft(p_organiser_id, p_slug, p_fields, p_ticket_types);
  insert into public.event_moderation_log (event_id, action, actor_id) values (new_event_id, 'created', p_admin_id);

  if p_publish then
    if not private.transition_event(new_event_id, array['draft']::public.event_status[], 'published', 'approved', p_admin_id) then
      raise exception 'admin_create_event: the new draft could not be published';
    end if;
    result := 'published';
  else
    result := 'created';
  end if;
end;
$$;

revoke all on function private.admin_create_event(uuid, uuid, text, jsonb, jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An admin's edit
-- ---------------------------------------------------------------------------

-- Replaces p_event_id's fields and ticket types (p_fields / p_ticket_types as
-- private.edit_event_draft's) whatever its status, if it's still the version
-- the admin saw (p_expected_updated_at, compared to the millisecond: the API
-- sends updatedAt with millisecond precision). Optionally publishes it.
-- Refusals are all decided before anything is written. Returns:
--   'updated'                 saved: ticketing changes logged
--                             'ticketing_changed' (private.admin_set_event_ticketing,
--                             with p_reason), every other changed field in one
--                             'edited' entry (old and new values in `details`,
--                             with p_reason); then published if asked
--                             ('approved', through private.transition_event)
--   'unchanged'               nothing would change: nothing written
--   'not_found'               no such event
--   'stale'                   changed since p_expected_updated_at: nothing written
--   'has_orders'              switching to external an event with orders
--   'platform_paid'           a platform-managed organiser and a paid
--                             Sheltüh ticket type
--   'reason_required'         the ticketing mode or link of an event that has
--                             been approved before, without p_reason (B2's
--                             endpoint always needs one)
--   'organiser_not_approved'  publishing, but the organiser isn't approved
-- Removing a ticket type that has sold tickets, or cutting its quantity below
-- what's sold, raises (foreign_key_violation / check_violation) from
-- private.replace_ticket_types, and nothing is kept.
create function private.admin_edit_event(
  p_event_id uuid, p_admin_id uuid, p_expected_updated_at timestamptz,
  p_fields jsonb, p_ticket_types jsonb, p_publish boolean, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_organiser_id uuid;
  v_org record;
  v_event record;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_url text := p_fields ->> 'externalTicketUrl';
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
  v_ticketing_changed boolean;
  v_publish boolean;
  v_old jsonb;
  v_new jsonb;
  v_details jsonb;
  v_ticketing_result text;
begin
  select e.organiser_id into v_organiser_id from public.events e where e.id = p_event_id;
  if not found then
    return 'not_found';
  end if;
  -- Organiser (share), then event, as event approval and suspend_organiser.
  select o.status, o.owner_user_id into v_org from public.organisers o where o.id = v_organiser_id for share;
  select e.* into v_event from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  if date_trunc('milliseconds', v_event.updated_at) is distinct from date_trunc('milliseconds', p_expected_updated_at)
     or v_event.organiser_id <> v_organiser_id then
    return 'stale';
  end if;

  v_ticketing_changed := v_event.ticketing_mode is distinct from v_mode
    or v_event.external_ticket_url is distinct from v_url
    or v_event.external_free is distinct from v_free;
  v_publish := coalesce(p_publish, false) and v_event.status <> 'published';

  -- Every other field, old and new, in the API's names. Ticket types in the
  -- request's shape (an empty description left out), in display order.
  v_old := jsonb_build_object(
    'title', v_event.title,
    'description', v_event.description,
    'category', v_event.category::text,
    'venueName', v_event.venue_name,
    'venueAddress', v_event.venue_address,
    'suburb', v_event.suburb,
    'startsAt', v_event.starts_at,
    'endsAt', v_event.ends_at,
    'ticketTypes', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', t.id, 'name', t.name, 'description', t.description, 'priceCents', t.price_cents,
               'feePolicy', t.fee_policy::text, 'quantityAvailable', t.quantity_available)) order by t.position)
        from public.ticket_types t where t.event_id = p_event_id), '[]'::jsonb));
  v_new := jsonb_build_object(
    'title', p_fields ->> 'title',
    'description', p_fields ->> 'description',
    'category', p_fields ->> 'category',
    'venueName', p_fields ->> 'venueName',
    'venueAddress', p_fields ->> 'venueAddress',
    'suburb', p_fields ->> 'suburb',
    'startsAt', (p_fields ->> 'startsAt')::timestamptz,
    'endsAt', (p_fields ->> 'endsAt')::timestamptz,
    'ticketTypes', case when v_mode = 'external' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', x.e ->> 'id', 'name', x.e ->> 'name', 'description', nullif(x.e ->> 'description', ''),
               'priceCents', (x.e ->> 'priceCents')::integer, 'feePolicy', x.e ->> 'feePolicy',
               'quantityAvailable', (x.e ->> 'quantityAvailable')::integer)) order by x.ord)
        from jsonb_array_elements(p_ticket_types) with ordinality as x (e, ord)), '[]'::jsonb) end);
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k)), '{}'::jsonb)
    into v_details
    from jsonb_object_keys(v_new) k
   where (v_old -> k) is distinct from (v_new -> k);

  if v_details = '{}'::jsonb and not v_ticketing_changed and not v_publish then
    return 'unchanged';
  end if;

  -- Refusals, before anything is written.
  if v_org.owner_user_id is null and v_mode = 'sheltuh'
     and exists (select 1 from jsonb_array_elements(p_ticket_types) t where (t ->> 'priceCents')::integer > 0) then
    return 'platform_paid';
  end if;
  if v_mode = 'external' and v_event.ticketing_mode <> 'external'
     and exists (select 1 from public.orders o where o.event_id = p_event_id) then
    return 'has_orders';
  end if;
  if (v_event.ticketing_mode is distinct from v_mode or v_event.external_ticket_url is distinct from v_url)
     and p_reason is null
     and exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'reason_required';
  end if;
  if v_publish and v_org.status <> 'approved' then
    return 'organiser_not_approved';
  end if;

  -- Ticketing first: switching to external deletes the ticket types, and
  -- switching back leaves none for replace_ticket_types to add below.
  if v_ticketing_changed then
    v_ticketing_result := private.admin_set_event_ticketing(p_event_id, p_admin_id, v_mode, v_url, v_free, p_reason);
    if v_ticketing_result <> 'updated' then
      raise exception 'admin_edit_event: unexpected ticketing result %', v_ticketing_result;
    end if;
  end if;

  if v_details - 'ticketTypes' <> '{}'::jsonb then
    update public.events set
      title = p_fields ->> 'title',
      description = p_fields ->> 'description',
      category = (p_fields ->> 'category')::public.event_category,
      venue_name = p_fields ->> 'venueName',
      venue_address = p_fields ->> 'venueAddress',
      suburb = p_fields ->> 'suburb',
      starts_at = (p_fields ->> 'startsAt')::timestamptz,
      ends_at = (p_fields ->> 'endsAt')::timestamptz
    where id = p_event_id;
  end if;
  if v_mode = 'sheltuh' and v_details ? 'ticketTypes' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;

  if v_details <> '{}'::jsonb then
    insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
    values (p_event_id, 'edited', p_admin_id, p_reason, v_details);
  end if;

  if v_publish then
    if not private.transition_event(p_event_id, array['draft', 'pending_review', 'rejected']::public.event_status[],
                                    'published', 'approved', p_admin_id) then
      raise exception 'admin_edit_event: the event could not be published';
    end if;
  end if;
  return 'updated';
end;
$$;

revoke all on function private.admin_edit_event(uuid, uuid, timestamptz, jsonb, jsonb, boolean, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An admin's photo change
-- ---------------------------------------------------------------------------

-- Sets p_event_id's photo, whatever its status, and logs it ('edited',
-- {"image": {"old": "set" or null, "new": "set"}}). The event row is
-- key-share locked (as the image's foreign key would), so the event can't be
-- deleted under it. Returns 'updated' or 'not_found'.
create function private.admin_put_event_image(
  p_event_id uuid, p_admin_id uuid, p_content_type text, p_data bytea
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_had boolean;
begin
  perform 1 from public.events e where e.id = p_event_id for key share;
  if not found then
    return 'not_found';
  end if;
  select exists (select 1 from public.event_images i where i.event_id = p_event_id) into v_had;

  insert into public.event_images (event_id, content_type, data)
  values (p_event_id, p_content_type, p_data)
  on conflict (event_id) do update set content_type = excluded.content_type, data = excluded.data, updated_at = now();

  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_admin_id,
          jsonb_build_object('image', jsonb_build_object('old', case when v_had then 'set' end, 'new', 'set')));
  return 'updated';
end;
$$;

revoke all on function private.admin_put_event_image(uuid, uuid, text, bytea) from public, anon, authenticated;

-- Removes p_event_id's photo, whatever its status, and logs it ('edited',
-- {"image": {"old": "set", "new": null}}). Returns 'deleted', 'unchanged'
-- (no photo: nothing logged) or 'not_found'.
create function private.admin_delete_event_image(p_event_id uuid, p_admin_id uuid) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events e where e.id = p_event_id for key share;
  if not found then
    return 'not_found';
  end if;
  delete from public.event_images i where i.event_id = p_event_id;
  if not found then
    return 'unchanged';
  end if;
  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_admin_id, jsonb_build_object('image', jsonb_build_object('old', 'set', 'new', null)));
  return 'deleted';
end;
$$;

revoke all on function private.admin_delete_event_image(uuid, uuid) from public, anon, authenticated;


-- ===== 20261022000200_external_ticketing_hardening.sql =====
-- External ticketing hardening (security review of B2,
-- 20261022000000_external_ticketing.sql; docs/architecture.md, "External
-- ticketing"):
--
--   * private.record_outbound_click: once the event's per-minute cap is
--     reached, a refused click marks the day cap_reached with one write, the
--     first time only. Every refusal after that is plain reads (the cap's
--     counter, then the day's flag): no row lock and no transaction id, so
--     a flood over the cap costs no writes.
--   * private.external_ticket_url_ok also refuses a host whose last label is
--     all digits or starts with 0x (IPv4 written in hex, octal or mixed
--     forms, e.g. https://0x7f.1/). The API's URL parser already turns those
--     into an IP address (refused) or rejects them; this keeps the database's
--     check as strict for anything written around the API.
--   * More link shorteners and link-in-bio redirectors (j.mp, tiny.one,
--     rotf.lol, ht.ly, dlvr.it, ift.tt, qrco.de, linktr.ee, lnk.to, ffm.to,
--     smarturl.it), mirrored in lib/ticketing.ts (LINK_SHORTENER_HOSTS);
--     tests/server/ticketing-url.test.ts checks the lists agree.
--
-- The events_external_ticket_url_valid constraint calls the function, so it
-- applies to every new or changed link straight away. Existing rows aren't
-- re-checked (Postgres doesn't revalidate a check constraint when its
-- function changes); none should exist before launch. To check by hand:
--   select id, external_ticket_url from public.events
--    where external_ticket_url is not null and not private.external_ticket_url_ok(external_ticket_url);
--
-- Not destructive. Reversible: recreate both functions from
-- 20261022000000_external_ticketing.sql. Functions only: no table, grant or
-- index changes.

create or replace function private.external_ticket_url_ok(p_url text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
     and char_length(p_url) <= 2048
     -- Printable ASCII, no space; no backslash (URL parsers read it as "/").
     and p_url ~ '^[!-~]+$'
     and strpos(p_url, chr(92)) = 0
     -- https://, then a host of DNS labels (so no credentials, port, IPv6
     -- literal or trailing dot), then optionally a path, query or fragment.
     and p_url ~ '^https://[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$'
     and not exists (
       select 1
         from (select substring(p_url from '^https://([^/?#]+)') as host) h
        where h.host ~ '^[0-9.]+$'
           -- A last label that's a number (decimal, octal or hex) makes the
           -- whole host an IPv4 address to a URL parser (0x7f.1 is 127.0.0.1).
           or h.host ~ '(^|\.)([0-9]+|0x[0-9a-f]*)$'
           or h.host ~ '(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan|test|invalid|example|onion)$'
           or h.host ~ ('(^|\.)(adf\.ly|bit\.do|bit\.ly|bitly\.com|bl\.ink|buff\.ly|cutt\.ly|dlvr\.it|dub\.sh|fb\.me'
                        || '|ffm\.to|goo\.gl|ht\.ly|ift\.tt|is\.gd|j\.mp|linktr\.ee|lnk\.to|lnkd\.in|ow\.ly|qrco\.de'
                        || '|rb\.gy|rebrand\.ly|rotf\.lol|s\.id|short\.io|shorturl\.at|smarturl\.it|t\.co|t\.ly'
                        || '|tiny\.cc|tiny\.one|tinyurl\.com|trib\.al|v\.gd)$')
     );
$$;

revoke all on function private.external_ticket_url_ok(text) from public, anon, authenticated;

-- As in 20261022000000_external_ticketing.sql, except that a refused click
-- writes only while the day isn't flagged yet.
create or replace function private.record_outbound_click(p_event_id uuid, p_limit integer, p_window interval)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Australia/Melbourne')::date;
begin
  perform 1 from public.events e
   where e.id = p_event_id and e.status = 'published' and e.ticketing_mode = 'external';
  if not found then
    return 'not_found';
  end if;

  if not private.take_event_rate_limit(p_event_id, 'outbound', p_limit, p_window) then
    -- A plain read first: once the day is flagged, a refusal writes nothing.
    perform 1 from public.event_outbound_clicks c
     where c.event_id = p_event_id and c.day = v_day and c.cap_reached;
    if not found then
      insert into public.event_outbound_clicks as c (event_id, day, clicks, cap_reached)
      values (p_event_id, v_day, 0, true)
      on conflict (event_id, day) do update set cap_reached = true where not c.cap_reached;
    end if;
    return 'rate_limited';
  end if;

  insert into public.event_outbound_clicks as c (event_id, day, clicks)
  values (p_event_id, v_day, 1)
  on conflict (event_id, day) do update set clicks = c.clicks + 1;
  return 'recorded';
end;
$$;

revoke all on function private.record_outbound_click(uuid, integer, interval) from public, anon, authenticated;


-- ===== 20261023000000_trending.sql =====
-- Trending (docs/FEATURE_PLAN.md, B4; docs/architecture.md, "Trending").
--
--   * private.event_curation: an admin's per-event boost (0.5 to 2, default
--     1) and exclusion from trending. One row per event, written only by
--     private.set_event_curation, which also logs a 'curated' entry (with the
--     reason and the old and new values in `details`) in the event's
--     moderation log in the same step.
--   * private.trending_snapshot: the ranked list the public endpoint serves
--     (rank, event, score, when computed), rebuilt as a whole by
--     private.refresh_trending (Vercel Cron, GET /api/cron/trending).
--   * Score S = R * P * B, from these immutable helpers (single source of the
--     formula; tests call them directly):
--       private.trending_day_utility  u = 6 ln(1+V) + 8F + 15G + 25Op + 10Of
--         (V views capped at 300 a day, 0 on a flood day; the rest capped at
--         50 a day each)
--       private.trending_decay        3-day half-life, days 0..13 only
--       private.trending_shrink       Bayesian shrinkage, m = 2, towards the
--                                     median of the eligible events
--       private.trending_proximity    1 within 7 days of the start, linear
--                                     to 0.3 at 60 days
--     B is the admin boost.
--   * Favourites (F) are read only as an aggregate input to the score
--     (owner-approved 21 Oct 2026). Nothing stores or returns a per-event
--     favourite count: the snapshot keeps only the final score.
--   * event_favourites gains an (event_id, created_at) index: the refresh
--     counts each candidate event's favourites over the last 14 days, and
--     the table's only other index leads with user_id. It also serves the
--     events foreign key's cascade.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated; every new function pins its search_path and has execute
-- revoked from PUBLIC, anon and authenticated.
--
-- Additive: no existing row changes. Reversible: drop the functions
-- private.refresh_trending, private.set_event_curation,
-- private.trending_day_utility, private.trending_decay,
-- private.trending_shrink and private.trending_proximity, the tables
-- private.trending_snapshot and private.event_curation, and the index
-- event_favourites_event_created_idx. Dropping event_curation discards the
-- admins' boosts and exclusions (their 'curated' log entries stay); the
-- snapshot is rebuilt by the next refresh, so dropping it loses nothing.

-- ---------------------------------------------------------------------------
-- Admin curation
-- ---------------------------------------------------------------------------

create table private.event_curation (
  event_id uuid primary key references public.events (id) on delete cascade,
  boost numeric(3, 2) not null default 1 check (boost between 0.5 and 2),
  excluded boolean not null default false,
  -- Null until an admin changes something (a row can exist with the defaults).
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz
);
-- The primary key serves every read (by event) and the events FK cascade.
-- updated_by needs no index: auth.users rows are deleted only by hand, and
-- this table is at most one row per event.

-- ---------------------------------------------------------------------------
-- Snapshot
-- ---------------------------------------------------------------------------

create table private.trending_snapshot (
  rank smallint primary key check (rank >= 1),
  event_id uuid not null unique references public.events (id) on delete cascade,
  score double precision not null check (score >= 0),
  computed_at timestamptz not null
);
-- The primary key serves the public read (order by rank); the unique
-- event_id index serves the join to events and the FK cascade.

alter table private.event_curation enable row level security;
alter table private.trending_snapshot enable row level security;
revoke all on private.event_curation, private.trending_snapshot from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Favourites per event (refresh only)
-- ---------------------------------------------------------------------------

create index event_favourites_event_created_idx on public.event_favourites (event_id, created_at);

-- ---------------------------------------------------------------------------
-- The formula
-- ---------------------------------------------------------------------------

-- One Melbourne day's utility. Negative inputs count as 0.
create function private.trending_day_utility(
  p_views integer, p_flood boolean, p_favourites integer, p_going integer, p_paid_orders integer, p_free_orders integer
) returns double precision
language sql
immutable
set search_path = ''
as $$
  select 6 * ln(1 + case when p_flood then 0 else least(greatest(coalesce(p_views, 0), 0), 300) end)
       + 8 * least(greatest(coalesce(p_favourites, 0), 0), 50)
       + 15 * least(greatest(coalesce(p_going, 0), 0), 50)
       + 25 * least(greatest(coalesce(p_paid_orders, 0), 0), 50)
       + 10 * least(greatest(coalesce(p_free_orders, 0), 0), 50)
$$;

-- Weight of a day p_age_days old (0 = today): a 3-day half-life, and nothing
-- outside the 14-day window (0..13).
create function private.trending_decay(p_age_days integer) returns double precision
language sql
immutable
set search_path = ''
as $$
  select case when p_age_days between 0 and 13 then power(0.5::double precision, p_age_days / 3.0::double precision) else 0 end
$$;

-- Bayesian shrinkage: an event with few engagement events (p_n) is pulled
-- towards p_prior (the median of the eligible events' raw scores) with the
-- weight of p_m pseudo-events. A null prior (no eligible events) leaves the
-- raw score.
create function private.trending_shrink(
  p_raw double precision, p_n integer, p_prior double precision, p_m double precision
) returns double precision
language sql
immutable
set search_path = ''
as $$
  select (greatest(p_n, 0) * p_raw + p_m * coalesce(p_prior, p_raw)) / (greatest(p_n, 0) + p_m)
$$;

-- Start proximity: 1 when the event starts within 7 days (or has started),
-- falling linearly to 0.3 at 60 days, and 0.3 beyond.
create function private.trending_proximity(p_starts_at timestamptz, p_now timestamptz) returns double precision
language sql
immutable
set search_path = ''
as $$
  select case
           when d <= 7 then 1
           when d >= 60 then 0.3
           else 1 - 0.7 * (d - 7) / 53
         end
    from (select extract(epoch from (p_starts_at - p_now))::double precision / 86400 as d) x
$$;

-- ---------------------------------------------------------------------------
-- Refresh
-- ---------------------------------------------------------------------------

-- Rebuilds private.trending_snapshot as of p_now (default now(); tests pass
-- another instant). An event is eligible when it's published, its organiser
-- is approved, it hasn't ended, it starts within 60 days, its latest
-- approval is at least 6 hours old, an admin hasn't excluded it, and it has
-- at least 3 engagement events (favourites, Who's Going opt-ins and orders,
-- after the daily caps; views aren't engagement events) in the 14-day
-- window. The organiser's own activity doesn't count: favourites and opt-ins
-- by the owner account, and orders bought with the owner account's email or
-- the organiser's contact email. Opt-ins of suspended members don't count
-- either (they're left out of every Who's Going count). At most 2 events per
-- organiser, then the top 24. Ties: sooner start, then id.
--
-- Returns how many events were eligible and how many were ranked. A
-- transaction-scoped advisory lock serialises concurrent refreshes; readers
-- keep seeing the previous snapshot until this one commits. Deletes (not
-- truncates) the old rows, so readers are never blocked.
create function private.refresh_trending(p_now timestamptz default now(), out eligible integer, out ranked integer)
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Australia/Melbourne')::date;
  v_from date := (p_now at time zone 'Australia/Melbourne')::date - 13;
  v_from_at timestamptz := (((p_now at time zone 'Australia/Melbourne')::date - 13)::timestamp at time zone 'Australia/Melbourne');
begin
  perform pg_advisory_xact_lock(hashtextextended('private.refresh_trending', 0));

  delete from private.trending_snapshot;

  with candidates as (
    select e.id, e.organiser_id, e.starts_at, o.owner_user_id,
           lower(u.email) as owner_email, lower(o.contact_email) as contact_email,
           coalesce(c.boost, 1)::double precision as boost
      from public.events e
      join public.organisers o on o.id = e.organiser_id
      left join auth.users u on u.id = o.owner_user_id
      left join private.event_curation c on c.event_id = e.id
     where e.status = 'published'
       and o.status = 'approved'
       and e.ends_at > p_now
       and e.starts_at <= p_now + interval '60 days'
       and not coalesce(c.excluded, false)
       and (select max(l.created_at) from public.event_moderation_log l
             where l.event_id = e.id and l.action = 'approved') <= p_now - interval '6 hours'
  ),
  activity as (
    -- A day on which the event's view cap was reached (record_view's flood
    -- marker) counts no views at all (trending_day_utility's p_flood).
    select v.event_id, v.day, sum(v.views)::integer as views,
           exists (select 1 from private.event_view_cap_days d where d.event_id = v.event_id and d.day = v.day) as flood,
           0 as favourites, 0 as going, 0 as paid_orders, 0 as free_orders
      from public.event_view_counts v
      join candidates c on c.id = v.event_id
     where v.day between v_from and v_today
     group by v.event_id, v.day
    union all
    select f.event_id, (f.created_at at time zone 'Australia/Melbourne')::date, 0, false, count(*)::integer, 0, 0, 0
      from public.event_favourites f
      join candidates c on c.id = f.event_id
     where f.created_at >= v_from_at and f.created_at <= p_now
       and f.user_id is distinct from c.owner_user_id
     group by 1, 2
    union all
    select a.event_id, (a.created_at at time zone 'Australia/Melbourne')::date, 0, false, 0, count(*)::integer, 0, 0
      from public.event_attendees a
      join candidates c on c.id = a.event_id
     where a.created_at >= v_from_at and a.created_at <= p_now
       and a.user_id is distinct from c.owner_user_id
       and not exists (select 1 from private.social_suspensions s where s.user_id = a.user_id)
     group by 1, 2
    union all
    select r.event_id, (r.created_at at time zone 'Australia/Melbourne')::date, 0, false, 0, 0,
           (count(*) filter (where r.total_cents > 0))::integer,
           (count(*) filter (where r.total_cents = 0))::integer
      from public.orders r
      join candidates c on c.id = r.event_id
     where r.status = 'paid'
       and r.created_at >= v_from_at and r.created_at <= p_now
       and lower(r.buyer_email) is distinct from c.owner_email
       and lower(r.buyer_email) is distinct from c.contact_email
     group by 1, 2
  ),
  days as (
    select event_id, day,
           private.trending_day_utility(sum(views)::integer, bool_or(flood), sum(favourites)::integer,
                                        sum(going)::integer, sum(paid_orders)::integer, sum(free_orders)::integer) as utility,
           (least(sum(favourites), 50) + least(sum(going), 50) + least(sum(paid_orders), 50)
              + least(sum(free_orders), 50))::integer as engagement,
           v_today - day as age
      from activity
     group by event_id, day
  ),
  raw_scores as (
    select event_id,
           sum(utility * private.trending_decay(age)) as r_raw,
           sum(engagement)::integer as n
      from days
     where age between 0 and 13
     group by event_id
  ),
  eligible_events as (
    select c.id, c.organiser_id, c.starts_at, c.boost, r.r_raw, r.n
      from candidates c
      join raw_scores r on r.event_id = c.id
     where r.n >= 3
  ),
  prior_median as (
    select percentile_cont(0.5) within group (order by r_raw) as median from eligible_events
  ),
  scored as (
    select x.id, x.organiser_id, x.starts_at,
           private.trending_shrink(x.r_raw, x.n, p.median, 2)
             * private.trending_proximity(x.starts_at, p_now)
             * x.boost as score
      from eligible_events x cross join prior_median p
  ),
  per_organiser as (
    select s.*, row_number() over (partition by s.organiser_id order by s.score desc, s.starts_at, s.id) as organiser_rank
      from scored s
  ),
  top_events as (
    select p.id, p.score, row_number() over (order by p.score desc, p.starts_at, p.id) as rank
      from per_organiser p
     where p.organiser_rank <= 2
  ),
  inserted as (
    insert into private.trending_snapshot (rank, event_id, score, computed_at)
    select t.rank, t.id, t.score, p_now from top_events t where t.rank <= 24
    returning 1
  )
  select (select count(*)::integer from eligible_events), (select count(*)::integer from inserted)
    into eligible, ranked;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin curation
-- ---------------------------------------------------------------------------

-- Sets p_event_id's curation (any status). Key-share-locks the event (so it
-- can't be deleted mid-call, without holding up checkouts), then locks its
-- curation row. Nothing changing is 'unchanged' (nothing logged); otherwise
-- the row is updated and a 'curated' moderation log entry written with the
-- admin, p_reason and, in `details`, the old and new value of each changed
-- field, in one step. Returns 'updated', 'unchanged' or 'not_found'.
create function private.set_event_curation(
  p_event_id uuid, p_admin_id uuid, p_boost numeric, p_excluded boolean, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_boost numeric(3, 2) := round(p_boost, 2);
  v_old_boost numeric(3, 2);
  v_old_excluded boolean;
  v_details jsonb := '{}'::jsonb;
begin
  perform 1 from public.events e where e.id = p_event_id for key share;
  if not found then
    return 'not_found';
  end if;

  insert into private.event_curation (event_id) values (p_event_id) on conflict (event_id) do nothing;
  select c.boost, c.excluded into v_old_boost, v_old_excluded
    from private.event_curation c where c.event_id = p_event_id for update;

  if v_old_boost <> v_boost then
    v_details := v_details || jsonb_build_object('boost', jsonb_build_object('old', v_old_boost, 'new', v_boost));
  end if;
  if v_old_excluded <> p_excluded then
    v_details := v_details || jsonb_build_object('excluded', jsonb_build_object('old', v_old_excluded, 'new', p_excluded));
  end if;
  if v_details = '{}'::jsonb then
    return 'unchanged';
  end if;

  update private.event_curation
     set boost = v_boost, excluded = p_excluded, updated_by = p_admin_id, updated_at = now()
   where event_id = p_event_id;
  insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
  values (p_event_id, 'curated', p_admin_id, p_reason, v_details);
  return 'updated';
end;
$$;

revoke all on function private.trending_day_utility(integer, boolean, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function private.trending_decay(integer) from public, anon, authenticated;
revoke all on function private.trending_shrink(double precision, integer, double precision, double precision) from public, anon, authenticated;
revoke all on function private.trending_proximity(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.refresh_trending(timestamptz) from public, anon, authenticated;
revoke all on function private.set_event_curation(uuid, uuid, numeric, boolean, text) from public, anon, authenticated;


-- ===== 20261023000100_review_hardening.sql =====
-- Review hardening (security and code review of B2/B3; docs/architecture.md,
-- "Admin authoring", "External ticketing" and "Check-in"):
--
-- 1. A photo change is a change to the event. Every write to
--    public.event_images (insert, update, delete: the organiser's
--    PUT/DELETE /events/{id}/image, private.admin_put_event_image and
--    private.admin_delete_event_image) now bumps events.updated_at in the
--    same transaction (AFTER trigger event_images_touch_event). An admin's
--    PATCH /admin/events/{id} carries the updatedAt it loaded
--    (expectedUpdatedAt), so a photo the organiser swapped after the admin
--    opened the editor makes the save (and its publish) stale, a 409, instead
--    of publishing a photo the admin never saw. The image responses already
--    return the event record, so the editor takes its next version from them.
--
--    Lock order: every image writer locks the event row first (for no key
--    update), then the image row; the trigger's update of the event then
--    needs no lock it doesn't already hold. The admin functions below are
--    redefined to take that lock (they took `for key share`, which let an
--    admin's and an organiser's upload deadlock once the trigger updates
--    the event); the organiser's handler does the same
--    (lib/server/handlers/event-images.ts).
--
-- 2. The ticket link's rules apply when a link is written, not on every
--    later update of the row. The events_external_ticket_url_valid CHECK
--    constraint was evaluated on every update of an external event, so
--    adding a shortener to private.external_ticket_url_ok later would have
--    made every update of an event holding such a link fail, unpublishing
--    and suspending included. It's replaced by a BEFORE INSERT OR UPDATE OF
--    external_ticket_url trigger of the same name, which checks a link only
--    when it's inserted or changed (same errcode 23514 and constraint name,
--    so the API's error mapping is unchanged). The mode/link consistency
--    constraints (events_ticketing_fields, events_external_is_free) stay.
--    Existing links are revalidated first: if any fails, this migration
--    raises with the offending event ids and nothing is applied (replace
--    each link with PATCH /admin/events/{id}/ticketing, or unpublish, then
--    re-run).
--
-- 3. Admin check-in for platform-managed organisers' events (owner decision,
--    21 Oct 2026, docs/FEATURE_PLAN.md). ticket_check_ins_guard now allows a
--    check-in row (scan or undo) for a platform-managed organiser's event
--    when its actor is an admin (auth.users.raw_app_meta_data ->> 'role' =
--    'admin', the app_metadata.role the API reads), and refuses one by an
--    admin who isn't the owner for an organiser-owned event. Both are
--    constraint ticket_check_ins_actor_allowed (it replaces
--    ticket_check_ins_owned_organiser_only). External events are still
--    refused (ticket_check_ins_sheltuh_only). check_in_ticket and
--    undo_check_in are unchanged: the API passes the event's (platform)
--    organiser as p_organiser_id and the admin as p_actor_id, so the
--    ownership check, locks, idempotency, per-account rate limit and the
--    log's actor (the admin) all work as for an organiser.
--
-- Access model as everywhere else: no new table; every new or redefined
-- function pins its search_path and has execute revoked from PUBLIC, anon
-- and authenticated. No new index: the trigger's update is by primary key,
-- and the guard's reads are by primary key (events, organisers, auth.users).
--
-- Not destructive. Reversible: drop trigger event_images_touch_event on
-- public.event_images and function private.event_images_touch_event();
-- recreate admin_put_event_image / admin_delete_event_image and
-- ticket_check_ins_guard from 20261022000100_admin_event_authoring.sql;
-- drop trigger events_external_ticket_url_valid on public.events and
-- function private.events_external_ticket_url_valid(), and re-add the check
-- constraint from 20261022000000_external_ticketing.sql (which revalidates
-- every row). Reverting the guard after admins have checked people in
-- leaves their log rows in place (no data is lost or changed).

-- ---------------------------------------------------------------------------
-- First, before anything changes: every stored ticket link must pass the
-- current rules (part 2 below stops re-checking links that aren't written).
-- ---------------------------------------------------------------------------

do $$
declare
  v_ids text;
begin
  select string_agg(e.id::text, ', ' order by e.id) into v_ids
    from public.events e
   where e.external_ticket_url is not null and not private.external_ticket_url_ok(e.external_ticket_url);
  if v_ids is not null then
    raise exception 'These events have a ticket link that is no longer accepted: %. Replace each link (PATCH /admin/events/{id}/ticketing) or unpublish the event, then run this migration again.', v_ids
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Image writes bump the event's version
-- ---------------------------------------------------------------------------

create function private.event_images_touch_event() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- events_set_updated_at sets the time. When the event itself is being
  -- deleted (the image goes with it, on delete cascade), its row is already
  -- gone and this updates nothing.
  update public.events set updated_at = now()
   where id = case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  return null;
end;
$$;

create trigger event_images_touch_event after insert or update or delete on public.event_images
  for each row execute function private.event_images_touch_event();

revoke all on function private.event_images_touch_event() from public, anon, authenticated;

-- As in 20261022000100_admin_event_authoring.sql, but the event row is locked
-- for no key update (not key share) before the image is written: the order
-- every image writer uses (see the header).
create or replace function private.admin_put_event_image(
  p_event_id uuid, p_admin_id uuid, p_content_type text, p_data bytea
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_had boolean;
begin
  perform 1 from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  select exists (select 1 from public.event_images i where i.event_id = p_event_id) into v_had;

  insert into public.event_images (event_id, content_type, data)
  values (p_event_id, p_content_type, p_data)
  on conflict (event_id) do update set content_type = excluded.content_type, data = excluded.data, updated_at = now();

  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_admin_id,
          jsonb_build_object('image', jsonb_build_object('old', case when v_had then 'set' end, 'new', 'set')));
  return 'updated';
end;
$$;

create or replace function private.admin_delete_event_image(p_event_id uuid, p_admin_id uuid) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  delete from public.event_images i where i.event_id = p_event_id;
  if not found then
    return 'unchanged';
  end if;
  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_admin_id, jsonb_build_object('image', jsonb_build_object('old', 'set', 'new', null)));
  return 'deleted';
end;
$$;

revoke all on function private.admin_put_event_image(uuid, uuid, text, bytea) from public, anon, authenticated;
revoke all on function private.admin_delete_event_image(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The ticket link is checked when it's written
-- ---------------------------------------------------------------------------

create function private.events_external_ticket_url_valid() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only a new or changed link: an update that leaves the link alone (an
  -- unpublish, a takedown, an edit sending it back unchanged) never
  -- re-checks it against rules tightened since it was approved.
  if new.external_ticket_url is not null
     and (tg_op = 'INSERT' or new.external_ticket_url is distinct from old.external_ticket_url)
     and not private.external_ticket_url_ok(new.external_ticket_url) then
    raise exception 'That ticket link isn''t accepted.'
      using errcode = 'check_violation', constraint = 'events_external_ticket_url_valid';
  end if;
  return new;
end;
$$;

create trigger events_external_ticket_url_valid before insert or update of external_ticket_url on public.events
  for each row execute function private.events_external_ticket_url_valid();

revoke all on function private.events_external_ticket_url_valid() from public, anon, authenticated;

alter table public.events drop constraint events_external_ticket_url_valid;

-- ---------------------------------------------------------------------------
-- 3. Admins check in for platform-managed organisers' events only
-- ---------------------------------------------------------------------------

-- As in 20261022000100_admin_event_authoring.sql, except who may act:
--   * a platform-managed organiser's event (no owner): an admin only;
--   * an organiser's own event: anyone but an admin who isn't its owner
--     (the functions check the caller's organiser owns the event; this keeps
--     an admin out even if the API passed the event's organiser by mistake).
-- External events are still refused for everyone.
create or replace function private.ticket_check_ins_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_admin boolean;
begin
  select o.owner_user_id, e.ticketing_mode into v_event
    from public.events e join public.organisers o on o.id = e.organiser_id
   where e.id = new.event_id;
  -- app_metadata.role, as the API reads it from Supabase Auth.
  select exists (
    select 1 from auth.users u where u.id = new.actor_user_id and u.raw_app_meta_data ->> 'role' = 'admin'
  ) into v_admin;
  if (v_event.owner_user_id is null and not v_admin)
     or (v_event.owner_user_id is not null and v_admin and new.actor_user_id is distinct from v_event.owner_user_id) then
    raise exception 'Only an admin can check in for a platform-managed organiser''s event, and an admin can''t check in for an organiser''s.'
      using errcode = 'check_violation', constraint = 'ticket_check_ins_actor_allowed';
  end if;
  if v_event.ticketing_mode = 'external' then
    raise exception 'Tickets for this event are sold on another site: there''s no check-in.'
      using errcode = 'check_violation', constraint = 'ticket_check_ins_sheltuh_only';
  end if;
  return new;
end;
$$;

revoke all on function private.ticket_check_ins_guard() from public, anon, authenticated;


-- ===== 20261023000200_trending_distinct.sql =====
-- Trending: eligibility counts distinct people, not actions (manager decision,
-- 21 Oct 2026, docs/FEATURE_PLAN.md; docs/architecture.md, "Trending").
--
--   * private.refresh_trending is replaced. An event is eligible only when at
--     least 3 DIFFERENT people engaged with it in the 14-day window
--     (favourite, Who's Going opt-in, paid or free order). One person
--     favouriting, opting in and buying tickets is still one person, so
--     nobody can make an event trend alone. The same count is the n of the
--     shrinkage (it was the number of engagement events after the daily caps).
--   * A person is a normalised email address (private.email_key: lower case,
--     trimmed, no +tag, Gmail dots and googlemail.com folded) where there is
--     one: the account's email for favourites and opt-ins, the buyer email
--     for orders, so a member's favourite and their guest checkout are one
--     person. An account without an email counts by its user id. An order
--     without a buyer email still adds to the score but to nobody's count.
--   * The organiser's own activity is left out by the same key: favourites
--     and opt-ins by the owner account, and anything by a person whose key is
--     the owner account's email or the organiser's contact email (so
--     owner+promo@ and o.wner@gmail.com no longer slip through, and neither
--     does an account registered with the contact email).
--   * The score itself is unchanged: daily utility from action counts, with
--     the same caps, decay, proximity and boost; the formula functions
--     (private.trending_day_utility, _decay, _shrink, _proximity) are kept as
--     they are. Days are still Melbourne days (`at time zone
--     'Australia/Melbourne'`, so daylight saving moves midnight's UTC instant).
--   * orders_event_paid_created_idx (event_id, created_at) where status =
--     'paid': the refresh reads each candidate event's paid orders over the
--     last 14 days. The existing partial indexes lead with event_id but then
--     hold lower(buyer_email) or buyer_email_key (free orders only), so they
--     can't bound the date range; this one serves the range scan per event.
--
-- Same signature, same grants (none): `create or replace` keeps the revoked
-- execute privilege, and it's revoked again below for clarity.
--
-- Additive and reversible: re-create private.refresh_trending from
-- 20261023000000_trending.sql and drop index orders_event_paid_created_idx.
-- No data changes; the snapshot is rebuilt by the next refresh.

create index orders_event_paid_created_idx on public.orders (event_id, created_at) where status = 'paid';

-- Rebuilds private.trending_snapshot as of p_now (default now(); tests pass
-- another instant). An event is eligible when it's published, its organiser
-- is approved, it hasn't ended, it starts within 60 days, its latest
-- approval is at least 6 hours old, an admin hasn't excluded it, and at least
-- 3 distinct people (see above) engaged with it in the 14-day window
-- (favourites, Who's Going opt-ins and paid orders, free ones included;
-- views aren't engagement). The organiser's own activity doesn't count (see
-- above). Opt-ins of suspended members don't count either (they're left out
-- of every Who's Going count). At most 2 events per organiser, then the top
-- 24. Ties: sooner start, then id.
--
-- Returns how many events were eligible and how many were ranked. A
-- transaction-scoped advisory lock serialises concurrent refreshes; readers
-- keep seeing the previous snapshot until this one commits. Deletes (not
-- truncates) the old rows, so readers are never blocked.
create or replace function private.refresh_trending(p_now timestamptz default now(), out eligible integer, out ranked integer)
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Australia/Melbourne')::date;
  v_from date := (p_now at time zone 'Australia/Melbourne')::date - 13;
  -- Midnight starting v_from in Melbourne, as an instant (its UTC offset is
  -- that day's, not today's, across a daylight-saving change).
  v_from_at timestamptz := (((p_now at time zone 'Australia/Melbourne')::date - 13)::timestamp at time zone 'Australia/Melbourne');
begin
  perform pg_advisory_xact_lock(hashtextextended('private.refresh_trending', 0));

  delete from private.trending_snapshot;

  with candidates as (
    select e.id, e.organiser_id, e.starts_at, o.owner_user_id,
           'e:' || private.email_key(u.email) as owner_key,
           'e:' || private.email_key(o.contact_email) as contact_key,
           coalesce(c.boost, 1)::double precision as boost
      from public.events e
      join public.organisers o on o.id = e.organiser_id
      left join auth.users u on u.id = o.owner_user_id
      left join private.event_curation c on c.event_id = e.id
     where e.status = 'published'
       and o.status = 'approved'
       and e.ends_at > p_now
       and e.starts_at <= p_now + interval '60 days'
       and not coalesce(c.excluded, false)
       and (select max(l.created_at) from public.event_moderation_log l
             where l.event_id = e.id and l.action = 'approved') <= p_now - interval '6 hours'
  ),
  -- One row per engagement in the window, with the person behind it (null:
  -- an order without a buyer email, which nobody can be told apart by).
  engagements_all as (
    select f.event_id, f.created_at, 'favourite'::text as kind,
           coalesce('e:' || private.email_key(u.email), 'u:' || f.user_id::text) as person,
           (f.user_id = c.owner_user_id) as by_owner, c.owner_key, c.contact_key
      from public.event_favourites f
      join candidates c on c.id = f.event_id
      left join auth.users u on u.id = f.user_id
     where f.created_at >= v_from_at and f.created_at <= p_now
    union all
    select a.event_id, a.created_at, 'going',
           coalesce('e:' || private.email_key(u.email), 'u:' || a.user_id::text),
           (a.user_id = c.owner_user_id), c.owner_key, c.contact_key
      from public.event_attendees a
      join candidates c on c.id = a.event_id
      left join auth.users u on u.id = a.user_id
     where a.created_at >= v_from_at and a.created_at <= p_now
       and not exists (select 1 from private.social_suspensions s where s.user_id = a.user_id)
    union all
    select r.event_id, r.created_at, case when r.total_cents > 0 then 'paid' else 'free' end,
           'e:' || private.email_key(r.buyer_email),
           false, c.owner_key, c.contact_key
      from public.orders r
      join candidates c on c.id = r.event_id
     where r.status = 'paid'
       and r.created_at >= v_from_at and r.created_at <= p_now
  ),
  engagements as (
    select g.event_id, (g.created_at at time zone 'Australia/Melbourne')::date as day, g.kind, g.person
      from engagements_all g
     where not coalesce(g.by_owner, false)
       and g.person is distinct from g.owner_key
       and g.person is distinct from g.contact_key
  ),
  people as (
    select event_id, count(distinct person)::integer as n
      from engagements
     where person is not null
     group by event_id
  ),
  activity as (
    -- A day on which the event's view cap was reached (record_view's flood
    -- marker) counts no views at all (trending_day_utility's p_flood).
    select v.event_id, v.day, sum(v.views)::integer as views,
           exists (select 1 from private.event_view_cap_days d where d.event_id = v.event_id and d.day = v.day) as flood,
           0 as favourites, 0 as going, 0 as paid_orders, 0 as free_orders
      from public.event_view_counts v
      join candidates c on c.id = v.event_id
     where v.day between v_from and v_today
     group by v.event_id, v.day
    union all
    select g.event_id, g.day, 0, false,
           (count(*) filter (where g.kind = 'favourite'))::integer,
           (count(*) filter (where g.kind = 'going'))::integer,
           (count(*) filter (where g.kind = 'paid'))::integer,
           (count(*) filter (where g.kind = 'free'))::integer
      from engagements g
     group by g.event_id, g.day
  ),
  days as (
    select event_id, day,
           private.trending_day_utility(sum(views)::integer, bool_or(flood), sum(favourites)::integer,
                                        sum(going)::integer, sum(paid_orders)::integer, sum(free_orders)::integer) as utility,
           v_today - day as age
      from activity
     group by event_id, day
  ),
  raw_scores as (
    select event_id, sum(utility * private.trending_decay(age)) as r_raw
      from days
     where age between 0 and 13
     group by event_id
  ),
  eligible_events as (
    select c.id, c.organiser_id, c.starts_at, c.boost, r.r_raw, p.n
      from candidates c
      join raw_scores r on r.event_id = c.id
      join people p on p.event_id = c.id
     where p.n >= 3
  ),
  prior_median as (
    select percentile_cont(0.5) within group (order by r_raw) as median from eligible_events
  ),
  scored as (
    select x.id, x.organiser_id, x.starts_at,
           private.trending_shrink(x.r_raw, x.n, p.median, 2)
             * private.trending_proximity(x.starts_at, p_now)
             * x.boost as score
      from eligible_events x cross join prior_median p
  ),
  per_organiser as (
    select s.*, row_number() over (partition by s.organiser_id order by s.score desc, s.starts_at, s.id) as organiser_rank
      from scored s
  ),
  top_events as (
    select p.id, p.score, row_number() over (order by p.score desc, p.starts_at, p.id) as rank
      from per_organiser p
     where p.organiser_rank <= 2
  ),
  inserted as (
    insert into private.trending_snapshot (rank, event_id, score, computed_at)
    select t.rank, t.id, t.score, p_now from top_events t where t.rank <= 24
    returning 1
  )
  select (select count(*)::integer from eligible_events), (select count(*)::integer from inserted)
    into eligible, ranked;
end;
$$;

revoke all on function private.refresh_trending(timestamptz) from public, anon, authenticated;


-- ===== 20261024000000_waitlist.sql =====
-- Waitlist for sold-out events (docs/architecture.md, "Waitlist"; contract
-- B-WL in docs/design/brand-direction-one.md §10).
--
--   * private.event_waitlist: one entry per (event, person), the person being
--     a normalised address (private.email_key, as for free tickets). The
--     address as typed is kept to send to. user_id is set only when a
--     signed-in member joined with their own verified email. An entry is on
--     the list once confirmed_at is set and until unsubscribed_at is.
--   * private.event_waitlist_tokens: SHA-256 hashes of emailed tokens, never
--     the tokens. `confirm` (a guest's join link, 24 hours, used once) and
--     `leave` (one per notification email sent, so every email's leave link
--     keeps working until the entry is deleted). Deleted with the entry.
--   * private.join_waitlist (a member's own verified email: on the list at
--     once), private.request_waitlist_join (anyone else: a pending entry and
--     a confirmation link, under a per-address hourly cap and platform-wide
--     hourly and daily caps), private.confirm_waitlist_join and
--     private.leave_waitlist (by token).
--   * private.notify_waitlist: when inventory frees up (a refund releasing
--     tickets, capacity raised, a ticket type added, the event published
--     again), queues "tickets are available again" emails in the email
--     outbox for people on the list, in join order (people not yet told
--     first), up to 3 per ticket left and at most 100 within a 12-hour
--     window per event, each person at most once per 12 hours, and at most
--     500 a day platform-wide. Called by deferred constraint triggers on
--     public.ticket_types and public.events, so it runs once the transaction
--     that freed the tickets commits, on its final state, whichever path
--     freed them (an API route, a database function or SQL by hand). It's
--     idempotent within the window: it only tops the number of people told
--     up to the target, so several triggers in one transaction notify once.
--     Pending orders hold no inventory (it's only taken in fulfil_order), so
--     an expired or cancelled checkout frees nothing and notifies nobody.
--   * private.email_outbox gains a second kind, `waitlist_available`, keyed
--     on the waitlist entry (order_id becomes nullable; a check ties each
--     kind to its key). private.claim_outbox_jobs claims every kind;
--     private.claim_email_jobs (the previous release's) now only claims
--     ticket emails, and private.resend_email_job only resends them (admins
--     see only ticket emails).
--   * private.purge_social_data also deletes waitlist entries 30 days after
--     their event ends, unconfirmed entries 8 days after their last link was
--     requested, entries 30 days after their person left, and confirmation
--     tokens a week after they expired. New OUT columns, hence drop + create;
--     `select private.purge_social_data()` (Supabase Cron) is unaffected.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC, every
-- function's search_path pinned.
--
-- Reversible, not destructive: drop the triggers and functions added here;
-- restore private.claim_email_jobs and private.resend_email_job from
-- 20261014000000_email_outbox.sql and private.purge_social_data from
-- 20261004000000_messaging_hardening.sql; delete the outbox's
-- `waitlist_available` jobs, drop its waitlist_entry_id column, indexes and
-- email_outbox_kind_key check, restore its kind check and set order_id not
-- null; drop tables private.event_waitlist_tokens and private.event_waitlist
-- (that discards every waitlist entry: personal data with nothing else
-- depending on it).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table private.event_waitlist (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- As typed (a plain address, lib/server/email-address.ts), to send to.
  email text not null check (char_length(email) between 3 and 254),
  -- private.email_key(email): one entry per person per event.
  email_key text not null check (char_length(email_key) between 3 and 254),
  -- The member who joined with their own verified email; null for guests.
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- On the list from confirmed_at (join order) until unsubscribed_at.
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  -- The last "tickets are available again" email queued, and how many.
  notified_at timestamptz,
  notify_count integer not null default 0 check (notify_count >= 0),
  constraint event_waitlist_event_person_key unique (event_id, email_key)
);

-- The list in join order, people not yet told first (notify_waitlist), the
-- organiser's aggregate count and a member's own status. Only entries on the list.
create index event_waitlist_queue_idx on private.event_waitlist (event_id, confirmed_at, id)
  where confirmed_at is not null and unsubscribed_at is null;
-- A guest address's confirmation links in the last hour, across events.
create index event_waitlist_email_key_idx on private.event_waitlist (email_key);
-- A member's own entries, and the auth.users cascade.
create index event_waitlist_user_idx on private.event_waitlist (user_id) where user_id is not null;
-- Retention: unconfirmed entries, and entries whose person left.
create index event_waitlist_unconfirmed_idx on private.event_waitlist (created_at) where confirmed_at is null;
create index event_waitlist_unsubscribed_idx on private.event_waitlist (unsubscribed_at) where unsubscribed_at is not null;
-- event_waitlist_event_person_key (event_id first) serves the events cascade
-- and the purge of ended events' entries.

create trigger event_waitlist_set_updated_at before update on private.event_waitlist
  for each row execute function public.set_updated_at();

create table private.event_waitlist_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  entry_id uuid not null references private.event_waitlist (id) on delete cascade,
  purpose text not null check (purpose in ('confirm', 'leave')),
  created_at timestamptz not null default now(),
  -- Confirmation links only (leave links last as long as the entry).
  expires_at timestamptz,
  used_at timestamptz,
  constraint event_waitlist_tokens_expiry check ((purpose = 'confirm') = (expires_at is not null))
);

-- An entry's tokens (the cascade), and the hourly count of confirmation links.
create index event_waitlist_tokens_entry_idx on private.event_waitlist_tokens (entry_id, purpose, created_at);
-- Retention: expired confirmation links.
create index event_waitlist_tokens_expiry_idx on private.event_waitlist_tokens (expires_at) where expires_at is not null;

alter table private.event_waitlist enable row level security;
alter table private.event_waitlist_tokens enable row level security;
revoke all on private.event_waitlist, private.event_waitlist_tokens from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The outbox's second kind of email
-- ---------------------------------------------------------------------------

alter table private.email_outbox
  alter column order_id drop not null,
  add column waitlist_entry_id uuid references private.event_waitlist (id) on delete cascade,
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (kind in ('ticket_email', 'waitlist_available')),
  -- Each kind has exactly its own key.
  add constraint email_outbox_kind_key check (
    case kind when 'ticket_email' then order_id is not null and waitlist_entry_id is null
              else waitlist_entry_id is not null and order_id is null end);

-- At most one waitlist email waiting or being sent per entry.
create unique index email_outbox_waitlist_active_key on private.email_outbox (waitlist_entry_id)
  where status in ('pending', 'sending');
-- The entry cascade, whatever the job's status.
create index email_outbox_waitlist_entry_idx on private.email_outbox (waitlist_entry_id)
  where waitlist_entry_id is not null;

-- As in 20261014000000_email_outbox.sql, for the previous release during a
-- deploy (it can only deliver ticket emails): ticket-email jobs only.
create or replace function private.claim_email_jobs(
  p_limit integer, p_lease interval, p_max_attempts integer, p_order_id text default null
) returns table (job_id bigint, job_order_id text, job_lease_token uuid, job_attempts integer)
language plpgsql
set search_path = ''
as $$
begin
  update private.email_outbox o
     set status = 'failed', lease_token = null, lease_expires_at = null,
         last_error = coalesce(o.last_error, 'the last attempt never finished')
   where o.kind = 'ticket_email'
     and o.status = 'sending' and o.lease_expires_at <= now() and o.attempts >= p_max_attempts
     and (p_order_id is null or o.order_id = p_order_id);

  return query
  with picked as (
    select o.id from private.email_outbox o
     where o.kind = 'ticket_email'
       and ((o.status = 'pending' and o.next_attempt_at <= now())
         or (o.status = 'sending' and o.lease_expires_at <= now()))
       and (p_order_id is null or o.order_id = p_order_id)
     order by o.next_attempt_at, o.id
     limit p_limit
     for update skip locked
  )
  update private.email_outbox o
     set status = 'sending', lease_token = gen_random_uuid(), lease_expires_at = now() + p_lease,
         attempts = o.attempts + 1
    from picked
   where o.id = picked.id
  returning o.id, o.order_id, o.lease_token, o.attempts;
end;
$$;

-- claim_email_jobs for every kind: leases up to p_limit due jobs (only
-- p_order_id's, and only of kind p_kind, when given), counting an attempt on
-- each. A lease that expired on the last allowed attempt is marked failed.
create function private.claim_outbox_jobs(
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
  returning o.id, o.kind, o.order_id, o.waitlist_entry_id, o.lease_token, o.attempts;
end;
$$;

-- As in 20261014000000_email_outbox.sql, for ticket emails only: admins list
-- and resend those (a waitlist email is 'not_found').
create or replace function private.resend_email_job(p_job_id bigint, p_min_interval interval, out result text, out order_id text)
language plpgsql
set search_path = ''
as $$
declare
  v_job private.email_outbox;
begin
  select * into v_job from private.email_outbox o where o.id = p_job_id and o.kind = 'ticket_email' for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  order_id := v_job.order_id;
  if v_job.status = 'sending' then
    result := 'in_progress';
    return;
  end if;
  if v_job.last_resend_at is not null and v_job.last_resend_at > now() - p_min_interval then
    result := 'too_soon';
    return;
  end if;
  update private.email_outbox o
     set status = 'pending', attempts = 0, next_attempt_at = now(), last_resend_at = now(), last_error = null
   where o.id = p_job_id;
  result := 'queued';
end;
$$;

-- ---------------------------------------------------------------------------
-- Joining
-- ---------------------------------------------------------------------------

-- Whether people can join p_event_id's waitlist now:
--   'open'          published, Sheltüh-ticketed, not ended, has ticket types
--                   and every one is sold out
--   'not_found'     no such event, or it isn't published
--   'external'      its tickets are sold on another site
--   'ended'         it has ended
--   'not_sold_out'  tickets are on sale (or it has no ticket types yet)
create function private.waitlist_join_state(p_event_id uuid) returns text
language sql
stable
set search_path = ''
as $$
  select case
           when e.id is null or e.status <> 'published' then 'not_found'
           when e.ticketing_mode <> 'sheltuh' then 'external'
           when e.ends_at <= now() then 'ended'
           when not exists (select 1 from public.ticket_types t where t.event_id = e.id) then 'not_sold_out'
           when exists (select 1 from public.ticket_types t
                         where t.event_id = e.id and t.quantity_sold < t.quantity_available) then 'not_sold_out'
           else 'open'
         end
    from (select 1) one
    left join public.events e on e.id = p_event_id;
$$;

-- A signed-in member joining with their own verified email (the API checks
-- that): on the list straight away. Returns 'joined', 'already_joined' (on
-- the list already: nothing changes) or a refusal from waitlist_join_state.
-- Someone who left, or never confirmed a guest link, joins again at the back
-- of the queue.
create function private.join_waitlist(p_event_id uuid, p_email text, p_user_id uuid) returns text
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
    if v_entry.user_id is null then
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

-- Anyone else: records (or reuses) a pending entry and the hash of the
-- confirmation token the API is about to email, valid for p_ttl. Returns:
--   'requested'               recorded: the API sends the link
--   'already_joined'          the address is on the list already: nothing
--                             recorded, no email (the API answers exactly as
--                             for 'requested')
--   'address_limited'         the address already had p_address_limit links
--                             (any event) in the last p_address_window:
--                             nothing recorded (the same answer again)
--   'platform_limited'        p_platform_limit links in this
--                             p_platform_window, platform-wide
--   'platform_daily_limited'  likewise for p_platform_daily_limit per
--                             p_platform_daily_window
--   or a refusal from waitlist_join_state (about the event, never the address).
-- The platform caps are checked (read-only) before anything about the
-- address, so their refusal is the same whichever address asks, and only
-- taken for a link that's about to be sent. An advisory lock on the address
-- serialises its requests, so concurrent ones can't slip under its cap.
create function private.request_waitlist_join(
  p_event_id uuid, p_email text, p_token_hash text, p_ttl interval,
  p_address_limit integer, p_address_window interval,
  p_platform_limit integer, p_platform_window interval,
  p_platform_daily_limit integer, p_platform_daily_window interval
) returns text
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
  if private.platform_rate_limit_used_up('waitlist_confirmations', p_platform_limit, p_platform_window) then
    return 'platform_limited';
  end if;
  if private.platform_rate_limit_used_up('waitlist_confirmations_daily', p_platform_daily_limit, p_platform_daily_window) then
    return 'platform_daily_limited';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('waitlist_links:' || v_key, 0));
  select * into v_entry from private.event_waitlist w
   where w.event_id = p_event_id and w.email_key = v_key
   for update;
  if found and v_entry.confirmed_at is not null and v_entry.unsubscribed_at is null then
    return 'already_joined';
  end if;
  if (select count(*) from private.event_waitlist_tokens t
        join private.event_waitlist w on w.id = t.entry_id
       where w.email_key = v_key and t.purpose = 'confirm'
         and t.created_at > now() - p_address_window) >= p_address_limit then
    return 'address_limited';
  end if;

  if not private.take_platform_rate_limit('waitlist_confirmations', p_platform_limit, p_platform_window) then
    return 'platform_limited';
  end if;
  if not private.take_platform_rate_limit('waitlist_confirmations_daily', p_platform_daily_limit, p_platform_daily_window) then
    return 'platform_daily_limited';
  end if;

  if v_entry.id is null then
    -- A member's join_waitlist (no address lock) can insert first: then it's
    -- on the list, and this link simply confirms it again.
    insert into private.event_waitlist (event_id, email, email_key)
    values (p_event_id, p_email, v_key)
    on conflict (event_id, email_key) do update set updated_at = now()
    returning * into v_entry;
  else
    -- Not on the list (never confirmed, or left): the newest address typed is the one to confirm.
    update private.event_waitlist set email = p_email where id = v_entry.id;
  end if;

  insert into private.event_waitlist_tokens (token_hash, entry_id, purpose, expires_at)
  values (p_token_hash, v_entry.id, 'confirm', now() + p_ttl);
  return 'requested';
end;
$$;

-- Confirms a guest's join by its link's token hash. Returns (result, event_id):
--   'joined'          on the list now (at the back of the queue)
--   'already_joined'  on the list already (an earlier click, or another link)
--   'not_found'       no such link
--   'expired'         past its expiry
--   'used'            confirmed before, and the person has left since
--   'closed'          the event isn't published, is ticketed elsewhere, or
--                     has ended (it needn't still be sold out)
-- event_id is set for every result but 'not_found'. Locks the token, then the entry.
create function private.confirm_waitlist_join(p_token_hash text, out result text, out event_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_token private.event_waitlist_tokens;
  v_entry private.event_waitlist;
begin
  select * into v_token from private.event_waitlist_tokens t
   where t.token_hash = p_token_hash and t.purpose = 'confirm'
   for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  select * into v_entry from private.event_waitlist w where w.id = v_token.entry_id for update;
  event_id := v_entry.event_id;
  if v_entry.confirmed_at is not null and v_entry.unsubscribed_at is null then
    result := 'already_joined';
    return;
  end if;
  if v_token.used_at is not null then
    result := 'used';
    return;
  end if;
  if v_token.expires_at <= now() then
    result := 'expired';
    return;
  end if;
  if not exists (select 1 from public.events e
                  where e.id = v_entry.event_id and e.status = 'published'
                    and e.ticketing_mode = 'sheltuh' and e.ends_at > now()) then
    result := 'closed';
    return;
  end if;
  update private.event_waitlist set confirmed_at = now(), unsubscribed_at = null where id = v_entry.id;
  update private.event_waitlist_tokens set used_at = now() where token_hash = p_token_hash;
  result := 'joined';
end;
$$;

-- Takes someone off the list by a leave link's token hash (each
-- notification email has its own). Idempotent. Returns (result, event_id):
-- 'left' (also when they'd left already) or 'not_found'.
create function private.leave_waitlist(p_token_hash text, out result text, out event_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_entry_id uuid;
begin
  select t.entry_id into v_entry_id from private.event_waitlist_tokens t
   where t.token_hash = p_token_hash and t.purpose = 'leave';
  if not found then
    result := 'not_found';
    return;
  end if;
  update private.event_waitlist w
     set unsubscribed_at = coalesce(w.unsubscribed_at, now())
   where w.id = v_entry_id
  returning w.event_id into event_id;
  result := case when event_id is null then 'not_found' else 'left' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifying
-- ---------------------------------------------------------------------------

-- Queues "tickets are available again" emails for p_event_id's waitlist,
-- if it has tickets left, and returns how many it queued. The target is 3
-- people per ticket left, at most 100, within a 12-hour window: people told
-- in the last 12 hours (still on the list) count towards it, and only the
-- shortfall is queued. So it's idempotent (calling it again changes nothing
-- until tickets are freed again or the window passes), and each person is
-- told at most once per 12 hours. Order: people never told first, then by
-- join time. Skips anyone with a paid order for the event (by normalised
-- address) or a waitlist email still waiting to go, and stops at 500 a day
-- platform-wide (they share the mail quota with ticket emails). Only for a
-- published, Sheltüh-ticketed event that hasn't ended. An advisory lock on
-- the event serialises calls. The event itself isn't locked.
create function private.notify_waitlist(p_event_id uuid) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_remaining bigint;
  v_target integer;
  v_recent integer;
  v_entry_id uuid;
  v_queued integer := 0;
begin
  if not exists (select 1 from public.events e
                  where e.id = p_event_id and e.status = 'published'
                    and e.ticketing_mode = 'sheltuh' and e.ends_at > now()) then
    return 0;
  end if;
  if not exists (select 1 from private.event_waitlist w
                  where w.event_id = p_event_id and w.confirmed_at is not null and w.unsubscribed_at is null) then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('waitlist_notify:' || p_event_id::text, 0));

  select coalesce(sum(greatest(t.quantity_available - t.quantity_sold, 0)), 0) into v_remaining
    from public.ticket_types t where t.event_id = p_event_id;
  if v_remaining = 0 then
    return 0;
  end if;
  v_target := least(v_remaining * 3, 100)::integer;
  select count(*)::integer into v_recent from private.event_waitlist w
   where w.event_id = p_event_id and w.confirmed_at is not null and w.unsubscribed_at is null
     and w.notified_at > now() - interval '12 hours';
  if v_recent >= v_target then
    return 0;
  end if;

  for v_entry_id in
    with buyers as (
      select distinct private.email_key(o.buyer_email) as email_key
        from public.orders o
       where o.event_id = p_event_id and o.status = 'paid' and o.buyer_email is not null
    )
    select w.id from private.event_waitlist w
     where w.event_id = p_event_id and w.confirmed_at is not null and w.unsubscribed_at is null
       and (w.notified_at is null or w.notified_at <= now() - interval '12 hours')
       and not exists (select 1 from buyers b where b.email_key = w.email_key)
       and not exists (select 1 from private.email_outbox j
                        where j.waitlist_entry_id = w.id and j.status in ('pending', 'sending'))
     order by w.notified_at is not null, w.confirmed_at, w.id
     limit v_target - v_recent
     for update of w
  loop
    if not private.take_platform_rate_limit('waitlist_notifications_daily', 500, interval '24 hours') then
      exit;
    end if;
    insert into private.email_outbox (kind, waitlist_entry_id) values ('waitlist_available', v_entry_id);
    update private.event_waitlist
       set notified_at = now(), notify_count = notify_count + 1
     where id = v_entry_id;
    v_queued := v_queued + 1;
  end loop;
  return v_queued;
end;
$$;

create function private.ticket_types_waitlist_release() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.notify_waitlist(new.event_id);
  return null;
end;
$$;

create function private.events_waitlist_release() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.notify_waitlist(new.id);
  return null;
end;
$$;

-- Deferred to commit, so notify_waitlist sees the transaction's final
-- state (a refund of several ticket types, an edit raising one and lowering
-- another) and runs only if that commits. Only on changes that free tickets:
-- a new ticket type with tickets, more left on one than before, and an event
-- published (again).
create constraint trigger ticket_types_waitlist_release_insert
  after insert on public.ticket_types
  deferrable initially deferred
  for each row
  when (new.quantity_available > new.quantity_sold)
  execute function private.ticket_types_waitlist_release();

create constraint trigger ticket_types_waitlist_release_update
  after update of quantity_available, quantity_sold on public.ticket_types
  deferrable initially deferred
  for each row
  when (new.quantity_available - new.quantity_sold > old.quantity_available - old.quantity_sold)
  execute function private.ticket_types_waitlist_release();

create constraint trigger events_waitlist_release
  after update of status on public.events
  deferrable initially deferred
  for each row
  when (new.status = 'published' and old.status is distinct from 'published')
  execute function private.events_waitlist_release();

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- As in 20261004000000_messaging_hardening.sql, plus the waitlist: entries 30
-- days after their event ended (as Who's Going opt-ins), unconfirmed entries
-- 8 days after their last link was requested (a 24-hour link, then a week),
-- entries 30 days after their person left (their leave links then stop
-- working: they're off the list already), and confirmation links a week
-- after they expired. Tokens and outbox jobs go with their entry.
drop function private.purge_social_data();

create function private.purge_social_data(
  out event_attendees_deleted integer, out rate_limits_deleted integer,
  out conversations_deleted integer, out user_reports_deleted integer,
  out conversation_pairs_deleted integer, out waitlist_entries_deleted integer,
  out waitlist_tokens_deleted integer)
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.purge_social_data() from public, anon, authenticated;
revoke all on function private.claim_outbox_jobs(integer, interval, integer, text, text) from public, anon, authenticated;
revoke all on function private.waitlist_join_state(uuid) from public, anon, authenticated;
revoke all on function private.join_waitlist(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.request_waitlist_join(uuid, text, text, interval, integer, interval, integer, interval, integer, interval)
  from public, anon, authenticated;
revoke all on function private.confirm_waitlist_join(text) from public, anon, authenticated;
revoke all on function private.leave_waitlist(text) from public, anon, authenticated;
revoke all on function private.notify_waitlist(uuid) from public, anon, authenticated;
revoke all on function private.ticket_types_waitlist_release() from public, anon, authenticated;
revoke all on function private.events_waitlist_release() from public, anon, authenticated;


-- ===== 20261024000100_member_profiles.sql =====
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


-- ===== 20261024000200_organiser_follows.sql =====
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


-- ===== 20261101000000_reserved_seating.sql =====
-- Reserved seating, part 1: seat maps (docs/SEATING_PLAN.md, docs/architecture.md
-- "Reserved seating"). Part 2 (20261101000100_seat_holds.sql) adds holds,
-- sales, and the checkout, fulfilment, refund and check-in changes.
--
--   * public.event_seat_maps: one optional map per event: the layout as the
--     API validated it (lib/seating/template.ts: sections → rows → seats,
--     coordinates, stage, focus point), its seat count, and a version. The
--     version comes from one sequence (private.seat_map_versions), so it is
--     never reused, not even by a map deleted and made again: the public
--     GET …/seat-map?v= is cached for a long time under it.
--   * public.event_seats: the map's seats as rows, derived from the layout in
--     the same statement that stores it (private.write_seat_map), so the two
--     can't disagree: id (the layout's, stable), position (map order: the
--     availability bitmap's bit), section, row and seat labels, ticket type
--     (its price tier: fees, orders, analytics, refunds and the waitlist all
--     keep working on ticket types), kind (standard, wheelchair, companion)
--     and blocked.
--   * ticket_types.seated: the tier has seats on the map. A seated tier's
--     quantity_available is always its number of unblocked seats: the
--     ticket_types_seated_capacity trigger sets it whenever the row is
--     written, whatever the API sends (so an editor's stale quantity can't
--     change it), and private.write_seat_map recomputes every tier after a map
--     change. The existing ticket_types_not_oversold check still applies.
--   * At most 5 ticket types (price tiers) on one map (manager decision,
--     docs/design/seating.md): private.write_seat_map refuses more
--     (check_violation, constraint event_seat_maps_max_tiers).
--   * The map is the organiser's to build while the event is a draft (or
--     rejected) and has never been approved (private.replace_seat_map,
--     private.delete_seat_map: 'frozen' otherwise, like the ticketing freeze).
--     After that only an admin can replace or remove it, only while the event
--     has no orders of any status, and it's logged
--     (private.admin_replace_seat_map: an `edited` entry with
--     changes.seatMap old and new {version, seatCount}).
--   * External ticketing has no map: event_seat_maps_sheltuh_only refuses one,
--     and switching an event to external (private.edit_event_draft, before
--     approval; private.admin_set_event_ticketing, without orders) deletes it
--     with the ticket types. A ticket type that has seats can't be removed
--     (event_seats_ticket_type_fkey, the API's 409), nor can a map with sold
--     seats (part 2's tickets foreign key).
--   * Every map write (insert, update, delete) bumps the event's updated_at
--     (event_seat_maps_touch_event), so an admin's PATCH /admin/events/{id}
--     made from a version loaded before a map change is stale (409), like a
--     photo change. Holds and sales (part 2) never touch the map row.
--   * Lock order (both parts): the event's seat advisory lock
--     (private.lock_event_seats), the order, the event, ticket types in id
--     order, seats in id order. Functions that lock the event row first
--     (edit_event_draft, admin_set_event_ticketing) never take the advisory
--     lock: holding the event row (for no key update) already excludes holds,
--     which share-lock the event row before touching any seat.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated (supabase-stubs.sql mirrors Supabase's default grants, which
-- are revoked below), every new or redefined function pins its search_path
-- and has execute revoked from PUBLIC, anon and authenticated.
--
-- Indexes: event_seat_maps_pkey (event_id) serves every map read and the
-- event's cascade; event_seats_pkey (event_id, id) serves seat lookups by id
-- and the per-event scans (availability, capacity); event_seats_position_key
-- (event_id, position) and event_seats_label_key (labels) are uniqueness
-- rules; event_seats_tier_idx (event_id, ticket_type_id) serves the
-- ticket_types foreign key's checks when a tier is removed, and each tier's
-- capacity count.
--
-- Reversible, not destructive of anything but seat maps: drop the triggers
-- and functions added here, restore private.edit_event_draft and
-- private.admin_set_event_ticketing from 20261022000000_external_ticketing.sql,
-- drop tables public.event_seats and public.event_seat_maps (every seat map
-- is lost: layouts only, no personal data; drop part 2 first), drop column
-- ticket_types.seated (seated tiers keep their last capacity) and the
-- sequence.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create sequence private.seat_map_versions as integer;
revoke all on sequence private.seat_map_versions from public, anon, authenticated;

alter table public.ticket_types add column seated boolean not null default false;

create table public.event_seat_maps (
  event_id uuid primary key references public.events (id) on delete cascade,
  -- From private.seat_map_versions: never reused.
  version integer not null check (version >= 1),
  -- The validated template (lib/seating/template.ts), as stored and served.
  layout jsonb not null constraint event_seat_maps_layout_object check (jsonb_typeof(layout) = 'object'),
  seat_count integer not null check (seat_count between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger event_seat_maps_set_updated_at before update on public.event_seat_maps
  for each row execute function public.set_updated_at();

create table public.event_seats (
  event_id uuid not null references public.event_seat_maps (event_id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  -- Map order, 0-based: the seat's bit in the availability bitmap.
  position integer not null check (position between 0 and 9999),
  section_label text not null check (char_length(section_label) between 1 and 40),
  -- Empty when the row has no name ("Box A · Seat 3").
  row_label text not null check (char_length(row_label) <= 10),
  seat_label text not null check (char_length(seat_label) between 1 and 10),
  ticket_type_id text not null,
  kind text not null default 'standard' check (kind in ('standard', 'wheelchair', 'companion')),
  -- Never sold (part 2 also refuses a hold or sale of a blocked seat).
  blocked boolean not null default false,
  primary key (event_id, id),
  constraint event_seats_position_key unique (event_id, position),
  constraint event_seats_label_key unique (event_id, section_label, row_label, seat_label),
  -- NO ACTION: removing a ticket type that seats use fails with this name (the API's 409).
  constraint event_seats_ticket_type_fkey foreign key (event_id, ticket_type_id)
    references public.ticket_types (event_id, id)
);

create index event_seats_tier_idx on public.event_seats (event_id, ticket_type_id);

alter table public.event_seat_maps enable row level security;
alter table public.event_seats enable row level security;
revoke all on public.event_seat_maps, public.event_seats from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- A seated tier's capacity is its unblocked seats, whatever was written.
create function private.ticket_types_seated_capacity() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.seated then
    new.quantity_available := (select count(*)::integer from public.event_seats s
                                 where s.event_id = new.event_id and s.ticket_type_id = new.id and not s.blocked);
  end if;
  return new;
end;
$$;

create trigger ticket_types_seated_capacity before insert or update of quantity_available, seated on public.ticket_types
  for each row execute function private.ticket_types_seated_capacity();

-- External ticketing has no seat map.
create function private.event_seat_maps_sheltuh_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.events e where e.id = new.event_id and e.ticketing_mode = 'external') then
    raise exception 'An event with external ticketing has no seat map.'
      using errcode = 'check_violation', constraint = 'event_seat_maps_sheltuh_only';
  end if;
  return new;
end;
$$;

create trigger event_seat_maps_sheltuh_only before insert on public.event_seat_maps
  for each row execute function private.event_seat_maps_sheltuh_only();

-- A map change is a change to the event (its updated_at, the admin editor's version).
create function private.event_seat_maps_touch_event() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- events_set_updated_at sets the time. When the event itself is being
  -- deleted (the map goes with it), its row is already gone: nothing to do.
  update public.events set updated_at = now()
   where id = case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  return null;
end;
$$;

create trigger event_seat_maps_touch_event after insert or update or delete on public.event_seat_maps
  for each row execute function private.event_seat_maps_touch_event();

-- ---------------------------------------------------------------------------
-- Writing a map (internal: callers hold the locks and check permission)
-- ---------------------------------------------------------------------------

-- The event's seat lock: first in every seat-changing path (see header).
create function private.lock_event_seats(p_event_id uuid) returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('event_seats:' || p_event_id::text, 0));
$$;

-- Stores p_layout (already validated by lib/seating/template.ts) as
-- p_event_id's map, replacing any other, and recomputes its ticket types'
-- seated flag and capacity. Returns 'saved', or 'unchanged' when the stored
-- layout is the same (nothing written, the version kept). The caller holds
-- the seat lock and the event row, and has checked that no seat is held or
-- sold (no orders).
create function private.write_seat_map(p_event_id uuid, p_layout jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' or jsonb_typeof(p_layout -> 'sections') <> 'array' then
    raise exception 'invalid seat map layout' using errcode = '22023';
  end if;
  if exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id and m.layout = p_layout) then
    return 'unchanged';
  end if;

  select count(*)::integer into v_count
    from jsonb_array_elements(p_layout -> 'sections') s (section)
   cross join lateral jsonb_array_elements(s.section -> 'rows') r (rw)
   cross join lateral jsonb_array_elements(r.rw -> 'seats') k (seat);

  -- Ticket types in id order (fulfil_order's order), before any seat.
  perform 1 from public.ticket_types t where t.event_id = p_event_id order by t.id for update;

  delete from public.event_seats s where s.event_id = p_event_id;
  insert into public.event_seat_maps (event_id, version, layout, seat_count)
  values (p_event_id, nextval('private.seat_map_versions')::integer, p_layout, v_count)
  on conflict (event_id) do update
     set version = excluded.version, layout = excluded.layout, seat_count = excluded.seat_count;

  insert into public.event_seats
    (event_id, id, position, section_label, row_label, seat_label, ticket_type_id, kind, blocked)
  select p_event_id,
         k.seat ->> 'id',
         (row_number() over (order by s.si, r.ri, k.ki))::integer - 1,
         s.section ->> 'label',
         r.rw ->> 'label',
         k.seat ->> 'label',
         k.seat ->> 'ticketTypeId',
         coalesce(k.seat ->> 'kind', 'standard'),
         coalesce((k.seat ->> 'blocked')::boolean, false)
    from jsonb_array_elements(p_layout -> 'sections') with ordinality as s (section, si)
   cross join lateral jsonb_array_elements(s.section -> 'rows') with ordinality as r (rw, ri)
   cross join lateral jsonb_array_elements(r.rw -> 'seats') with ordinality as k (seat, ki);

  -- At most 5 price tiers on a map (manager decision, docs/design/seating.md):
  -- buyers tell them apart by pattern, not colour.
  if (select count(distinct s.ticket_type_id) from public.event_seats s where s.event_id = p_event_id) > 5 then
    raise exception 'A seat map can use at most 5 ticket types.'
      using errcode = 'check_violation', constraint = 'event_seat_maps_max_tiers';
  end if;

  -- quantity_available is rewritten to itself so ticket_types_seated_capacity recomputes it.
  update public.ticket_types t
     set seated = exists (select 1 from public.event_seats s where s.event_id = t.event_id and s.ticket_type_id = t.id),
         quantity_available = t.quantity_available
   where t.event_id = p_event_id;
  return 'saved';
end;
$$;

-- Removes p_event_id's map (its seats go with it) and unmarks its seated
-- tiers, which keep their last capacity. Returns 'deleted', or 'unchanged'
-- when there was none. Same preconditions as write_seat_map.
create function private.clear_seat_map(p_event_id uuid) returns text
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id) then
    return 'unchanged';
  end if;
  perform 1 from public.ticket_types t where t.event_id = p_event_id order by t.id for update;
  delete from public.event_seat_maps m where m.event_id = p_event_id;
  update public.ticket_types t set seated = false where t.event_id = p_event_id and t.seated;
  return 'deleted';
end;
$$;

-- {version, seatCount} of p_event_id's map, or null: for log entries.
create function private.seat_map_summary(p_event_id uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('version', m.version, 'seatCount', m.seat_count)
    from public.event_seat_maps m where m.event_id = p_event_id;
$$;

-- ---------------------------------------------------------------------------
-- The organiser's map
-- ---------------------------------------------------------------------------

-- The organiser's save (PUT /api/events/{id}/seat-map). Returns:
--   'saved' / 'unchanged'  as write_seat_map
--   'not_found'            no such event, or not p_organiser_id's
--   'not_editable'         not draft or rejected
--   'frozen'               approved before: only an admin can change the map now
--   'external'             tickets are sold on another site
-- A seat whose ticket type isn't the event's raises foreign_key_violation
-- (event_seats_ticket_type_fkey; the API checked first, so only a race).
create function private.replace_seat_map(p_event_id uuid, p_organiser_id uuid, p_layout jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
begin
  perform private.lock_event_seats(p_event_id);
  select e.status, e.ticketing_mode into v_event
    from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'frozen';
  end if;
  if v_event.ticketing_mode = 'external' then
    return 'external';
  end if;
  return private.write_seat_map(p_event_id, p_layout);
end;
$$;

-- The organiser's removal (DELETE /api/events/{id}/seat-map): the same
-- checks; 'deleted', or 'unchanged' when there's none.
create function private.delete_seat_map(p_event_id uuid, p_organiser_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_status public.event_status;
begin
  perform private.lock_event_seats(p_event_id);
  select e.status into v_status
    from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'frozen';
  end if;
  return private.clear_seat_map(p_event_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- An admin's map change
-- ---------------------------------------------------------------------------

-- Replaces (p_layout) or removes (p_layout null) p_event_id's map, whatever
-- its status, while it has no orders of any status (a pending order may hold
-- seats). Logged `edited` by p_admin_id with p_reason (required) and
-- changes.seatMap {old, new}: each {version, seatCount} or null. Returns
-- 'saved', 'deleted', 'unchanged' (nothing written or logged), 'not_found',
-- 'external' (saving a map for an external event) or 'has_orders'.
create function private.admin_replace_seat_map(
  p_event_id uuid, p_admin_id uuid, p_layout jsonb, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_mode text;
  v_old jsonb;
  v_result text;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'a reason of 1 to 500 characters is required' using errcode = '22023';
  end if;
  perform private.lock_event_seats(p_event_id);
  select e.ticketing_mode into v_mode from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  if p_layout is not null and v_mode = 'external' then
    return 'external';
  end if;
  v_old := private.seat_map_summary(p_event_id);
  if (p_layout is null and v_old is null)
     or (p_layout is not null and exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id and m.layout = p_layout)) then
    return 'unchanged';
  end if;
  if exists (select 1 from public.orders o where o.event_id = p_event_id) then
    return 'has_orders';
  end if;

  if p_layout is null then
    v_result := private.clear_seat_map(p_event_id);
  else
    v_result := private.write_seat_map(p_event_id, p_layout);
  end if;

  insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
  values (p_event_id, 'edited', p_admin_id, btrim(p_reason),
          jsonb_build_object('seatMap', jsonb_build_object('old', v_old, 'new', private.seat_map_summary(p_event_id))));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Switching to external ticketing removes the map
-- ---------------------------------------------------------------------------

-- As in 20261022000000_external_ticketing.sql, plus: switching to external
-- removes the seat map before the ticket types (its seats reference them).
-- Only a never-approved event's ticketing can change here, so it has no
-- orders and no seat is held or sold. The event row is locked first; no
-- seat advisory lock (see the header).
create or replace function private.edit_event_draft(
  p_event_id uuid, p_organiser_id uuid, p_fields jsonb, p_ticket_types jsonb
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_mode text := coalesce(p_fields ->> 'ticketingMode', 'sheltuh');
  v_url text := p_fields ->> 'externalTicketUrl';
  v_free boolean := coalesce((p_fields ->> 'externalFree')::boolean, false);
begin
  select e.status, e.ticketing_mode, e.external_ticket_url into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if (v_event.ticketing_mode is distinct from v_mode or v_event.external_ticket_url is distinct from v_url)
     and exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'ticketing_frozen';
  end if;

  if v_mode = 'external' then
    perform private.clear_seat_map(p_event_id);
    perform private.replace_ticket_types(p_event_id, '[]'::jsonb);
  end if;

  update public.events set
    title = p_fields ->> 'title',
    description = p_fields ->> 'description',
    category = (p_fields ->> 'category')::public.event_category,
    venue_name = p_fields ->> 'venueName',
    venue_address = p_fields ->> 'venueAddress',
    suburb = p_fields ->> 'suburb',
    starts_at = (p_fields ->> 'startsAt')::timestamptz,
    ends_at = (p_fields ->> 'endsAt')::timestamptz,
    ticketing_mode = v_mode,
    external_ticket_url = v_url,
    external_free = v_free,
    is_free = case when v_mode = 'external' then v_free else is_free end
  where id = p_event_id;

  if v_mode <> 'external' then
    perform private.replace_ticket_types(p_event_id, p_ticket_types);
  end if;
  return 'updated';
end;
$$;

-- As in 20261022000000_external_ticketing.sql, plus: switching to external
-- (which needs an event without orders) removes the seat map before the
-- ticket types, and the entry's details record it (seatMap {old, new: null}).
create or replace function private.admin_set_event_ticketing(
  p_event_id uuid, p_admin_id uuid, p_mode text, p_url text, p_free boolean, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_details jsonb := '{}'::jsonb;
  v_map jsonb;
begin
  select e.ticketing_mode, e.external_ticket_url, e.external_free into v_event
    from public.events e where e.id = p_event_id
     for no key update;
  if not found then
    return 'not_found';
  end if;

  if v_event.ticketing_mode is distinct from p_mode then
    v_details := v_details || jsonb_build_object('ticketingMode', jsonb_build_object('old', v_event.ticketing_mode, 'new', p_mode));
  end if;
  if v_event.external_ticket_url is distinct from p_url then
    v_details := v_details
      || jsonb_build_object('externalTicketUrl', jsonb_build_object('old', v_event.external_ticket_url, 'new', p_url));
  end if;
  if v_event.external_free is distinct from p_free then
    v_details := v_details || jsonb_build_object('externalFree', jsonb_build_object('old', v_event.external_free, 'new', p_free));
  end if;
  if v_details = '{}'::jsonb then
    return 'unchanged';
  end if;

  if p_mode = 'external' and v_event.ticketing_mode <> 'external' then
    if exists (select 1 from public.orders o where o.event_id = p_event_id) then
      return 'has_orders';
    end if;
    v_map := private.seat_map_summary(p_event_id);
    if v_map is not null then
      perform private.clear_seat_map(p_event_id);
      v_details := v_details || jsonb_build_object('seatMap', jsonb_build_object('old', v_map, 'new', null));
    end if;
    delete from public.ticket_types t where t.event_id = p_event_id;
  end if;

  update public.events e set
    ticketing_mode = p_mode,
    external_ticket_url = p_url,
    external_free = p_free,
    is_free = case when p_mode = 'external' then p_free
                   else exists (select 1 from public.ticket_types t where t.event_id = p_event_id)
                        and not exists (select 1 from public.ticket_types t where t.event_id = p_event_id and t.price_cents > 0)
              end
  where e.id = p_event_id;

  insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
  values (p_event_id, 'ticketing_changed', p_admin_id, p_reason, v_details);
  return 'updated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.ticket_types_seated_capacity() from public, anon, authenticated;
revoke all on function private.event_seat_maps_sheltuh_only() from public, anon, authenticated;
revoke all on function private.event_seat_maps_touch_event() from public, anon, authenticated;
revoke all on function private.lock_event_seats(uuid) from public, anon, authenticated;
revoke all on function private.write_seat_map(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.clear_seat_map(uuid) from public, anon, authenticated;
revoke all on function private.seat_map_summary(uuid) from public, anon, authenticated;
revoke all on function private.replace_seat_map(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.delete_seat_map(uuid, uuid) from public, anon, authenticated;
revoke all on function private.admin_replace_seat_map(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function private.edit_event_draft(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.admin_set_event_ticketing(uuid, uuid, text, text, boolean, text)
  from public, anon, authenticated;


-- ===== 20261101000100_seat_holds.sql =====
-- Reserved seating, part 2: holds and sales (docs/SEATING_PLAN.md,
-- docs/architecture.md "Reserved seating"; part 1 is
-- 20261101000000_reserved_seating.sql).
--
--   * event_seats gains hold_order_id / hold_expires_at (a pending order's
--     hold) and sold_order_id (the paid order that owns it). One owner per
--     seat: never held and sold at once (event_seats_one_owner), never held
--     or sold while blocked (event_seats_blocked_unsold).
--   * orders.seat_ids: the seats a seated order is for (1 to 10, set when the
--     order is made, never changed). It's what fulfilment and refunds act on:
--     a hold can expire and go to someone else, the order still knows what it
--     asked for.
--   * tickets.seat_id: the ticket's seat. Its foreign key
--     (ticket_seats_sold_fkey: event, seat, order, ticket type) points at
--     event_seats (event_id, id, sold_order_id, ticket_type_id), so a ticket
--     can only name a seat sold to its own order, in its own tier; unique per
--     event (tickets_seat_key). A full refund clears the ticket's seat (and
--     then the seat's sale): the order's seat_ids keeps the history.
--   * private.hold_seats: a paid seated checkout's pending order and its
--     holds, in one step, all or nothing: under the event's seat lock, one
--     hit on the event's hold-attempt counter (take_event_rate_limit, bucket
--     'seat_holds': the API passes 120 per 10 minutes); then the order, the
--     event (published, Sheltüh-ticketed), the map version, every seat free
--     (unknown, sold, blocked or held by an unexpired hold: refused, with the
--     ids), the order's lines matching its seats' tiers, and the event's cap
--     on seats held at once (the larger of 20 and 30% of its unblocked
--     seats). Any refusal writes nothing but the attempt. Holds last p_hold
--     (35 minutes) and expire lazily: an expired hold is just free.
--   * private.release_seat_holds: a pending order marked failed and its holds
--     cleared (a Stripe error at checkout, the buyer cancelling, a Stripe
--     session expiring or an async payment failing).
--   * private.fulfil_order: a seated order takes its seats (free, or held by
--     itself, or held by an expired hold) with its inventory, and its
--     tickets get them; a seat gone elsewhere is the oversold path (refund),
--     which also clears the order's holds. Seated tiers are only ever sold
--     with seats: an order whose lines in seated tiers don't match its seats
--     exactly is refused the same way.
--   * private.record_payment_refund: a full refund of a seated order also
--     frees its seats (the ticket types' quantity_sold goes down as before,
--     so the waitlist is told as for any freed tickets).
--   * Free seated orders: private.place_free_seated_order (a member's own
--     verified email, issued at once through fulfil_order) and
--     private.request_free_seated_order (a guest: the pending order records
--     its seats but holds nothing until the emailed link is confirmed).
--     private.confirm_free_order now says 'seats_taken' when the seats went
--     to someone else in between.
--   * private.check_in_ticket also returns the ticket's seat (section, row,
--     seat, kind).
--
-- Lock order, everywhere: the event's seat advisory lock
-- (private.lock_event_seats), the order, the event, ticket types in id order,
-- seats in id order. Every function that changes a seated order's seats
-- takes the advisory lock before the order row (reading the order's event
-- first without a lock: event_id and seat_ids never change). A GA order
-- never takes it.
--
-- Access model as everywhere else: no new table; every new or redefined
-- function pins its search_path and has execute revoked from PUBLIC, anon
-- and authenticated.
--
-- Indexes: event_seats_hold_order_idx and event_seats_sold_order_idx
-- (partial, not null) serve the orders foreign keys and every "this order's
-- seats" lookup (release, refund, fulfilment); event_seats_active_holds_idx
-- (event_id, hold_expires_at) where held serves the hold cap's count.
-- tickets_seat_key (event_id, seat_id) also serves the seat lookups from
-- tickets.
--
-- Reversible: drop the functions added here; restore private.fulfil_order
-- from 20261014000000_email_outbox.sql, private.record_payment_refund from
-- 20261020000000_payment_refunds.sql, private.confirm_free_order from
-- 20261017000000_free_order_caps.sql and private.check_in_ticket from
-- 20261021130000_check_in_followups.sql (drop and create: its result columns
-- change); drop the new columns, constraints and indexes. Dropping
-- tickets.seat_id, orders.seat_ids and the event_seats sale columns discards
-- which seat each ticket was for: export them first if any seated event has
-- sold.

-- ---------------------------------------------------------------------------
-- Columns and constraints
-- ---------------------------------------------------------------------------

alter table public.event_seats
  add column hold_order_id text references public.orders (id) on delete set null,
  add column hold_expires_at timestamptz,
  add column sold_order_id text references public.orders (id),
  add constraint event_seats_one_owner check (sold_order_id is null or hold_order_id is null),
  add constraint event_seats_hold_expiry check (hold_order_id is null or hold_expires_at is not null),
  add constraint event_seats_blocked_unsold check (not blocked or (sold_order_id is null and hold_order_id is null)),
  add constraint event_seats_sold_ticket_key unique (event_id, id, sold_order_id, ticket_type_id);

create index event_seats_hold_order_idx on public.event_seats (hold_order_id) where hold_order_id is not null;
create index event_seats_sold_order_idx on public.event_seats (sold_order_id) where sold_order_id is not null;
create index event_seats_active_holds_idx on public.event_seats (event_id, hold_expires_at) where hold_order_id is not null;

alter table public.orders
  add column seat_ids text[],
  add constraint orders_seat_ids_check check (seat_ids is null or cardinality(seat_ids) between 1 and 10);

alter table public.tickets
  add column seat_id text,
  add constraint tickets_seat_key unique (event_id, seat_id),
  add constraint ticket_seats_sold_fkey foreign key (event_id, seat_id, order_id, ticket_type_id)
    references public.event_seats (event_id, id, sold_order_id, ticket_type_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The ids among p_seat_ids that p_order_id can't have: not a seat of the
-- event, blocked, sold, or held by another order's unexpired hold. Sorted.
create function private.unavailable_seats(p_event_id uuid, p_seat_ids text[], p_order_id text) returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.id order by x.id), '{}'::text[])
    from unnest(p_seat_ids) as x (id)
    left join public.event_seats s on s.event_id = p_event_id and s.id = x.id
   where s.id is null or s.blocked or s.sold_order_id is not null
      or (s.hold_order_id is not null and s.hold_order_id is distinct from p_order_id and s.hold_expires_at > now());
$$;

-- Whether an order's lines match its seats: for every seated ticket type,
-- the line's quantity is exactly the number of the order's seats in that
-- tier; every seat is one of the event's, in a tier the order has a line
-- for; no seat twice. With no seats, no line may be for a seated tier.
create function private.order_seats_match(p_event_id uuid, p_line_items jsonb, p_seat_ids text[]) returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_seat_ids is null or cardinality(p_seat_ids) = (select count(distinct x) from unnest(p_seat_ids) x))
     and coalesce(cardinality(p_seat_ids), 0)
           = (select count(*) from public.event_seats s where s.event_id = p_event_id and s.id = any(coalesce(p_seat_ids, '{}'::text[])))
     and not exists (
       select 1
         from (select li.value ->> 'ticketTypeId' as tier, sum((li.value ->> 'quantity')::integer)::integer as qty
                 from jsonb_array_elements(p_line_items) li
                 join public.ticket_types t on t.event_id = p_event_id and t.id = li.value ->> 'ticketTypeId'
                where t.seated
                group by 1) l
         full join (select s.ticket_type_id as tier, count(*)::integer as n
                      from public.event_seats s
                     where s.event_id = p_event_id and s.id = any(coalesce(p_seat_ids, '{}'::text[]))
                     group by 1) k using (tier)
        where l.qty is distinct from k.n);
$$;

-- ---------------------------------------------------------------------------
-- Holding seats (a paid seated checkout)
-- ---------------------------------------------------------------------------

-- Creates p_order_id (pending, with p_seat_ids) and holds its seats until
-- now() + p_hold, all or nothing. p_line_items and the totals are the API's
-- priced snapshot (prices from the database, a line per tier). Returns:
--   result 'held'               done: hold_expires_at is set
--          'rate_limited'       over p_attempt_limit hold attempts per
--                               p_attempt_window for the event: nothing written
--          'not_on_sale'        the event isn't published or is external
--          'version'            the map isn't version p_map_version (or is gone)
--          'seats_unavailable'  unavailable_seat_ids can't be had
--          'tier_mismatch'      the lines don't match the seats' tiers
--          'hold_cap'           the event already has too many seats held
--                               (more than the larger of p_cap_min and
--                               p_cap_share of its unblocked seats with these)
-- Every refusal but 'rate_limited' leaves only the attempt counted. An
-- external event's order is refused by orders_sheltuh_only (check_violation,
-- the API's 409), and nothing is kept.
create function private.hold_seats(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_subtotal_cents integer, p_buyer_fee_cents integer, p_total_cents integer, p_application_fee_cents integer,
  p_buyer_email text, p_tracking_code text, p_map_version integer, p_seat_ids text[], p_hold interval,
  p_attempt_limit integer, p_attempt_window interval, p_cap_min integer, p_cap_share numeric,
  out result text, out hold_expires_at timestamptz, out unavailable_seat_ids text[]
)
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_version integer;
  v_unavailable text[];
  v_held integer;
  v_sellable integer;
begin
  if p_seat_ids is null or cardinality(p_seat_ids) not between 1 and 10
     or cardinality(p_seat_ids) <> (select count(distinct x) from unnest(p_seat_ids) x) then
    raise exception 'between 1 and 10 distinct seats' using errcode = '22023';
  end if;

  perform private.lock_event_seats(p_event_id);
  if not private.take_event_rate_limit(p_event_id, 'seat_holds', p_attempt_limit, p_attempt_window) then
    result := 'rate_limited';
    return;
  end if;

  begin
    -- The order (orders_sheltuh_only share-locks the event row).
    insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
       buyer_fee_cents, total_cents, application_fee_cents, buyer_email, tracking_code, seat_ids)
    values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, p_subtotal_cents,
       p_buyer_fee_cents, p_total_cents, p_application_fee_cents, p_buyer_email,
       (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
       p_seat_ids);

    select e.status, e.ticketing_mode into v_event from public.events e where e.id = p_event_id for share;
    if v_event.status is distinct from 'published' or v_event.ticketing_mode is distinct from 'sheltuh' then
      raise exception 'not on sale' using errcode = 'SH404';
    end if;
    select m.version into v_version from public.event_seat_maps m where m.event_id = p_event_id;
    if v_version is distinct from p_map_version then
      raise exception 'map version' using errcode = 'SH412';
    end if;

    -- Seats in id order.
    perform 1 from public.event_seats s
     where s.event_id = p_event_id and s.id = any(p_seat_ids)
     order by s.id
       for update;
    v_unavailable := private.unavailable_seats(p_event_id, p_seat_ids, p_order_id);
    if cardinality(v_unavailable) > 0 then
      unavailable_seat_ids := v_unavailable;
      raise exception 'seats unavailable' using errcode = 'SH409';
    end if;
    if not private.order_seats_match(p_event_id, p_line_items, p_seat_ids) then
      raise exception 'lines and seats differ' using errcode = 'SH422';
    end if;

    -- Anti-hoarding: seats held right now (unexpired), against the larger of
    -- p_cap_min and p_cap_share of the unblocked seats (the seated tiers'
    -- capacity).
    select count(*)::integer into v_held from public.event_seats s
     where s.event_id = p_event_id and s.hold_order_id is not null and s.hold_expires_at > now();
    select coalesce(sum(t.quantity_available), 0)::integer into v_sellable
      from public.ticket_types t where t.event_id = p_event_id and t.seated;
    if v_held + cardinality(p_seat_ids) > greatest(p_cap_min, floor(v_sellable * p_cap_share)::integer) then
      raise exception 'hold cap' using errcode = 'SH429';
    end if;

    update public.event_seats s
       set hold_order_id = p_order_id, hold_expires_at = now() + p_hold
     where s.event_id = p_event_id and s.id = any(p_seat_ids);
    hold_expires_at := now() + p_hold;
    result := 'held';
  exception
    -- Each undoes the order and anything locked or written in this block.
    when sqlstate 'SH404' then result := 'not_on_sale';
    when sqlstate 'SH412' then result := 'version';
    when sqlstate 'SH409' then result := 'seats_unavailable';
    when sqlstate 'SH422' then result := 'tier_mismatch';
    when sqlstate 'SH429' then result := 'hold_cap';
  end;
end;
$$;

-- Releases p_order_id's holds and marks it failed, if it's still pending.
-- Returns 'released', 'not_found', or the order's status when it isn't
-- pending ('paid', 'failed', ...): then nothing changes.
create function private.release_seat_holds(p_order_id text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_order record;
begin
  select o.event_id into v_event_id from public.orders o where o.id = p_order_id;
  if not found then
    return 'not_found';
  end if;
  perform private.lock_event_seats(v_event_id);
  select o.status, o.seat_ids into v_order from public.orders o where o.id = p_order_id for update;
  if v_order.status <> 'pending' then
    return v_order.status::text;
  end if;
  update public.orders set status = 'failed' where id = p_order_id;
  if v_order.seat_ids is not null then
    perform 1 from public.event_seats s
     where s.event_id = v_event_id and s.hold_order_id = p_order_id
     order by s.id
       for update;
    update public.event_seats s set hold_order_id = null, hold_expires_at = null
     where s.event_id = v_event_id and s.hold_order_id = p_order_id;
  end if;
  return 'released';
end;
$$;

-- ---------------------------------------------------------------------------
-- Fulfilment
-- ---------------------------------------------------------------------------

-- As in 20261014000000_email_outbox.sql (inventory, tickets, paid, the
-- ticket email; sold out or unpublished: oversold_refund_required), plus
-- seats: a seated order takes the event's seat lock before the order row,
-- every seat must be one it can have (free, held by itself, or an expired
-- hold), its lines must match its seats (and no order may buy a seated tier
-- without seats), and each ticket gets one of its tier's seats. The oversold
-- path also clears the order's holds.
create or replace function private.fulfil_order(
  p_order_id text, p_buyer_email text, p_payment_intent_id text, p_tickets jsonb
) returns public.order_status
language plpgsql
set search_path = ''
as $$
declare
  v_pre record;
  v_order public.orders;
  v_line jsonb;
  v_event_status public.event_status;
  v_taken integer;
begin
  -- event_id and seat_ids never change: safe to read before the lock order starts.
  select o.event_id, o.seat_ids into v_pre from public.orders o where o.id = p_order_id;
  if not found then
    return null;
  end if;
  if v_pre.seat_ids is not null then
    perform private.lock_event_seats(v_pre.event_id);
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return null;
  end if;
  if v_order.status <> 'pending' then
    return v_order.status;
  end if;

  begin
    select status into v_event_status from public.events where id = v_order.event_id for share;
    if v_event_status is distinct from 'published' then
      raise exception 'event % is not published', v_order.event_id using errcode = 'SH409';
    end if;

    -- Fixed lock order across concurrent orders avoids deadlocks.
    for v_line in
      select value from jsonb_array_elements(v_order.line_items) order by value ->> 'ticketTypeId'
    loop
      update public.ticket_types
      set quantity_sold = quantity_sold + (v_line ->> 'quantity')::integer
      where event_id = v_order.event_id
        and id = v_line ->> 'ticketTypeId'
        and quantity_sold + (v_line ->> 'quantity')::integer <= quantity_available;

      if not found then
        raise exception 'sold out: %', v_line ->> 'ticketTypeId' using errcode = 'SH409';
      end if;
    end loop;

    -- Seated tiers are sold only with their seats.
    if (v_order.seat_ids is not null
        or exists (select 1 from public.ticket_types t where t.event_id = v_order.event_id and t.seated))
       and not private.order_seats_match(v_order.event_id, v_order.line_items, v_order.seat_ids) then
      raise exception 'order % lines and seats differ', p_order_id using errcode = 'SH409';
    end if;

    if v_order.seat_ids is null then
      insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name)
      select t ->> 'ticketCode', p_order_id, v_order.event_id, t ->> 'ticketTypeId', t ->> 'ticketTypeName'
      from jsonb_array_elements(p_tickets) t;
    else
      perform 1 from public.event_seats s
       where s.event_id = v_order.event_id and s.id = any(v_order.seat_ids)
       order by s.id
         for update;
      update public.event_seats s
         set sold_order_id = p_order_id, hold_order_id = null, hold_expires_at = null
       where s.event_id = v_order.event_id and s.id = any(v_order.seat_ids)
         and not s.blocked and s.sold_order_id is null
         and (s.hold_order_id is null or s.hold_order_id = p_order_id or s.hold_expires_at <= now());
      get diagnostics v_taken = row_count;
      if v_taken <> cardinality(v_order.seat_ids) then
        raise exception 'seats of order % are taken', p_order_id using errcode = 'SH409';
      end if;

      -- The n-th ticket of a tier (as sent) gets the n-th seat of that tier (map order).
      insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name, seat_id)
      select t.ticket ->> 'ticketCode', p_order_id, v_order.event_id, t.ticket ->> 'ticketTypeId',
             t.ticket ->> 'ticketTypeName', k.id
        from (select x.ticket, row_number() over (partition by x.ticket ->> 'ticketTypeId' order by x.ord) as n
                from jsonb_array_elements(p_tickets) with ordinality as x (ticket, ord)) t
        left join (select s.id, s.ticket_type_id, row_number() over (partition by s.ticket_type_id order by s.position) as n
                     from public.event_seats s
                    where s.event_id = v_order.event_id and s.sold_order_id = p_order_id) k
          on k.ticket_type_id = t.ticket ->> 'ticketTypeId' and k.n = t.n;
    end if;

    update public.orders
    set status = 'paid',
        buyer_email = coalesce(p_buyer_email, buyer_email),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;

    -- The ticket email, committed with the payment: it can't be lost, and a
    -- redelivered webhook never reaches here (the order isn't pending).
    if coalesce(p_buyer_email, v_order.buyer_email) is not null then
      insert into private.email_outbox (kind, order_id) values ('ticket_email', p_order_id)
      on conflict (order_id, kind) do nothing;
    end if;
    return 'paid';
  exception when sqlstate 'SH409' then
    -- Everything in this block (partial reservations included) is rolled back.
    update public.orders
    set status = 'oversold_refund_required',
        buyer_email = coalesce(p_buyer_email, buyer_email),
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;
    if v_order.seat_ids is not null then
      perform 1 from public.event_seats s
       where s.event_id = v_order.event_id and s.hold_order_id = p_order_id
       order by s.id
         for update;
      update public.event_seats s set hold_order_id = null, hold_expires_at = null
       where s.event_id = v_order.event_id and s.hold_order_id = p_order_id;
    end if;
    return 'oversold_refund_required';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

-- As in 20261020000000_payment_refunds.sql, plus: a full refund of a seated
-- order frees its seats (the tickets' seat first, then the seats' sale, in id
-- order), after the seat lock (taken before the order row).
create or replace function private.record_payment_refund(
  p_payment_intent_id text, p_amount_refunded_cents integer, p_fully_refunded boolean,
  out result text, out order_id text
)
language plpgsql
set search_path = ''
as $$
declare
  v_pre record;
  v_order public.orders;
  v_line jsonb;
begin
  if p_amount_refunded_cents is null or p_amount_refunded_cents < 0 or p_fully_refunded is null then
    raise exception 'invalid refund amount or flag' using errcode = '22023';
  end if;

  select o.event_id, o.seat_ids into v_pre from public.orders o
   where o.stripe_payment_intent_id = p_payment_intent_id
   order by o.id
   limit 1;
  if found and v_pre.seat_ids is not null then
    perform private.lock_event_seats(v_pre.event_id);
  end if;

  select * into v_order from public.orders o
   where o.stripe_payment_intent_id = p_payment_intent_id
   order by o.id
   limit 1
   for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  order_id := v_order.id;

  if v_order.status <> 'paid' then
    result := 'unchanged';
    return;
  end if;

  if p_fully_refunded then
    for v_line in
      select value from jsonb_array_elements(v_order.line_items) order by value ->> 'ticketTypeId'
    loop
      update public.ticket_types
         set quantity_sold = greatest(quantity_sold - (v_line ->> 'quantity')::integer, 0)
       where event_id = v_order.event_id
         and id = v_line ->> 'ticketTypeId';
    end loop;

    if v_order.seat_ids is not null then
      update public.tickets t set seat_id = null where t.order_id = v_order.id and t.seat_id is not null;
      perform 1 from public.event_seats s
       where s.event_id = v_order.event_id and s.sold_order_id = v_order.id
       order by s.id
         for update;
      update public.event_seats s set sold_order_id = null
       where s.event_id = v_order.event_id and s.sold_order_id = v_order.id;
    end if;

    update public.orders
       set status = 'refunded',
           amount_refunded_cents = greatest(amount_refunded_cents, p_amount_refunded_cents)
     where id = v_order.id;
    result := 'refunded';
    return;
  end if;

  if p_amount_refunded_cents <= v_order.amount_refunded_cents then
    result := 'unchanged';
    return;
  end if;
  update public.orders set amount_refunded_cents = p_amount_refunded_cents where id = v_order.id;
  result := 'partial';
end;
$$;

-- ---------------------------------------------------------------------------
-- Free seated orders
-- ---------------------------------------------------------------------------

-- private.place_free_order (20261014000100_free_order_protection.sql) for a
-- seated order: the event's seat lock first, then the same steps with the
-- order's seats recorded, so fulfil_order takes them. Returns 'paid',
-- 'person_event_limit', 'member_daily_limit', 'seats_unavailable' (a seat
-- is gone: nothing written) or 'sold_out'.
create function private.place_free_seated_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_user_id uuid, p_tickets jsonb,
  p_person_limit integer, p_daily_limit integer, p_daily_window interval, p_seat_ids text[]
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_key text := private.email_key(p_buyer_email);
  v_quantity integer := jsonb_array_length(p_tickets);
begin
  if p_seat_ids is null or cardinality(p_seat_ids) = 0 then
    raise exception 'seats required' using errcode = '22023';
  end if;
  perform private.lock_event_seats(p_event_id);
  if private.lock_free_allowance(p_event_id, v_key) + v_quantity > p_person_limit then
    perform private.record_free_order_refusal('person_event_limit');
    return 'person_event_limit';
  end if;

  begin
    if not private.take_rate_limit(p_user_id, 'free_claims', p_daily_limit, p_daily_window) then
      raise exception 'daily free claims' using errcode = 'SH429';
    end if;
    insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
       buyer_fee_cents, total_cents, application_fee_cents, buyer_email, buyer_email_key, tracking_code, seat_ids)
    values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, 0, 0, 0, 0,
       p_buyer_email, v_key,
       (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
       p_seat_ids);
    if private.fulfil_order(p_order_id, null, null, p_tickets) is distinct from 'paid' then
      raise exception 'sold out' using errcode = 'SH409';
    end if;
  exception
    when sqlstate 'SH429' then
      perform private.record_free_order_refusal('member_daily_limit');
      return 'member_daily_limit';
    when sqlstate 'SH409' then
      if cardinality(private.unavailable_seats(p_event_id, p_seat_ids, p_order_id)) > 0 then
        return 'seats_unavailable';
      end if;
      return 'sold_out';
  end;
  return 'paid';
end;
$$;

-- private.request_free_order (15 arguments, 20261017000000_free_order_caps.sql),
-- then the order's seats recorded on it, in one step. Nothing is held: the
-- seats are only taken if they're still free when the link is confirmed.
create function private.request_free_seated_order(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_buyer_email text, p_tracking_code text, p_token_hash text, p_ttl interval,
  p_address_limit integer, p_address_window interval, p_platform_limit integer, p_platform_window interval,
  p_platform_daily_limit integer, p_platform_daily_window interval, p_seat_ids text[]
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_result text;
begin
  if p_seat_ids is null or cardinality(p_seat_ids) = 0 then
    raise exception 'seats required' using errcode = '22023';
  end if;
  v_result := private.request_free_order(
    p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items,
    p_buyer_email, p_tracking_code, p_token_hash, p_ttl,
    p_address_limit, p_address_window, p_platform_limit, p_platform_window,
    p_platform_daily_limit, p_platform_daily_window);
  if v_result = 'requested' then
    update public.orders set seat_ids = p_seat_ids where id = p_order_id;
  end if;
  return v_result;
end;
$$;

-- As in 20261017000000_free_order_caps.sql, plus: a seated order takes the
-- event's seat lock before the order row, and when its seats have gone to
-- someone else since the link was sent the result is 'seats_taken' (the
-- order is marked failed, nothing issued) instead of 'sold_out'.
create or replace function private.confirm_free_order(
  p_token_hash text, p_tickets jsonb, p_person_limit integer,
  out result text, out confirmed_order_id text)
language plpgsql
set search_path = ''
as $$
declare
  v_pre record;
  v_order public.orders;
begin
  select o.event_id, o.seat_ids into v_pre from public.orders o where o.confirmation_token_hash = p_token_hash;
  if found and v_pre.seat_ids is not null then
    perform private.lock_event_seats(v_pre.event_id);
  end if;

  select * into v_order from public.orders o where o.confirmation_token_hash = p_token_hash for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  if v_order.confirmation_expires_at <= now() then
    result := case when v_order.status = 'paid' then 'expired_confirmed' else 'expired' end;
    return;
  end if;
  if v_order.status = 'paid' then
    result := 'already_confirmed';
    confirmed_order_id := v_order.id;
    return;
  end if;
  if v_order.status <> 'pending' then
    result := 'unavailable';
    return;
  end if;

  if private.lock_free_allowance(v_order.event_id, v_order.buyer_email_key) + jsonb_array_length(p_tickets)
       > p_person_limit then
    update public.orders set status = 'failed' where id = v_order.id;
    perform private.record_free_order_refusal('person_event_limit');
    result := 'person_event_limit';
    return;
  end if;

  perform 1 from public.events e where e.id = v_order.event_id for share;
  if exists (
    select 1
      from jsonb_array_elements(v_order.line_items) li
      left join public.ticket_types t on t.event_id = v_order.event_id and t.id = li.value ->> 'ticketTypeId'
     where t.id is null or t.price_cents <> 0
  ) then
    update public.orders set status = 'failed' where id = v_order.id;
    result := 'no_longer_free';
    return;
  end if;

  if private.fulfil_order(v_order.id, null, null, p_tickets) is distinct from 'paid' then
    -- Nothing was charged, so there's nothing to refund.
    update public.orders set status = 'failed' where id = v_order.id;
    result := case when v_order.seat_ids is not null
                        and cardinality(private.unavailable_seats(v_order.event_id, v_order.seat_ids, v_order.id)) > 0
                   then 'seats_taken' else 'sold_out' end;
    return;
  end if;
  result := 'confirmed';
  confirmed_order_id := v_order.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check-in: the ticket's seat
-- ---------------------------------------------------------------------------

drop function private.check_in_ticket(uuid, uuid, uuid, text, uuid, integer, interval);

-- As in 20261021130000_check_in_followups.sql, plus the ticket's seat
-- (seat_section, seat_row, seat_label, seat_kind; null for a ticket without
-- one), whenever the ticket is described (every result but invalid).
create function private.check_in_ticket(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_code text, p_request_id uuid,
  p_limit integer, p_window interval,
  out result text, out check_in_id uuid, out admission_id uuid, out ticket_type_name text, out ticket_number integer,
  out ticket_count integer, out code_last4 text, out first_checked_in_at timestamptz, out other_event_title text,
  out seat_section text, out seat_row text, out seat_label text, out seat_kind text
)
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
  v_order_id text;
  v_ticket_event uuid;
  v_ticket_organiser uuid;
  v_status public.order_status;
  v_checked_in_at timestamptz;
  v_log record;
  v_seen record;
begin
  if p_event_id is null or p_organiser_id is null or p_actor_id is null or p_request_id is null then
    raise exception 'missing argument' using errcode = '22023';
  end if;

  -- 1. The organiser's own event.
  perform 1 from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id for key share;
  if not found then
    result := 'not_found';
    return;
  end if;

  -- 2. The caller's allowance. Over it: nothing logged.
  if not private.take_rate_limit(p_actor_id, 'check_in', p_limit, p_window) then
    result := 'rate_limited';
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ticket_check_in:' || p_event_id::text || ':' || p_request_id::text, 0));

  -- 3. Only a well-formed code of one of this organiser's tickets goes any
  --    further. Unknown and someone else's are the same: no code.
  if p_code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' then
    select t.code, t.order_id, t.event_id, e.organiser_id
      into v_code, v_order_id, v_ticket_event, v_ticket_organiser
      from public.tickets t
      join public.events e on e.id = t.event_id
     where t.code = p_code;
    if v_ticket_organiser is distinct from p_organiser_id then
      v_code := null;
      v_order_id := null;
      v_ticket_event := null;
    end if;
  end if;

  -- 4. A retried request gets its original result back, if it's for the same code.
  select c.id, c.public_id, c.result, c.ticket_code, c.created_at into v_log
    from public.ticket_check_ins c
   where c.event_id = p_event_id and c.request_id = p_request_id;

  if found then
    if v_log.ticket_code is distinct from v_code then
      result := 'conflict';
      return;
    end if;
    result := v_log.result;
    check_in_id := v_log.public_id;
    if v_log.result = 'admitted' then
      first_checked_in_at := v_log.created_at;
      admission_id := v_log.public_id;
    elsif v_log.result = 'already_checked_in' then
      select c.id, c.public_id, c.created_at into v_seen
        from public.ticket_check_ins c
       where c.ticket_code = v_log.ticket_code and c.result = 'admitted' and c.id < v_log.id
       order by c.id desc
       limit 1;
      if found then
        first_checked_in_at := v_seen.created_at;
        if exists (select 1 from public.tickets t where t.code = v_log.ticket_code and t.checked_in_at is not null)
           and not exists (select 1 from public.ticket_check_ins c
                            where c.ticket_code = v_log.ticket_code and c.result = 'admitted' and c.id > v_seen.id) then
          admission_id := v_seen.public_id;
        end if;
      end if;
    end if;
  else
    if v_code is null then
      result := 'invalid';
    elsif v_ticket_event <> p_event_id then
      result := 'other_event';
    else
      select o.status into v_status from public.orders o where o.id = v_order_id for share;
      select t.checked_in_at into v_checked_in_at from public.tickets t where t.code = v_code for update;

      if v_status is distinct from 'paid' then
        result := 'not_admissible';
      elsif v_checked_in_at is not null then
        result := 'already_checked_in';
        first_checked_in_at := v_checked_in_at;
        select c.public_id into admission_id
          from public.ticket_check_ins c
         where c.ticket_code = v_code and c.result = 'admitted'
         order by c.id desc
         limit 1;
      else
        update public.tickets set checked_in_at = now() where code = v_code;
        result := 'admitted';
        first_checked_in_at := now();
      end if;
    end if;

    insert into public.ticket_check_ins (event_id, ticket_code, actor_user_id, request_id, result)
    values (p_event_id, v_code, p_actor_id, p_request_id, result)
    returning public_id into check_in_id;
    if result = 'admitted' then
      admission_id := check_in_id;
    end if;
  end if;

  if v_code is null then
    return;
  end if;

  select x.ticket_type_name, x.n, x.total, right(x.code, 4)
    into ticket_type_name, ticket_number, ticket_count, code_last4
    from (select t.code, t.ticket_type_name,
                 (row_number() over (order by t.ticket_type_id, t.code))::integer as n,
                 (count(*) over ())::integer as total
            from public.tickets t
           where t.order_id = (select t2.order_id from public.tickets t2 where t2.code = v_code)) x
   where x.code = v_code;

  -- The seat, so the door can say where to go.
  select s.section_label, s.row_label, s.seat_label, s.kind
    into seat_section, seat_row, seat_label, seat_kind
    from public.tickets t
    join public.event_seats s on s.event_id = t.event_id and s.id = t.seat_id
   where t.code = v_code;

  if result = 'other_event' then
    select e.title into other_event_title
      from public.tickets t join public.events e on e.id = t.event_id
     where t.code = v_code;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.unavailable_seats(uuid, text[], text) from public, anon, authenticated;
revoke all on function private.order_seats_match(uuid, jsonb, text[]) from public, anon, authenticated;
revoke all on function private.hold_seats(text, uuid, uuid, text, jsonb, integer, integer, integer, integer, text, text,
  integer, text[], interval, integer, interval, integer, numeric) from public, anon, authenticated;
revoke all on function private.release_seat_holds(text) from public, anon, authenticated;
revoke all on function private.fulfil_order(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.record_payment_refund(text, integer, boolean) from public, anon, authenticated;
revoke all on function private.place_free_seated_order(text, uuid, uuid, text, jsonb, text, text, uuid, jsonb, integer,
  integer, interval, text[]) from public, anon, authenticated;
revoke all on function private.request_free_seated_order(text, uuid, uuid, text, jsonb, text, text, text, interval, integer,
  interval, integer, interval, integer, interval, text[]) from public, anon, authenticated;
revoke all on function private.confirm_free_order(text, jsonb, integer) from public, anon, authenticated;
revoke all on function private.check_in_ticket(uuid, uuid, uuid, text, uuid, integer, interval) from public, anon, authenticated;


-- ===== 20261102000000_seating_hardening.sql =====
-- Reserved seating hardening (security review of 963ab62; docs/architecture.md,
-- "Reserved seating"). Redefines functions only: no table, column or data
-- changes.
--
--   * private.hold_seats counted a hold attempt (take_event_rate_limit,
--     bucket 'seat_holds') before deciding anything else, so refused attempts
--     (above all the held-seat cap, which a hoarder reaches first) used up
--     the event's 120 attempts per 10 minutes, and one anonymous client could
--     lock every buyer out. Now every refusal is decided first (not on sale,
--     map version, seats unavailable, lines and seats differ, the hold cap),
--     and only a hold that is about to be made takes a hit on the counter.
--     A window that is already used up is refused up front with a plain read
--     (nothing written), as take_event_rate_limit itself does. Results and
--     signature are unchanged.
--     Lock order unchanged: the event's seat advisory lock, the order (its
--     insert), the event (share), seats in id order; the counter's row
--     (private.event_rate_limits, bucket 'seat_holds', only ever written here
--     under the seat lock) comes last.
--   * private.write_seat_map and private.clear_seat_map refuse (check_violation,
--     constraint name event_seat_maps_no_orders: the API's 409) when the event
--     has any order, whatever its status, and private.replace_seat_map and
--     private.delete_seat_map say 'has_orders' before calling them. Callers
--     already made sure of it (an organiser's map is frozen at the first
--     approval, and admin_replace_seat_map and admin_set_event_ticketing check
--     for orders); this is defence in depth, so no future caller can rewrite
--     seats that a pending order holds or a paid one has sold.
--
-- orders_event_idx (event_id) serves the new "any order" checks.
--
-- Access model as everywhere else: every redefined function keeps its pinned
-- search_path and has execute revoked from PUBLIC, anon and authenticated.
--
-- Reversible: restore private.hold_seats from 20261101000100_seat_holds.sql,
-- and private.write_seat_map, private.clear_seat_map,
-- private.replace_seat_map and private.delete_seat_map from
-- 20261101000000_reserved_seating.sql. Nothing to undo in the data.

-- ---------------------------------------------------------------------------
-- Holds: refusals first, then the attempt counter
-- ---------------------------------------------------------------------------

-- Creates p_order_id (pending, with p_seat_ids) and holds its seats until
-- now() + p_hold, all or nothing. p_line_items and the totals are the API's
-- priced snapshot (prices from the database, a line per tier). Returns:
--   result 'held'               done: hold_expires_at is set
--          'rate_limited'       the event already had p_attempt_limit holds in
--                               this p_attempt_window: nothing written
--          'not_on_sale'        the event isn't published or is external
--          'version'            the map isn't version p_map_version (or is gone)
--          'seats_unavailable'  unavailable_seat_ids can't be had
--          'tier_mismatch'      the lines don't match the seats' tiers
--          'hold_cap'           the event already has too many seats held
--                               (more than the larger of p_cap_min and
--                               p_cap_share of its unblocked seats with these)
-- Every refusal writes nothing at all: only a hold counts towards
-- p_attempt_limit. An external event's order is refused by
-- orders_sheltuh_only (check_violation, the API's 409), and nothing is kept.
create or replace function private.hold_seats(
  p_order_id text, p_event_id uuid, p_organiser_id uuid, p_event_title text, p_line_items jsonb,
  p_subtotal_cents integer, p_buyer_fee_cents integer, p_total_cents integer, p_application_fee_cents integer,
  p_buyer_email text, p_tracking_code text, p_map_version integer, p_seat_ids text[], p_hold interval,
  p_attempt_limit integer, p_attempt_window interval, p_cap_min integer, p_cap_share numeric,
  out result text, out hold_expires_at timestamptz, out unavailable_seat_ids text[]
)
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_version integer;
  v_unavailable text[];
  v_held integer;
  v_sellable integer;
begin
  if p_seat_ids is null or cardinality(p_seat_ids) not between 1 and 10
     or cardinality(p_seat_ids) <> (select count(distinct x) from unnest(p_seat_ids) x) then
    raise exception 'between 1 and 10 distinct seats' using errcode = '22023';
  end if;

  perform private.lock_event_seats(p_event_id);
  -- A used-up window: refused with a plain read, before any work. Exact, since
  -- the counter is only ever written under the seat lock held here.
  if exists (select 1 from private.event_rate_limits r
              where r.event_id = p_event_id and r.bucket = 'seat_holds'
                and r.window_started_at > now() - p_attempt_window and r.hits >= p_attempt_limit) then
    result := 'rate_limited';
    return;
  end if;

  begin
    -- The order (orders_sheltuh_only share-locks the event row).
    insert into public.orders (id, event_id, organiser_id, event_title, line_items, subtotal_cents,
       buyer_fee_cents, total_cents, application_fee_cents, buyer_email, tracking_code, seat_ids)
    values (p_order_id, p_event_id, p_organiser_id, p_event_title, p_line_items, p_subtotal_cents,
       p_buyer_fee_cents, p_total_cents, p_application_fee_cents, p_buyer_email,
       (select l.code from public.event_tracking_links l where l.event_id = p_event_id and l.code = p_tracking_code),
       p_seat_ids);

    select e.status, e.ticketing_mode into v_event from public.events e where e.id = p_event_id for share;
    if v_event.status is distinct from 'published' or v_event.ticketing_mode is distinct from 'sheltuh' then
      raise exception 'not on sale' using errcode = 'SH404';
    end if;
    select m.version into v_version from public.event_seat_maps m where m.event_id = p_event_id;
    if v_version is distinct from p_map_version then
      raise exception 'map version' using errcode = 'SH412';
    end if;

    -- Seats in id order.
    perform 1 from public.event_seats s
     where s.event_id = p_event_id and s.id = any(p_seat_ids)
     order by s.id
       for update;
    v_unavailable := private.unavailable_seats(p_event_id, p_seat_ids, p_order_id);
    if cardinality(v_unavailable) > 0 then
      unavailable_seat_ids := v_unavailable;
      raise exception 'seats unavailable' using errcode = 'SH409';
    end if;
    if not private.order_seats_match(p_event_id, p_line_items, p_seat_ids) then
      raise exception 'lines and seats differ' using errcode = 'SH422';
    end if;

    -- Anti-hoarding: seats held right now (unexpired), against the larger of
    -- p_cap_min and p_cap_share of the unblocked seats (the seated tiers'
    -- capacity).
    select count(*)::integer into v_held from public.event_seats s
     where s.event_id = p_event_id and s.hold_order_id is not null and s.hold_expires_at > now();
    select coalesce(sum(t.quantity_available), 0)::integer into v_sellable
      from public.ticket_types t where t.event_id = p_event_id and t.seated;
    if v_held + cardinality(p_seat_ids) > greatest(p_cap_min, floor(v_sellable * p_cap_share)::integer) then
      raise exception 'hold cap' using errcode = 'SH429';
    end if;

    -- Every refusal is behind us: this is a real hold, and only it counts.
    if not private.take_event_rate_limit(p_event_id, 'seat_holds', p_attempt_limit, p_attempt_window) then
      raise exception 'hold attempts' using errcode = 'SH430';
    end if;

    update public.event_seats s
       set hold_order_id = p_order_id, hold_expires_at = now() + p_hold
     where s.event_id = p_event_id and s.id = any(p_seat_ids);
    hold_expires_at := now() + p_hold;
    result := 'held';
  exception
    -- Each undoes the order and anything locked or written in this block.
    when sqlstate 'SH404' then result := 'not_on_sale';
    when sqlstate 'SH412' then result := 'version';
    when sqlstate 'SH409' then result := 'seats_unavailable';
    when sqlstate 'SH422' then result := 'tier_mismatch';
    when sqlstate 'SH429' then result := 'hold_cap';
    when sqlstate 'SH430' then result := 'rate_limited';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Map writes: never while the event has orders
-- ---------------------------------------------------------------------------

-- As in 20261101000000_reserved_seating.sql, plus: refused (check_violation,
-- event_seat_maps_no_orders) when the event has any order. The caller holds
-- the seat lock and the event row.
create or replace function private.write_seat_map(p_event_id uuid, p_layout jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' or jsonb_typeof(p_layout -> 'sections') <> 'array' then
    raise exception 'invalid seat map layout' using errcode = '22023';
  end if;
  if exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id and m.layout = p_layout) then
    return 'unchanged';
  end if;
  if exists (select 1 from public.orders o where o.event_id = p_event_id) then
    raise exception 'An event with orders can''t have its seat map changed.'
      using errcode = 'check_violation', constraint = 'event_seat_maps_no_orders';
  end if;

  select count(*)::integer into v_count
    from jsonb_array_elements(p_layout -> 'sections') s (section)
   cross join lateral jsonb_array_elements(s.section -> 'rows') r (rw)
   cross join lateral jsonb_array_elements(r.rw -> 'seats') k (seat);

  -- Ticket types in id order (fulfil_order's order), before any seat.
  perform 1 from public.ticket_types t where t.event_id = p_event_id order by t.id for update;

  delete from public.event_seats s where s.event_id = p_event_id;
  insert into public.event_seat_maps (event_id, version, layout, seat_count)
  values (p_event_id, nextval('private.seat_map_versions')::integer, p_layout, v_count)
  on conflict (event_id) do update
     set version = excluded.version, layout = excluded.layout, seat_count = excluded.seat_count;

  insert into public.event_seats
    (event_id, id, position, section_label, row_label, seat_label, ticket_type_id, kind, blocked)
  select p_event_id,
         k.seat ->> 'id',
         (row_number() over (order by s.si, r.ri, k.ki))::integer - 1,
         s.section ->> 'label',
         r.rw ->> 'label',
         k.seat ->> 'label',
         k.seat ->> 'ticketTypeId',
         coalesce(k.seat ->> 'kind', 'standard'),
         coalesce((k.seat ->> 'blocked')::boolean, false)
    from jsonb_array_elements(p_layout -> 'sections') with ordinality as s (section, si)
   cross join lateral jsonb_array_elements(s.section -> 'rows') with ordinality as r (rw, ri)
   cross join lateral jsonb_array_elements(r.rw -> 'seats') with ordinality as k (seat, ki);

  -- At most 5 price tiers on a map (manager decision, docs/design/seating.md):
  -- buyers tell them apart by pattern, not colour.
  if (select count(distinct s.ticket_type_id) from public.event_seats s where s.event_id = p_event_id) > 5 then
    raise exception 'A seat map can use at most 5 ticket types.'
      using errcode = 'check_violation', constraint = 'event_seat_maps_max_tiers';
  end if;

  -- quantity_available is rewritten to itself so ticket_types_seated_capacity recomputes it.
  update public.ticket_types t
     set seated = exists (select 1 from public.event_seats s where s.event_id = t.event_id and s.ticket_type_id = t.id),
         quantity_available = t.quantity_available
   where t.event_id = p_event_id;
  return 'saved';
end;
$$;

-- As in 20261101000000_reserved_seating.sql, plus the same refusal when the
-- event has any order.
create or replace function private.clear_seat_map(p_event_id uuid) returns text
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id) then
    return 'unchanged';
  end if;
  if exists (select 1 from public.orders o where o.event_id = p_event_id) then
    raise exception 'An event with orders can''t have its seat map changed.'
      using errcode = 'check_violation', constraint = 'event_seat_maps_no_orders';
  end if;
  perform 1 from public.ticket_types t where t.event_id = p_event_id order by t.id for update;
  delete from public.event_seat_maps m where m.event_id = p_event_id;
  update public.ticket_types t set seated = false where t.event_id = p_event_id and t.seated;
  return 'deleted';
end;
$$;

-- As in 20261101000000_reserved_seating.sql, plus 'has_orders' (the event
-- has an order of any status: nothing written).
create or replace function private.replace_seat_map(p_event_id uuid, p_organiser_id uuid, p_layout jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
begin
  perform private.lock_event_seats(p_event_id);
  select e.status, e.ticketing_mode into v_event
    from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'frozen';
  end if;
  if v_event.ticketing_mode = 'external' then
    return 'external';
  end if;
  if exists (select 1 from public.orders o where o.event_id = p_event_id) then
    return 'has_orders';
  end if;
  return private.write_seat_map(p_event_id, p_layout);
end;
$$;

-- As in 20261101000000_reserved_seating.sql, plus 'has_orders'.
create or replace function private.delete_seat_map(p_event_id uuid, p_organiser_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_status public.event_status;
begin
  perform private.lock_event_seats(p_event_id);
  select e.status into v_status
    from public.events e where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_status not in ('draft', 'rejected') then
    return 'not_editable';
  end if;
  if exists (select 1 from public.event_moderation_log l where l.event_id = p_event_id and l.action = 'approved') then
    return 'frozen';
  end if;
  if exists (select 1 from public.orders o where o.event_id = p_event_id) then
    return 'has_orders';
  end if;
  return private.clear_seat_map(p_event_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (create or replace keeps them; restated so this file stands alone)
-- ---------------------------------------------------------------------------

revoke all on function private.hold_seats(text, uuid, uuid, text, jsonb, integer, integer, integer, integer, text, text,
  integer, text[], interval, integer, interval, integer, numeric) from public, anon, authenticated;
revoke all on function private.write_seat_map(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.clear_seat_map(uuid) from public, anon, authenticated;
revoke all on function private.replace_seat_map(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.delete_seat_map(uuid, uuid) from public, anon, authenticated;


-- ===== 20261102000100_social_hardening.sql =====
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


-- ===== 20261103000000_seat_hold_client_limits.sql =====
-- Per-client seat-hold limit (a manager decision; docs/architecture.md,
-- "Reserved seating"). The event-wide limit (120 holds per 10 minutes,
-- private.hold_seats) is shared by every buyer, so one client could use it
-- all up and lock an on-sale; this adds a limit per client, taken by the API
-- before every private.hold_seats call.
--
--   * private.client_rate_limits: fixed-window counters, one row per
--     (client, bucket). A client is its `client_key`: the API's keyed
--     SHA-256 (HMAC) of its IP address (an IPv6 address's /64), salted with
--     a value derived from a server secret the database never sees. The raw
--     address is never stored or passed to the database. Looked up only by
--     its primary key; tiny (a row per recently active client per bucket),
--     and purged after a day idle, so no other index.
--   * private.take_client_rate_limit: private.take_rate_limit's semantics
--     (one upsert, so concurrent hits can't both take the last slot; `hits`
--     stops at p_limit + 1) for a client key.
--   * private.take_seat_hold_attempt: one hold attempt for a client, on two
--     buckets: 'seat_holds:<event id>' (p_event_limit per p_window) and then
--     'seat_holds' (p_all_limit per p_window, across all events). Returns
--     'ok', 'event' (over the event's) or 'all' (over the all-events one).
--     A refusal keeps neither hit (a subtransaction), so an attempt refused
--     for one event doesn't use up the client's allowance for the others.
--     Every attempt that reaches private.hold_seats counts, including ones it
--     refuses (taken seats, the hold cap): the per-client limit is the bound
--     on refused attempts, which the event-wide counter leaves out.
--     Lock order: the event's bucket row, then the all-events row. Nothing
--     else writes these rows, so two attempts never wait on each other in
--     opposite orders.
--   * private.purge_operational_data also deletes client counters idle for a
--     day (`client_rate_limits_deleted`; drop + create since its result
--     columns change; `select private.purge_operational_data()`, the Supabase
--     Cron job, is unaffected).
--
-- Access model as everywhere else: RLS on with no policies, nothing granted
-- to anon or authenticated; every new function pins its search_path and has
-- execute revoked from PUBLIC, anon and authenticated.
--
-- Reversible: drop functions private.take_seat_hold_attempt and
-- private.take_client_rate_limit and table private.client_rate_limits;
-- restore private.purge_operational_data from
-- 20261014000100_free_order_protection.sql (drop + create). The table holds
-- only counters for the last ten minutes (at most a day old after the
-- purge): nothing worth keeping.

-- ---------------------------------------------------------------------------
-- Per-client counters
-- ---------------------------------------------------------------------------

create table private.client_rate_limits (
  client_key text not null check (client_key ~ '^[0-9a-f]{64}$'),
  bucket text not null check (char_length(bucket) between 1 and 64),
  window_started_at timestamptz not null,
  hits integer not null check (hits >= 1),
  primary key (client_key, bucket)
);

alter table private.client_rate_limits enable row level security;
revoke all on private.client_rate_limits from public, anon, authenticated;

-- Records one hit and returns whether it's within p_limit per p_window
-- (fixed window, as private.take_rate_limit).
create function private.take_client_rate_limit(p_client_key text, p_bucket text, p_limit integer, p_window interval)
returns boolean
language sql
set search_path = ''
as $$
  insert into private.client_rate_limits as r (client_key, bucket, window_started_at, hits)
  values (p_client_key, p_bucket, now(), 1)
  on conflict (client_key, bucket) do update
     set window_started_at = case when r.window_started_at <= now() - p_window then now() else r.window_started_at end,
         hits = case when r.window_started_at <= now() - p_window then 1 else least(r.hits + 1, p_limit + 1) end
  returning hits <= p_limit;
$$;

-- One seat-hold attempt by p_client_key for p_event_id: 'ok', 'event' or
-- 'all' (see the header). A refusal writes nothing.
create function private.take_seat_hold_attempt(
  p_client_key text, p_event_id uuid, p_event_limit integer, p_all_limit integer, p_window interval
) returns text
language plpgsql
set search_path = ''
as $$
begin
  begin
    if not private.take_client_rate_limit(p_client_key, 'seat_holds:' || p_event_id::text, p_event_limit, p_window) then
      raise exception 'event hold attempts' using errcode = 'SH431';
    end if;
    if not private.take_client_rate_limit(p_client_key, 'seat_holds', p_all_limit, p_window) then
      raise exception 'hold attempts' using errcode = 'SH432';
    end if;
  exception
    when sqlstate 'SH431' then return 'event';
    when sqlstate 'SH432' then return 'all';
  end;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- As in 20261014000100_free_order_protection.sql, plus client counters idle
-- for a day.
drop function private.purge_operational_data();

create function private.purge_operational_data(
  out unconfirmed_orders_deleted integer, out platform_rate_limits_deleted integer,
  out free_order_refusals_deleted integer, out email_jobs_deleted integer,
  out client_rate_limits_deleted integer)
language plpgsql
set search_path = ''
as $$
begin
  delete from public.orders o
   where o.confirmation_token_hash is not null and o.status in ('pending', 'failed')
     and o.created_at < now() - interval '7 days'
     and o.confirmation_expires_at < now() - interval '7 days';
  get diagnostics unconfirmed_orders_deleted = row_count;

  delete from private.platform_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics platform_rate_limits_deleted = row_count;

  delete from private.free_order_refusals
   where day < ((now() at time zone 'Australia/Melbourne')::date - interval '13 months')::date;
  get diagnostics free_order_refusals_deleted = row_count;

  delete from private.email_outbox j
   where (j.status = 'sent' and j.sent_at < now() - interval '90 days')
      or (j.status = 'failed' and j.updated_at < now() - interval '1 year');
  get diagnostics email_jobs_deleted = row_count;

  delete from private.client_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics client_rate_limits_deleted = row_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.take_client_rate_limit(text, text, integer, interval) from public, anon, authenticated;
revoke all on function private.take_seat_hold_attempt(text, uuid, integer, integer, interval) from public, anon, authenticated;
revoke all on function private.purge_operational_data() from public, anon, authenticated;


-- ===== 20261103000100_refuse_ended_event_orders.sql =====
-- No new orders or seat holds for an event that has ended (docs/architecture.md,
-- "Payment flow", "Free tickets" and "Reserved seating").
--
-- "Ended" is the same everywhere: ends_at <= now() (events.ends_at is
-- not null; the waitlist, Who's Going, trending and follows use it too).
--
--   * orders_not_ended: a trigger refusing any new order for an ended event
--     (check_violation, constraint orders_not_ended: the API's 409 "This
--     event has ended."). Every way an order or hold is made inserts into
--     public.orders, so this covers them all, whoever the caller: the paid
--     general admission checkout (the API's own insert), private.hold_seats
--     (a paid seated checkout's order and holds), private.place_free_order,
--     private.place_free_seated_order, private.request_free_order (both
--     forms) and private.request_free_seated_order. It share-locks the event
--     row, the same lock orders_sheltuh_only takes on the same row next
--     (triggers fire in name order), so no new lock is added to any path, and
--     an edit of ends_at racing an order is decided one way or the other. A
--     refusal raises, so the whole call is undone, including any rate-limit
--     hit taken before the insert. Orders already made are untouched.
--   * private.confirm_free_order: as in 20261101000100_seat_holds.sql, plus
--     'ended' (the order is marked failed, nothing issued) when a guest's
--     link is confirmed after the event ended. The event is read before the
--     allowance (so 'ended' wins over the other refusals), and checked again
--     under the event's share lock that was already taken there, so the lock
--     order (seat lock, order, (event, person), event) is unchanged. A link
--     already confirmed stays 'already_confirmed'.
--
-- private.fulfil_order is NOT changed: a paid order's checkout session was
-- created before the end, and a payment Stripe confirms after it is still
-- honoured (the buyer has been charged). Only new orders and holds are
-- refused. Waitlist offers need nothing: private.notify_waitlist already
-- emails nobody for an ended event, and joining or confirming refuse it.
--
-- Access model as everywhere else: every function pins its search_path and
-- has execute revoked from PUBLIC, anon and authenticated.
--
-- Reversible: drop trigger orders_not_ended on public.orders and function
-- private.orders_not_ended(); restore private.confirm_free_order from
-- 20261101000100_seat_holds.sql. No table, column or data changes.

-- ---------------------------------------------------------------------------
-- Every new order: not for an ended event
-- ---------------------------------------------------------------------------

create function private.orders_not_ended() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ends_at timestamptz;
begin
  select e.ends_at into v_ends_at from public.events e where e.id = new.event_id for share;
  if v_ends_at <= now() then
    raise exception 'This event has ended.'
      using errcode = 'check_violation', constraint = 'orders_not_ended';
  end if;
  return new;
end;
$$;

create trigger orders_not_ended before insert on public.orders
  for each row execute function private.orders_not_ended();

-- ---------------------------------------------------------------------------
-- A guest's free order: not confirmed after the event ended
-- ---------------------------------------------------------------------------

-- As in 20261101000100_seat_holds.sql, plus 'ended': the event ended before
-- the link was confirmed (the order is marked failed, nothing issued).
-- Returns (result, confirmed_order_id): 'confirmed', 'already_confirmed',
-- 'expired_confirmed', 'not_found', 'expired', 'unavailable', 'ended',
-- 'person_event_limit', 'no_longer_free', 'seats_taken' or 'sold_out'.
create or replace function private.confirm_free_order(
  p_token_hash text, p_tickets jsonb, p_person_limit integer,
  out result text, out confirmed_order_id text)
language plpgsql
set search_path = ''
as $$
declare
  v_pre record;
  v_order public.orders;
  v_ends_at timestamptz;
begin
  select o.event_id, o.seat_ids into v_pre from public.orders o where o.confirmation_token_hash = p_token_hash;
  if found and v_pre.seat_ids is not null then
    perform private.lock_event_seats(v_pre.event_id);
  end if;

  select * into v_order from public.orders o where o.confirmation_token_hash = p_token_hash for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  if v_order.confirmation_expires_at <= now() then
    result := case when v_order.status = 'paid' then 'expired_confirmed' else 'expired' end;
    return;
  end if;
  if v_order.status = 'paid' then
    result := 'already_confirmed';
    confirmed_order_id := v_order.id;
    return;
  end if;
  if v_order.status <> 'pending' then
    result := 'unavailable';
    return;
  end if;

  -- A plain read, so this refusal comes first; checked again under the event's share lock below.
  if exists (select 1 from public.events e where e.id = v_order.event_id and e.ends_at <= now()) then
    update public.orders set status = 'failed' where id = v_order.id;
    result := 'ended';
    return;
  end if;

  if private.lock_free_allowance(v_order.event_id, v_order.buyer_email_key) + jsonb_array_length(p_tickets)
       > p_person_limit then
    update public.orders set status = 'failed' where id = v_order.id;
    perform private.record_free_order_refusal('person_event_limit');
    result := 'person_event_limit';
    return;
  end if;

  select e.ends_at into v_ends_at from public.events e where e.id = v_order.event_id for share;
  if v_ends_at <= now() then
    update public.orders set status = 'failed' where id = v_order.id;
    result := 'ended';
    return;
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_order.line_items) li
      left join public.ticket_types t on t.event_id = v_order.event_id and t.id = li.value ->> 'ticketTypeId'
     where t.id is null or t.price_cents <> 0
  ) then
    update public.orders set status = 'failed' where id = v_order.id;
    result := 'no_longer_free';
    return;
  end if;

  if private.fulfil_order(v_order.id, null, null, p_tickets) is distinct from 'paid' then
    -- Nothing was charged, so there's nothing to refund.
    update public.orders set status = 'failed' where id = v_order.id;
    result := case when v_order.seat_ids is not null
                        and cardinality(private.unavailable_seats(v_order.event_id, v_order.seat_ids, v_order.id)) > 0
                   then 'seats_taken' else 'sold_out' end;
    return;
  end if;
  result := 'confirmed';
  confirmed_order_id := v_order.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (create or replace keeps them; restated so this file stands alone)
-- ---------------------------------------------------------------------------

-- Triggers don't need the caller to hold execute on their function.
revoke all on function private.orders_not_ended() from public, anon, authenticated;
revoke all on function private.confirm_free_order(text, jsonb, integer) from public, anon, authenticated;


-- ===== 20261105000000_organiser_logos.sql =====
-- Organiser logos (docs/architecture.md, "Organiser profiles").
--
--   * private.organiser_logos: an approved organiser's logo, re-encoded by the
--     API (lib/server/organiser-logo.ts) to a 512 px square WebP and a 96 px
--     thumbnail: the whole logo fitted on white, no transparency and no
--     metadata (EXIF, GPS, ICC, XMP). The upload itself is never stored.
--     Stored in the database like event photos and member photos (no Storage
--     bucket). Deleted with the organiser.
--   * private.put_organiser_logo: the organiser's upload, as one step: lock
--     the organiser row, check it's still approved (the upload may have taken
--     a while), write the logo, bump the organiser's updated_at and log the
--     change in private.organiser_profile_edits (like any unreviewed profile
--     edit: owner, old and new version).
--   * private.delete_organiser_logo: the organiser removes it (any status, so
--     a suspended organiser can still take theirs down), logged the same way.
--     Nothing to remove writes nothing.
--   * private.admin_remove_organiser_logo: an admin removes it with a reason,
--     logged as a `profile_edit` by the admin (byStaff), like
--     admin_remove_featured_video.
--
-- The log records the logo's version (milliseconds since the epoch of its
-- updated_at, as text: the `v` of its URL), never the image. Each write sets
-- updated_at to clock_timestamp(), and a replacement to at least a
-- millisecond after the logo it replaces, so every new logo has a new
-- version (URL and ETag).
--
-- Locks: the organiser row first (for no key update), then the logo row, the
-- order suspend_organiser, edit_organiser_profile and
-- admin_remove_featured_video use (they take the organiser row for update,
-- which conflicts with for no key update), so an upload racing a takedown
-- either lands first (and is then hidden with the organiser: the public read
-- requires approved) or sees `rejected` and writes nothing. follow_organiser's
-- key-share lock doesn't conflict.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC and its
-- search_path pinned.
--
-- Index: none new. organiser_logos is only read by its primary key
-- (organiser_id): the version subqueries of the organiser and event reads,
-- and GET /organisers/{id}/logo. The log keeps
-- organiser_profile_edits_organiser_idx.
--
-- Reversible: drop functions private.admin_remove_organiser_logo,
-- private.delete_organiser_logo and private.put_organiser_logo, then table
-- private.organiser_logos (destructive: every logo). Log entries naming
-- `logo` can stay (an API without the field skips names it doesn't know:
-- EDIT_FIELDS in lib/server/records.ts). No existing table, column or row is
-- changed.

create table private.organiser_logos (
  organiser_id uuid primary key references public.organisers (id) on delete cascade,
  -- Always WebP, made by the server: 512 x 512, and the 96 x 96 thumbnail.
  image bytea not null check (octet_length(image) between 1 and 524288),
  thumb bytea not null check (octet_length(thumb) between 1 and 65536),
  updated_at timestamptz not null default now()
);

alter table private.organiser_logos enable row level security;
revoke all on private.organiser_logos from public, anon, authenticated;

-- The caller's organiser's new logo (already re-encoded by the API; the check
-- constraints bound the sizes). Returns:
--   'updated'      written and logged
--   'not_approved' the caller's organiser isn't approved (any more): nothing written
--   'not_found'    the caller has no organiser
create function private.put_organiser_logo(p_owner_user_id uuid, p_image bytea, p_thumb bytea) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_status public.organiser_status;
  v_old text;
  v_new text;
begin
  select o.id, o.status into v_id, v_status
    from public.organisers o where o.owner_user_id = p_owner_user_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_status <> 'approved' then
    return 'not_approved';
  end if;

  select floor(extract(epoch from l.updated_at) * 1000)::bigint::text into v_old
    from private.organiser_logos l where l.organiser_id = v_id;

  insert into private.organiser_logos as l (organiser_id, image, thumb, updated_at)
  values (v_id, p_image, p_thumb, clock_timestamp())
  on conflict (organiser_id) do update
     set image = excluded.image,
         thumb = excluded.thumb,
         updated_at = greatest(excluded.updated_at, l.updated_at + interval '1 millisecond')
  returning floor(extract(epoch from l.updated_at) * 1000)::bigint::text into v_new;

  -- The organisers_set_updated_at trigger sets it to now(): the admin queue
  -- sorts by it, and a client's copy of the record is stale.
  update public.organisers set updated_at = now() where id = v_id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
  values (v_id, 'profile_edit', p_owner_user_id,
          jsonb_build_object('logo', jsonb_build_object('old', v_old, 'new', v_new)));

  return 'updated';
end;
$$;

-- The caller's organiser removes its logo, whatever its status. Returns
-- 'deleted' (logged), 'unchanged' (no logo: nothing written) or 'not_found'
-- (no organiser).
create function private.delete_organiser_logo(p_owner_user_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_old text;
begin
  select o.id into v_id
    from public.organisers o where o.owner_user_id = p_owner_user_id
     for no key update;
  if not found then
    return 'not_found';
  end if;

  delete from private.organiser_logos l where l.organiser_id = v_id
  returning floor(extract(epoch from l.updated_at) * 1000)::bigint::text into v_old;
  if not found then
    return 'unchanged';
  end if;

  update public.organisers set updated_at = now() where id = v_id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
  values (v_id, 'profile_edit', p_owner_user_id,
          jsonb_build_object('logo', jsonb_build_object('old', v_old, 'new', null)));

  return 'deleted';
end;
$$;

-- An admin removes an organiser's logo (any status), with a reason, logged as
-- a `profile_edit` by the admin. Returns 'removed', 'unchanged' (no logo:
-- nothing logged) or 'not_found'.
create function private.admin_remove_organiser_logo(p_organiser_id uuid, p_admin_id uuid, p_reason text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_old text;
begin
  perform 1 from public.organisers o where o.id = p_organiser_id for no key update;
  if not found then
    return 'not_found';
  end if;

  delete from private.organiser_logos l where l.organiser_id = p_organiser_id
  returning floor(extract(epoch from l.updated_at) * 1000)::bigint::text into v_old;
  if not found then
    return 'unchanged';
  end if;

  update public.organisers set updated_at = now() where id = p_organiser_id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields, reason)
  values (p_organiser_id, 'profile_edit', p_admin_id,
          jsonb_build_object('logo', jsonb_build_object('old', v_old, 'new', null)), p_reason);

  return 'removed';
end;
$$;

revoke all on function private.put_organiser_logo(uuid, bytea, bytea) from public, anon, authenticated;
revoke all on function private.delete_organiser_logo(uuid) from public, anon, authenticated;
revoke all on function private.admin_remove_organiser_logo(uuid, uuid, text) from public, anon, authenticated;

commit;
