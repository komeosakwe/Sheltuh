-- Messaging hardening (security review of 20261003000000_messages.sql).
--
-- 1. Blocks keep a snapshot of the blocked member's display name
--    (user_blocks.blocked_display_name), taken when the block is made. The
--    blocks list used to read the live profile, which told the blocker when
--    the blocked member renamed, deleted or recreated their profile.
-- 2. private.create_block: blocking in one step. Only a member the blocker can
--    currently see: the other member of a conversation visible to them (or a
--    request they declined), or an attendeeId on a Who's Going list they may
--    currently view (same rules as GET /going/attendees). Anything else,
--    including a member already blocked either way, is 'not_found', so a
--    block can't be used to test whether two handles are the same person.
--    Rate-limited per blocker.
-- 3. private.conversation_pairs: a content-free record of every pair that has
--    had a conversation, keyed on the accounts (cascade from auth.users only,
--    not from profiles). Deleting and recreating a profile deletes the
--    conversation but not the pair, so a declined request can't be sent again
--    and "one conversation per pair" holds. A request for a pair on record
--    with no conversation is 'unavailable' (404, like a block).
-- 4. private.request_conversation also caps the requests one member can
--    *receive* per window (fixed-window counter 'incoming_requests' in
--    private.rate_limits, keyed on the recipient). Over the cap the request is
--    'unavailable', indistinguishable from any other unavailable member, and
--    none of the sender's rate-limit hits are kept.
-- 5. private.file_report key-share-locks the conversation and the reported
--    message before copying them, so a concurrent profile deletion or
--    retention purge waits for the report instead of making its insert fail
--    (23503, a 500). A reported account deleted mid-call (foreign key) or a
--    deadlock with an account deletion is mapped to 'not_found'.
-- 6. private.purge_social_data also deletes pair records with no
--    conversation 12 months after the pair's first request (when the
--    conversation itself would have been purged at the earliest).
-- 7. Sequences in `public` grant nothing to anon/authenticated (Supabase
--    grants new sequences to them by default; event_moderation_log_id_seq was
--    never revoked).
--
-- Access model unchanged: RLS on, no policies, no grants to anon or
-- authenticated, every function's execute revoked from PUBLIC.
--
-- Reversible, with care: drop function private.create_block; drop and recreate
-- private.request_conversation, private.file_report and
-- private.purge_social_data from 20261003000000_messages.sql; drop table
-- private.conversation_pairs; drop column user_blocks.blocked_display_name.
-- Dropping the table and the column discards data (which pairs have met, the
-- names on blocks), so reversing after launch is destructive. The sequence
-- revoke needs no reversal.

-- ---------------------------------------------------------------------------
-- 1. Block name snapshots
-- ---------------------------------------------------------------------------

-- Null only for blocks made before this migration whose blocked member had no
-- profile left. Same limits as profiles.display_name, which it's copied from.
alter table public.user_blocks
  add column blocked_display_name text
    check (char_length(blocked_display_name) between 1 and 40);

update public.user_blocks b
   set blocked_display_name = p.display_name
  from public.profiles p
 where p.user_id = b.blocked_id;

-- ---------------------------------------------------------------------------
-- 2. Pairs that have met
-- ---------------------------------------------------------------------------

create table private.conversation_pairs (
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  -- When the pair's first request was sent: the retention anchor.
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint conversation_pairs_ordered check (user_low < user_high)
);

-- The auth.users FK cascade on user_high (user_low is served by the primary
-- key). No index on created_at: only the daily purge filters on it.
create index conversation_pairs_user_high_idx on private.conversation_pairs (user_high);

alter table private.conversation_pairs enable row level security;
revoke all on private.conversation_pairs from public, anon, authenticated;

insert into private.conversation_pairs (user_low, user_high, created_at)
select c.user_low, c.user_high, c.created_at from public.conversations c
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Requests: pair record + incoming cap
-- ---------------------------------------------------------------------------

-- As in 20261003000000_messages.sql, plus:
--   * a pair on record with no conversation any more (a member deleted their
--     profile) is 'unavailable': one conversation per pair, ever;
--   * p_incoming_limit per p_incoming_window requests received by the
--     recipient; over it, 'unavailable';
--   * the recipient's account or profile deleted mid-call is 'unavailable'.
-- Lock order unchanged (sender's profile, then rate-limit rows, then the
-- pair). Two members requesting each other at once now collide on the pair's
-- primary key; the second gets 'exists', and its rate-limit hits (its own and
-- the recipient's incoming count) are rolled back.
drop function private.request_conversation(uuid, uuid, text, integer, interval, integer, interval);

create function private.request_conversation(
  p_sender_id uuid, p_attendee_id uuid, p_body text,
  p_request_limit integer, p_request_window interval,
  p_message_limit integer, p_message_window interval,
  p_incoming_limit integer, p_incoming_window interval,
  out result text, out new_conversation_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_target uuid;
  v_low uuid;
  v_high uuid;
  v_message_id bigint;
  v_refusal text;
begin
  if exists (select 1 from private.social_suspensions s where s.user_id = p_sender_id) then
    result := 'sender_suspended';
    return;
  end if;

  perform 1 from public.profiles p where p.user_id = p_sender_id for no key update;
  if not found then
    result := 'not_going';
    return;
  end if;

  select a.event_id, a.user_id into v_event_id, v_target
    from public.event_attendees a
    join public.events e on e.id = a.event_id
   where a.id = p_attendee_id and e.status = 'published' and e.whos_going_enabled and e.ends_at > now();
  if not found then
    result := 'unavailable';
    return;
  end if;

  if not exists (select 1 from public.event_attendees a where a.event_id = v_event_id and a.user_id = p_sender_id) then
    result := 'not_going';
    return;
  end if;

  if v_target = p_sender_id then
    result := 'self';
    return;
  end if;

  v_low := least(p_sender_id, v_target);
  v_high := greatest(p_sender_id, v_target);

  if exists (select 1 from private.social_suspensions s where s.user_id = v_target)
     or exists (select 1 from public.user_blocks b
                 where (b.blocker_id = v_low and b.blocked_id = v_high)
                    or (b.blocker_id = v_high and b.blocked_id = v_low)) then
    result := 'unavailable';
    return;
  end if;

  if exists (select 1 from public.conversations c where c.user_low = v_low and c.user_high = v_high) then
    result := 'exists';
    return;
  end if;

  -- They've had a conversation that's gone (a profile was deleted): no second one.
  if exists (select 1 from private.conversation_pairs cp where cp.user_low = v_low and cp.user_high = v_high) then
    result := 'unavailable';
    return;
  end if;

  begin
    v_refusal := 'rate_limited';
    if not private.take_rate_limit(p_sender_id, 'conversation_requests', p_request_limit, p_request_window) then
      raise exception 'rate limited' using errcode = 'P0001';
    end if;
    if not private.take_rate_limit(p_sender_id, 'messages', p_message_limit, p_message_window) then
      raise exception 'rate limited' using errcode = 'P0001';
    end if;
    v_refusal := 'unavailable';
    if not private.take_rate_limit(v_target, 'incoming_requests', p_incoming_limit, p_incoming_window) then
      raise exception 'recipient over incoming limit' using errcode = 'P0001';
    end if;

    insert into private.conversation_pairs (user_low, user_high) values (v_low, v_high);

    insert into public.conversations (user_low, user_high, initiator_id, event_id)
    values (v_low, v_high, p_sender_id, v_event_id)
    returning id into new_conversation_id;

    insert into public.messages (conversation_id, sender_id, body)
    values (new_conversation_id, p_sender_id, p_body)
    returning id into v_message_id;

    -- The sender has read their own message.
    update public.conversations c
       set low_last_read_id = case when p_sender_id = v_low then v_message_id else 0 end,
           high_last_read_id = case when p_sender_id = v_high then v_message_id else 0 end
     where c.id = new_conversation_id;
  exception
    when unique_violation then
      result := 'exists';
      new_conversation_id := null;
      return;
    when raise_exception then
      result := v_refusal;
      new_conversation_id := null;
      return;
    when foreign_key_violation then
      -- The recipient's profile or account was deleted mid-call.
      result := 'unavailable';
      new_conversation_id := null;
      return;
  end;

  result := 'sent';
end;
$$;

revoke all on function private.request_conversation(uuid, uuid, text, integer, interval, integer, interval, integer, interval)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Blocking
-- ---------------------------------------------------------------------------

-- p_blocker_id blocks the other member of p_conversation_id, or the member
-- behind p_attendee_id (exactly one). Returns (result, block_id, block_name,
-- block_created_at):
--   'blocked'      blocked, or already blocked by them (the existing block,
--                  unchanged: same result, so a repeat reveals nothing)
--   'not_found'    nothing the blocker can currently see:
--                  * a conversation: not theirs, or hidden from them (either
--                    blocks the other, the other is suspended), unless it's a
--                    request they declined (always blockable);
--                  * an attendeeId: not on a Who's Going list they may view
--                    now (event published, enabled and not ended; blocker has
--                    a profile and isn't suspended; attendee isn't suspended;
--                    neither blocks the other);
--                  * the target's account deleted mid-call.
--   'self'         the blocker's own attendeeId
--   'rate_limited' over p_limit blocks per p_window (only valid blocks count)
-- The name is the target's display name now; it's never refreshed.
create function private.create_block(
  p_blocker_id uuid, p_conversation_id uuid, p_attendee_id uuid, p_limit integer, p_window interval,
  out result text, out block_id uuid, out block_name text, out block_created_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_target uuid;
  v_name text;
begin
  if (p_conversation_id is null) = (p_attendee_id is null) then
    result := 'not_found';
    return;
  end if;

  if p_conversation_id is not null then
    select case when c.user_low = p_blocker_id then c.user_high else c.user_low end into v_target
      from public.conversations c
     where c.id = p_conversation_id
       and (c.user_low = p_blocker_id or c.user_high = p_blocker_id)
       and ((c.status = 'declined' and c.initiator_id <> p_blocker_id)
            or (not exists (select 1 from public.user_blocks b
                             where (b.blocker_id = c.user_low and b.blocked_id = c.user_high)
                                or (b.blocker_id = c.user_high and b.blocked_id = c.user_low))
                and not exists (select 1 from private.social_suspensions s
                                 where s.user_id = case when c.user_low = p_blocker_id then c.user_high else c.user_low end)));
  else
    select a.user_id into v_target
      from public.event_attendees a
      join public.events e on e.id = a.event_id
     where a.id = p_attendee_id
       and e.status = 'published' and e.whos_going_enabled and e.ends_at > now()
       and exists (select 1 from public.profiles p where p.user_id = p_blocker_id)
       and not exists (select 1 from private.social_suspensions s where s.user_id in (p_blocker_id, a.user_id))
       and not exists (select 1 from public.user_blocks b
                        where (b.blocker_id = p_blocker_id and b.blocked_id = a.user_id)
                           or (b.blocker_id = a.user_id and b.blocked_id = p_blocker_id));
  end if;
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
    -- On conflict, a no-op update so the existing block comes back unchanged
    -- (its original name and time), even if it was made concurrently.
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

revoke all on function private.create_block(uuid, uuid, uuid, integer, interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reports: lock what's referenced
-- ---------------------------------------------------------------------------

-- As in 20261003000000_messages.sql, except that the conversation and the
-- reported message are key-share-locked when they're found (conversation
-- first, then message: the order every deletion takes them in), so they
-- can't be deleted until the report is in. A deletion already under way
-- makes the lookup wait and then find nothing: 'not_found'. The reported
-- account deleted mid-call (foreign key), or a deadlock with an account
-- deletion (which locks the account before the conversation), is also
-- 'not_found', with the rate-limit hit rolled back.
create or replace function private.file_report(
  p_reporter_id uuid, p_conversation_id uuid, p_attendee_id uuid, p_message_id bigint,
  p_reason text, p_details text, p_limit integer, p_window interval,
  out result text, out new_report_id uuid, out filed_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_reported uuid;
  v_event_id uuid;
  v_message_body text;
  v_context jsonb := '[]'::jsonb;
  v_display_name text;
begin
  if (p_conversation_id is null) = (p_attendee_id is null)
     or (p_message_id is not null and p_conversation_id is null) then
    result := 'not_found';
    return;
  end if;

  if p_conversation_id is not null then
    select case when c.user_low = p_reporter_id then c.user_high else c.user_low end, c.event_id
      into v_reported, v_event_id
      from public.conversations c
     where c.id = p_conversation_id and (c.user_low = p_reporter_id or c.user_high = p_reporter_id)
       for key share;
    if not found then
      result := 'not_found';
      return;
    end if;

    if p_message_id is not null then
      select m.body into v_message_body
        from public.messages m
       where m.id = p_message_id and m.conversation_id = p_conversation_id and m.sender_id = v_reported
         for key share;
      if not found then
        result := 'not_found';
        return;
      end if;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'from', case when m.sender_id = p_reporter_id then 'reporter' else 'reported' end,
             'body', m.body, 'sentAt', m.created_at) order by m.id), '[]'::jsonb)
      into v_context
      from (select m.id, m.sender_id, m.body, m.created_at
              from public.messages m
             where m.conversation_id = p_conversation_id and (p_message_id is null or m.id <= p_message_id)
             order by m.id desc
             limit 20) m;
  else
    select a.user_id, a.event_id into v_reported, v_event_id
      from public.event_attendees a where a.id = p_attendee_id;
    if not found then
      result := 'not_found';
      return;
    end if;
    if v_reported = p_reporter_id then
      result := 'self';
      return;
    end if;
  end if;

  select p.display_name into v_display_name from public.profiles p where p.user_id = v_reported;

  begin
    if not private.take_rate_limit(p_reporter_id, 'user_reports', p_limit, p_window) then
      raise exception 'rate limited' using errcode = 'P0001';
    end if;

    insert into private.user_reports (reporter_id, reported_user_id, conversation_id, message_id, event_id,
                                      reason, details, reported_display_name, message_body, context)
    values (p_reporter_id, v_reported, p_conversation_id, p_message_id, v_event_id,
            p_reason, p_details, v_display_name, v_message_body, v_context)
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

revoke all on function private.file_report(uuid, uuid, uuid, bigint, text, text, integer, interval)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Retention
-- ---------------------------------------------------------------------------

-- Same as 20261003000000_messages.sql, plus pair records with no
-- conversation, 12 months after the pair's first request (a declined or
-- unanswered request's conversation is purged at exactly that point; an
-- accepted one's no earlier). Runs after the conversation purge, so a pair
-- whose conversation was just purged goes in the same run. New OUT column,
-- hence drop + create; `select private.purge_social_data()` is unaffected.
drop function private.purge_social_data();

create function private.purge_social_data(
  out event_attendees_deleted integer, out rate_limits_deleted integer,
  out conversations_deleted integer, out user_reports_deleted integer,
  out conversation_pairs_deleted integer)
language plpgsql
set search_path = ''
as $$
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
end;
$$;

revoke all on function private.purge_social_data() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Sequences
-- ---------------------------------------------------------------------------

revoke all on all sequences in schema public from anon, authenticated;
