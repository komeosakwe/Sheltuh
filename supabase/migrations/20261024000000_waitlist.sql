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
