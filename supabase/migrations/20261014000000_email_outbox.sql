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
