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
