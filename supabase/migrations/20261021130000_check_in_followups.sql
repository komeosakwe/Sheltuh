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
