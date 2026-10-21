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
