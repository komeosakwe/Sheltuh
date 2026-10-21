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
