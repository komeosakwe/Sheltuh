-- Paid checkout idempotency and abuse controls (payment audit plan, item 4;
-- docs/architecture.md "Checkout idempotency"). Until now every paid checkout
-- request inserted a new pending order and created a new Stripe Checkout
-- Session: a double click or a retried request after a lost response made
-- two orders and two sessions (and, for seats, two hold attempts). Nothing
-- limited general admission paid checkouts per client.
--
--   * private.checkout_attempts: one row per Idempotency-Key. The key is
--     the client's (a uuid it keeps for one basket; the API makes one up
--     when a client sends none, so old clients behave as before). It's the
--     primary key on its own, so it's unique per (event, key) and a key
--     reused for another event is found too: the fingerprint (which covers
--     the event) then differs, a 422.
--     `fingerprint` is the API's SHA-256 (hex) over the event, the kind
--     (general admission or seated), the canonical basket (ticket type ids
--     and quantities, the map version and seat ids), the normalised buyer
--     email and the tracking code. `client_key` is the requester's keyed IP
--     hash (the same HMAC as the per-client limits; null when the API had
--     none: no IP header or no secret): only the same client key (null
--     matching null) gets the attempt's order and session back or retries
--     it ('other_client' otherwise, a 409 that reveals neither). Status:
--       in_progress  a request holds the lease (lease_token, lease_expires_at)
--                    and is making the order and the Stripe session
--       open         the session exists: order_id, session_url,
--                    session_expires_at (and hold_expires_at for seats)
--       failed       the last try failed (a refusal, or Stripe): the key may
--                    be retried; order_id is kept when the order is still
--                    pending and may be reused (see begin_checkout_attempt)
--       completed    a later request with the key found its order paid (or
--                    already refunded): recorded lazily, nothing more to do
--     No foreign key on order_id: the id is chosen (and recorded) before the
--     order exists, so a crash between the two can't orphan an order the
--     attempt doesn't know about; an id with no order is treated as none.
--   * private.checkout_attempt_state: what a request with this key,
--     fingerprint and client key should get (mismatch, other_client,
--     in_progress, replay, completed, expired, retry), from the row and its
--     order. Read by the API before
--     its own checks (so a replay of held seats isn't refused as "taken") and
--     by begin_checkout_attempt under the row lock.
--   * private.take_checkout_attempt: general admission paid checkout limits,
--     per client (the API's keyed hash of its IP address, as for seat holds;
--     buckets 'checkouts:<event id>' and 'checkouts' in client_rate_limits),
--     then the event's circuit breaker (take_event_rate_limit, bucket
--     'checkouts'): crossing it refuses nobody (a manager decision: a
--     distributed client could otherwise use it up and block real buyers)
--     but queues an ops alert (private.queue_checkout_surge_alert), at most
--     one per event per window (bucket 'checkout_surge_alert', limit 1).
--     Returns 'ok', 'surge' (ok, and an alert was queued), 'event' or 'all'.
--     A refusal keeps no hit (a subtransaction). A null client key (no IP
--     header or secret: the API fails open, with a log line) counts towards
--     the circuit breaker only. Seated checkouts keep take_seat_hold_attempt
--     (their per-client limit) and hold_seats (their per-event limit):
--     nothing is counted twice.
--   * private.queue_checkout_surge_alert: an `ops_alert` outbox job about an
--     event (email_outbox.ops_event_id, new; one waiting per event), at most
--     10 per 24 hours platform-wide (bucket 'ops_alerts_checkout_surge'),
--     separate from the payment exceptions' 20, so a surge on many events
--     can't use up the alerts that payment problems need.
--   * private.begin_checkout_attempt: insert-or-lock the row, then decide.
--     A new key: the row (in_progress, with the order id the API minted and
--     the requester's client key) and the limits in one subtransaction, so a
--     limit refusal writes nothing at all. An existing key: mismatch,
--     other_client, in_progress (a live lease), replay
--     (open, order pending, session and hold unexpired), completed, expired
--     (open but its order failed or was cancelled, or its session or hold
--     ended: "start a new checkout"), or a retry of a failed attempt (or one
--     whose lease lapsed: the request that held it died). A retry reuses
--     the order when it's still pending, has no session recorded and is
--     younger than p_reuse_within (the API passes 10 minutes for general
--     admission; for seats, 45 seconds, since Stripe needs a session's
--     expires_at, fixed at the order's creation plus 31 minutes, to be at
--     least 30 minutes ahead): the Stripe call then repeats with the same
--     idempotency key and parameters, so if the first call did create a
--     session, Stripe returns that one. Otherwise the limits are taken again
--     (a refusal changes nothing), a still-pending previous order is
--     released (seats freed), and the new order id is recorded.
--   * private.finish_checkout_attempt (lease-checked): the session recorded
--     on the order and the attempt opened, unless the order stopped being
--     pending meanwhile ('order_closed': the attempt fails). 'lost' when the
--     lease is no longer this request's.
--   * private.fail_checkout_attempt (lease-checked): the attempt failed and
--     its lease released; with p_release, its order is released too (failed,
--     seats freed) so a retry starts afresh.
--   * private.release_checkout_order: a pending order failed (a seated one
--     through release_seat_holds, freeing its seats; a general admission one
--     directly, so it never takes the seat lock).
--   * private.email_outbox: ops_event_id (an ops alert about an event, the
--     checkout circuit breaker) next to payment_exception_id; an ops_alert
--     job has exactly one of the two.
--   * private.purge_operational_data: attempts deleted 2 days after creation
--     (D11; drop + create, one more count). First, an order a failed attempt
--     kept pending for reuse (no session recorded) is marked failed: no
--     Checkout Session lives that long, so nothing can be paid for it.
--
-- Lock order: the attempt row, then (releasing an order) the event's seat
-- lock and the order (release_seat_holds' own order), then the limit
-- counters are only ever taken with the attempt row held and before any
-- seat lock (client counters, the event's counters, then the platform's
-- alert counter and the outbox). Nothing else locks attempt rows, and no function that holds the
-- seat lock or an order row goes on to lock an attempt, so there's no cycle.
-- hold_seats and the order insert run outside these functions (after
-- begin_checkout_attempt has committed); finish_checkout_attempt locks the
-- attempt, then the order row.
--
-- Concurrency: two requests with one new key both insert; the second's
-- ON CONFLICT waits for the first to commit, then finds the row and its live
-- lease ('in_progress', 409). The lease (90 seconds, the API's) outlasts the
-- route's maxDuration (60), so a lease only lapses when its request is gone.
--
-- Indexes: checkout_attempts_created_idx (created_at) serves the daily
-- purge, the only query that isn't by primary key (the table holds every
-- paid checkout attempt of the last 2 days).
-- email_outbox_ops_event_active_key (ops_event_id), unique while pending or
-- sending: one surge alert waiting per event (and the insert's conflict
-- target). email_outbox_ops_event_idx (ops_event_id) serves the events
-- foreign key's cascade.
--
-- Access model as everywhere else: RLS on with no policies, nothing granted
-- to anon or authenticated; every new function pins its search_path and has
-- execute revoked from PUBLIC, anon and authenticated.
--
-- Reversible: drop the functions above and table private.checkout_attempts;
-- delete the outbox's ops_alert jobs with an ops_event_id, restore its
-- email_outbox_kind_key check from 20261104000000_payment_reconciliation.sql
-- and drop the ops_event_id column; restore private.purge_operational_data
-- from 20261104000000_payment_reconciliation.sql (drop + create). The table
-- only holds the last 2 days' attempts (no buyer data beyond hashes):
-- nothing worth keeping.

-- ---------------------------------------------------------------------------
-- Attempts
-- ---------------------------------------------------------------------------

create table private.checkout_attempts (
  event_id uuid not null references public.events (id) on delete cascade,
  idempotency_key uuid not null,
  kind text not null check (kind in ('ga', 'seated')),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('in_progress', 'open', 'failed', 'completed')),
  order_id text check (order_id ~ '^ord_[0-9a-f]{32}$'),
  lease_token uuid,
  lease_expires_at timestamptz,
  session_url text check (char_length(session_url) between 1 and 2048),
  session_expires_at timestamptz,
  hold_expires_at timestamptz,
  -- The requester's keyed IP hash (lib/server/client-key.ts), null when the API had none.
  client_key text check (client_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (idempotency_key),
  constraint checkout_attempts_lease check (
    (status = 'in_progress') = (lease_token is not null and lease_expires_at is not null)
  ),
  constraint checkout_attempts_open check (
    status <> 'open' or (order_id is not null and session_url is not null and session_expires_at is not null)
  )
);

create index checkout_attempts_created_idx on private.checkout_attempts (created_at);

alter table private.checkout_attempts enable row level security;
revoke all on private.checkout_attempts from public, anon, authenticated;

-- An ops alert about an event (the checkout circuit breaker), next to the
-- payment exceptions' alerts.
alter table private.email_outbox
  add column ops_event_id uuid references public.events (id) on delete cascade,
  drop constraint email_outbox_kind_key,
  add constraint email_outbox_kind_key check (
    case kind
      when 'ticket_email' then order_id is not null and waitlist_entry_id is null and follow_id is null
                               and payment_exception_id is null and ops_event_id is null
      when 'waitlist_available' then waitlist_entry_id is not null and order_id is null and follow_id is null
                                     and payment_exception_id is null and ops_event_id is null
      when 'organiser_new_events' then follow_id is not null and order_id is null and waitlist_entry_id is null
                                       and payment_exception_id is null and ops_event_id is null
      else (payment_exception_id is not null) <> (ops_event_id is not null)
           and order_id is null and waitlist_entry_id is null and follow_id is null end);

create unique index email_outbox_ops_event_active_key on private.email_outbox (ops_event_id)
  where status in ('pending', 'sending') and ops_event_id is not null;
create index email_outbox_ops_event_idx on private.email_outbox (ops_event_id) where ops_event_id is not null;

-- What a request with p_fingerprint, from p_client_key, should get for this
-- attempt:
--   'mismatch'     the key was used for a different event, basket or buyer
--   'other_client' the key belongs to another client (its client key
--                  differs; null matches only null): neither the order nor
--                  the session is given out, nor the attempt retried
--   'in_progress'  another request holds a live lease
--   'completed'    its order is paid (or was paid and refunded)
--   'replay'       open, its order pending, its session (and hold) unexpired
--   'expired'      open, but its order failed or was cancelled, or its
--                  session or hold ended
--   'retry'        failed, or its lease lapsed: it may be tried again
create function private.checkout_attempt_state(
  p_attempt private.checkout_attempts, p_fingerprint text, p_client_key text
) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_attempt.fingerprint <> p_fingerprint then 'mismatch'
    when p_attempt.client_key is distinct from p_client_key then 'other_client'
    when p_attempt.status = 'in_progress' and p_attempt.lease_expires_at > now() then 'in_progress'
    when p_attempt.status = 'completed'
      or o.status in ('paid', 'oversold_refund_required', 'refunded') then 'completed'
    when p_attempt.status = 'open' and o.status = 'pending' and p_attempt.session_expires_at > now()
      and (p_attempt.hold_expires_at is null or p_attempt.hold_expires_at > now()) then 'replay'
    when p_attempt.status = 'open' then 'expired'
    else 'retry'
  end
  from (select 1) one
  left join public.orders o on o.id = p_attempt.order_id;
$$;

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------

-- An ops alert about a surge of paid checkouts for p_event_id (the
-- circuit breaker below): queued unless 10 have been in the last 24 hours
-- platform-wide or one is already waiting for the event. Returns whether a
-- job was queued.
create function private.queue_checkout_surge_alert(p_event_id uuid) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if not private.take_platform_rate_limit('ops_alerts_checkout_surge', 10, interval '24 hours') then
    return false;
  end if;
  insert into private.email_outbox (kind, ops_event_id) values ('ops_alert', p_event_id)
  on conflict (ops_event_id) where status in ('pending', 'sending') and ops_event_id is not null do nothing;
  return found;
end;
$$;

-- One general admission paid checkout: per client (p_client_key, null to
-- skip) p_event_limit for this event and p_all_limit across all events,
-- each per p_window: 'event' or 'all' when refused (writing nothing). Then
-- the event's circuit breaker, p_event_wide_limit per p_window across all
-- clients: never a refusal; crossing it queues an ops alert, at most one
-- per event per p_window ('surge'). Otherwise 'ok'.
create function private.take_checkout_attempt(
  p_client_key text, p_event_id uuid, p_event_limit integer, p_all_limit integer,
  p_event_wide_limit integer, p_window interval
) returns text
language plpgsql
set search_path = ''
as $$
begin
  begin
    if p_client_key is not null then
      if not private.take_client_rate_limit(p_client_key, 'checkouts:' || p_event_id::text, p_event_limit, p_window) then
        raise exception 'event checkouts' using errcode = 'SH441';
      end if;
      if not private.take_client_rate_limit(p_client_key, 'checkouts', p_all_limit, p_window) then
        raise exception 'checkouts' using errcode = 'SH442';
      end if;
    end if;
  exception
    when sqlstate 'SH441' then return 'event';
    when sqlstate 'SH442' then return 'all';
  end;
  -- Nested, not one `and`: SQL doesn't promise to evaluate (and stop) left to right.
  if p_event_wide_limit is not null then
    if not private.take_event_rate_limit(p_event_id, 'checkouts', p_event_wide_limit, p_window) then
      if private.take_event_rate_limit(p_event_id, 'checkout_surge_alert', 1, p_window) then
        if private.queue_checkout_surge_alert(p_event_id) then
          return 'surge';
        end if;
      end if;
    end if;
  end if;
  return 'ok';
end;
$$;

-- The limits for one attempt of p_kind: general admission through
-- take_checkout_attempt; seated through take_seat_hold_attempt (per client
-- only: hold_seats keeps the event's). Returns 'ok', 'ok_alerted' (ok, and
-- a surge alert was queued), 'client_event_limit' or 'client_all_limit'; a
-- refusal writes nothing.
create function private.take_checkout_limits(
  p_kind text, p_client_key text, p_event_id uuid, p_client_event_limit integer, p_client_all_limit integer,
  p_event_limit integer, p_window interval
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_result text;
begin
  if p_kind = 'seated' then
    if p_client_key is null then
      return 'ok';
    end if;
    v_result := private.take_seat_hold_attempt(p_client_key, p_event_id, p_client_event_limit, p_client_all_limit, p_window);
  else
    v_result := private.take_checkout_attempt(
      p_client_key, p_event_id, p_client_event_limit, p_client_all_limit, p_event_limit, p_window);
  end if;
  if v_result is null or v_result not in ('ok', 'surge', 'event', 'all') then
    raise exception 'take_checkout_limits: unexpected result %', v_result using errcode = 'P0001';
  end if;
  return case v_result
    when 'ok' then 'ok'
    when 'surge' then 'ok_alerted'
    when 'event' then 'client_event_limit'
    else 'client_all_limit'
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

-- Fails p_order_id if it's still pending: a seated order through
-- release_seat_holds (its seats freed), a general admission one directly.
-- Returns release_seat_holds' answer ('released', 'not_found', or the
-- order's status when it isn't pending).
create function private.release_checkout_order(p_order_id text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_seated boolean;
  v_status public.order_status;
begin
  select o.seat_ids is not null into v_seated from public.orders o where o.id = p_order_id;
  if not found then
    return 'not_found';
  end if;
  if v_seated then
    return private.release_seat_holds(p_order_id);
  end if;
  select o.status into v_status from public.orders o where o.id = p_order_id for update;
  if v_status <> 'pending' then
    return v_status::text;
  end if;
  update public.orders set status = 'failed' where id = p_order_id;
  return 'released';
end;
$$;

-- ---------------------------------------------------------------------------
-- Begin, finish, fail
-- ---------------------------------------------------------------------------

-- Claims key p_key (for event p_event_id) for one request from client
-- p_client_key (null: none). result:
--   'create'              go ahead under lease p_lease_token: make order
--                         attempt_order_id (p_new_order_id) and its session;
--                         or, when `reused`, make the session for the
--                         existing pending order attempt_order_id
--   'replay'              answer with attempt_order_id, attempt_session_url
--                         and attempt_hold_expires_at
--   'in_progress'         409, retry_after_seconds left on the lease
--   'mismatch'            422
--   'other_client'        409, nothing given out or changed
--   'expired'             409 start a new checkout
--   'completed'           409 already paid (attempt_order_status: paid,
--                         oversold_refund_required or refunded)
--   'client_event_limit', 'client_all_limit'
--                         429; nothing written
-- alert_queued: taking the limits queued a checkout surge alert.
create function private.begin_checkout_attempt(
  p_event_id uuid, p_key uuid, p_kind text, p_fingerprint text, p_new_order_id text,
  p_lease_token uuid, p_lease interval, p_reuse_within interval,
  p_client_key text, p_client_event_limit integer, p_client_all_limit integer,
  p_event_limit integer, p_window interval,
  out result text, out attempt_order_id text, out reused boolean, out attempt_session_url text,
  out attempt_hold_expires_at timestamptz, out retry_after_seconds integer, out attempt_order_status text,
  out alert_queued boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_row private.checkout_attempts;
  v_state text;
  v_limit text;
  v_order record;
  v_has_order boolean;
begin
  reused := false;
  alert_queued := false;
  -- A new key: the row and the limits together. A refusal keeps neither.
  begin
    insert into private.checkout_attempts as a
      (event_id, idempotency_key, kind, fingerprint, status, order_id, lease_token, lease_expires_at, client_key)
    values (p_event_id, p_key, p_kind, p_fingerprint, 'in_progress', p_new_order_id, p_lease_token, now() + p_lease,
            p_client_key)
    on conflict (idempotency_key) do nothing;
    if found then
      v_limit := private.take_checkout_limits(
        p_kind, p_client_key, p_event_id, p_client_event_limit, p_client_all_limit, p_event_limit, p_window);
      if v_limit not in ('ok', 'ok_alerted') then
        raise exception 'checkout limit' using errcode = 'SH449';
      end if;
      result := 'create';
      attempt_order_id := p_new_order_id;
      alert_queued := v_limit = 'ok_alerted';
      return;
    end if;
  exception
    when sqlstate 'SH449' then
      result := v_limit;
      return;
  end;

  -- The key exists (or a concurrent request just made it: the insert waited
  -- for it), maybe for another event: the fingerprint covers the event.
  select * into v_row from private.checkout_attempts a
   where a.idempotency_key = p_key
     for update;
  if not found then
    raise exception 'checkout attempt vanished' using errcode = 'P0002';
  end if;
  v_state := private.checkout_attempt_state(v_row, p_fingerprint, p_client_key);

  if v_state = 'in_progress' then
    result := 'in_progress';
    retry_after_seconds := greatest(1, ceil(extract(epoch from v_row.lease_expires_at - now())))::integer;
    return;
  elsif v_state = 'completed' then
    if v_row.status <> 'completed' then
      update private.checkout_attempts a
         set status = 'completed', lease_token = null, lease_expires_at = null, updated_at = now()
       where a.idempotency_key = p_key;
    end if;
    result := 'completed';
    select o.status::text into attempt_order_status from public.orders o where o.id = v_row.order_id;
    return;
  elsif v_state = 'replay' then
    result := 'replay';
    attempt_order_id := v_row.order_id;
    attempt_session_url := v_row.session_url;
    attempt_hold_expires_at := v_row.hold_expires_at;
    return;
  elsif v_state in ('mismatch', 'other_client', 'expired') then
    result := v_state;
    return;
  end if;

  -- 'retry'. Reuse the order if it's still pending with no session and young
  -- enough for Stripe to take the same parameters again.
  select o.status, o.stripe_checkout_session_id, o.created_at into v_order
    from public.orders o where o.id = v_row.order_id;
  v_has_order := found;
  if v_has_order and v_order.status = 'pending' and v_order.stripe_checkout_session_id is null
     and v_order.created_at > now() - p_reuse_within then
    reused := true;
    attempt_order_id := v_row.order_id;
  else
    v_limit := private.take_checkout_limits(
      p_kind, p_client_key, p_event_id, p_client_event_limit, p_client_all_limit, p_event_limit, p_window);
    if v_limit not in ('ok', 'ok_alerted') then
      result := v_limit;
      return;
    end if;
    alert_queued := v_limit = 'ok_alerted';
    if v_has_order and v_order.status = 'pending' then
      perform private.release_checkout_order(v_row.order_id);
    end if;
    attempt_order_id := p_new_order_id;
  end if;

  update private.checkout_attempts a
     set status = 'in_progress', order_id = attempt_order_id, lease_token = p_lease_token,
         lease_expires_at = now() + p_lease, session_url = null, session_expires_at = null,
         hold_expires_at = null, updated_at = now()
   where a.idempotency_key = p_key;
  result := 'create';
end;
$$;

-- The session made under p_lease_token: recorded on the order (still
-- pending, locked) and the attempt opened. Returns 'open', 'order_closed'
-- (the order failed or was paid meanwhile: the attempt fails, nothing is
-- recorded) or 'lost' (the lease isn't this request's any more: nothing
-- changes).
create function private.finish_checkout_attempt(
  p_event_id uuid, p_key uuid, p_lease_token uuid, p_session_id text, p_session_url text,
  p_session_expires_at timestamptz, p_hold_expires_at timestamptz
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_row private.checkout_attempts;
  v_status public.order_status;
begin
  select * into v_row from private.checkout_attempts a
   where a.event_id = p_event_id and a.idempotency_key = p_key
     for update;
  if not found or v_row.status <> 'in_progress' or v_row.lease_token is distinct from p_lease_token then
    return 'lost';
  end if;
  select o.status into v_status from public.orders o where o.id = v_row.order_id for update;
  if v_status is distinct from 'pending' then
    update private.checkout_attempts a
       set status = 'failed', lease_token = null, lease_expires_at = null, updated_at = now()
     where a.idempotency_key = p_key;
    return 'order_closed';
  end if;
  update public.orders set stripe_checkout_session_id = p_session_id where id = v_row.order_id;
  update private.checkout_attempts a
     set status = 'open', session_url = p_session_url, session_expires_at = p_session_expires_at,
         hold_expires_at = p_hold_expires_at, lease_token = null, lease_expires_at = null, updated_at = now()
   where a.idempotency_key = p_key;
  return 'open';
end;
$$;

-- The try under p_lease_token failed: the attempt is failed and its lease
-- released; with p_release, its order is released too (release_checkout_order).
-- Returns 'failed', or 'lost' when the lease isn't this request's (nothing
-- changes: another request may be reusing the order).
create function private.fail_checkout_attempt(p_event_id uuid, p_key uuid, p_lease_token uuid, p_release boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_row private.checkout_attempts;
begin
  select * into v_row from private.checkout_attempts a
   where a.event_id = p_event_id and a.idempotency_key = p_key
     for update;
  if not found or v_row.status <> 'in_progress' or v_row.lease_token is distinct from p_lease_token then
    return 'lost';
  end if;
  if p_release and v_row.order_id is not null then
    perform private.release_checkout_order(v_row.order_id);
  end if;
  update private.checkout_attempts a
     set status = 'failed', lease_token = null, lease_expires_at = null, updated_at = now()
   where a.idempotency_key = p_key;
  return 'failed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- As in 20261104000000_payment_reconciliation.sql (refund status marks
-- included), plus checkout attempts 2
-- days after creation (D11). An order a failed or abandoned attempt kept
-- pending for reuse, with no session ever recorded, is marked failed first:
-- no Checkout Session lives 2 days, so nothing can be paid for it.
drop function private.purge_operational_data();

create function private.purge_operational_data(
  out unconfirmed_orders_deleted integer, out platform_rate_limits_deleted integer,
  out free_order_refusals_deleted integer, out email_jobs_deleted integer,
  out client_rate_limits_deleted integer, out early_charge_refunds_deleted integer,
  out payment_exceptions_deleted integer, out refund_status_marks_deleted integer,
  out checkout_attempts_deleted integer)
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

  delete from private.early_charge_refunds r where r.updated_at < now() - interval '35 days';
  get diagnostics early_charge_refunds_deleted = row_count;

  delete from private.payment_exceptions e
   where e.status = 'resolved' and e.resolved_at < now() - interval '2 years';
  get diagnostics payment_exceptions_deleted = row_count;

  delete from private.refund_status_marks m where m.updated_at < now() - interval '35 days';
  get diagnostics refund_status_marks_deleted = row_count;

  update public.orders o set status = 'failed'
    from private.checkout_attempts a
   where a.created_at < now() - interval '2 days' and a.status in ('in_progress', 'failed')
     and o.id = a.order_id and o.status = 'pending' and o.stripe_checkout_session_id is null;
  delete from private.checkout_attempts a where a.created_at < now() - interval '2 days';
  get diagnostics checkout_attempts_deleted = row_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.checkout_attempt_state(private.checkout_attempts, text, text) from public, anon, authenticated;
revoke all on function private.queue_checkout_surge_alert(uuid) from public, anon, authenticated;
revoke all on function private.take_checkout_attempt(text, uuid, integer, integer, integer, interval) from public, anon, authenticated;
revoke all on function private.take_checkout_limits(text, text, uuid, integer, integer, integer, interval) from public, anon, authenticated;
revoke all on function private.release_checkout_order(text) from public, anon, authenticated;
revoke all on function private.begin_checkout_attempt(uuid, uuid, text, text, text, uuid, interval, interval, text, integer, integer, integer, interval) from public, anon, authenticated;
revoke all on function private.finish_checkout_attempt(uuid, uuid, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.fail_checkout_attempt(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.purge_operational_data() from public, anon, authenticated;
