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
