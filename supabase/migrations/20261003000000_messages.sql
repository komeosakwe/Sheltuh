-- Messages (Who's Going, increment 2): direct messages between members.
--
-- Who can message whom:
--   * First contact is one "request" message, and only between two members
--     who have both opted in to the same event's Who's Going while it's open
--     (published, whos_going_enabled, not ended), neither suspended
--     (private.social_suspensions) and neither blocking the other.
--   * The recipient accepts by replying. Until then the sender can't send
--     anything more. Declining is silent: the sender still sees their request
--     as waiting, and the conversation disappears for the recipient.
--   * One conversation per pair of members, ever (user_low < user_high,
--     unique).
--   * After that, an accepted conversation carries on whatever happens to the
--     event. Blocks and suspensions hide it from both members and stop it.
--
-- Rate limits (private.take_rate_limit, limits passed in by the API): new
-- requests per 24 hours and messages per hour, per sender; reports per day.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC. Only the
-- API (lib/server/handlers/messages.ts, blocks.ts, reports.ts, and going.ts,
-- which leaves blocked members out of each other's attendee lists) reads or
-- writes these.
--
-- Deletion:
--   * conversations and messages reference profiles: deleting a profile (or
--     the account) deletes every conversation that member is in, for both
--     members, with its messages.
--   * user_blocks reference the account, not the profile, so deleting and
--     recreating a profile doesn't lift a block.
--   * private.user_reports keep a copy of the reported messages, and every
--     reference is `on delete set null`, so the evidence outlives the
--     messages, the conversation and either account.
--   * private.purge_social_data (now also) deletes conversations 12 months
--     after their last message, and resolved reports 2 years after
--     resolution.
--
-- Reversible: drop functions private.request_conversation,
-- private.send_message, private.file_report and private.resolve_report; drop
-- and recreate private.purge_social_data from
-- 20261002000000_whos_going_hardening.sql; drop tables private.user_reports,
-- public.messages, public.conversations and public.user_blocks. Dropping the
-- tables deletes every message, block and report, so reversing it after
-- launch is destructive.

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

create table public.conversations (
  -- Exposed to the two members as the opaque conversationId.
  id uuid primary key default gen_random_uuid(),
  -- The pair, in a fixed order so (a, b) and (b, a) are the same row.
  user_low uuid not null references public.profiles (user_id) on delete cascade,
  user_high uuid not null references public.profiles (user_id) on delete cascade,
  -- Who sent the request.
  initiator_id uuid not null,
  -- The event both were going to when the request was sent (context only).
  event_id uuid references public.events (id) on delete set null,
  status text not null default 'requested' check (status in ('requested', 'accepted', 'declined')),
  -- The last message id each member has read (0: none).
  low_last_read_id bigint not null default 0 check (low_last_read_id >= 0),
  high_last_read_id bigint not null default 0 check (high_last_read_id >= 0),
  -- Newest message, for ordering the inbox and for retention.
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint conversations_pair_ordered check (user_low < user_high),
  constraint conversations_initiator_in_pair check (initiator_id = user_low or initiator_id = user_high),
  constraint conversations_pair_key unique (user_low, user_high)
);

-- "My conversations" is `user_low = me or user_high = me`: the unique
-- (user_low, user_high) index serves the first half, this one the second
-- (and the profiles FK cascade on user_high). No index on event_id (events
-- are never deleted by the app) or last_message_at (only the daily purge
-- filters on it; an index would make every message's update non-HOT).
create index conversations_user_high_idx on public.conversations (user_high);

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

create table public.messages (
  -- Exposed as the opaque messageId; increasing, so it's the keyset cursor.
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (user_id) on delete cascade,
  -- Plain text. The API trims and validates it; this is the backstop.
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- A conversation's messages in order (paging, unread, last message).
create index messages_conversation_id_idx on public.messages (conversation_id, id);
-- The profiles FK cascade, and moderation lookups of what one member sent.
create index messages_sender_created_idx on public.messages (sender_id, created_at);

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------

create table public.user_blocks (
  -- Exposed to the blocker as the opaque blockId.
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_blocks_not_self check (blocker_id <> blocked_id),
  constraint user_blocks_pair_key unique (blocker_id, blocked_id)
);

-- "Is either blocking the other" checks both (blocker, blocked) orders, which
-- the unique index serves; this one serves the auth.users FK cascade on
-- blocked_id.
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- ---------------------------------------------------------------------------
-- Reports (moderation data: private schema, like social_suspensions)
-- ---------------------------------------------------------------------------

create table private.user_reports (
  id uuid primary key default gen_random_uuid(),
  -- Every reference is set null on delete, so a report survives the
  -- messages, the conversation and either account.
  reporter_id uuid references auth.users (id) on delete set null,
  reported_user_id uuid references auth.users (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  message_id bigint references public.messages (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  reason text not null check (reason in ('harassment', 'spam', 'inappropriate', 'impersonation', 'other')),
  details text check (char_length(details) between 1 and 1000),
  -- Copies taken when the report was made.
  reported_display_name text,
  message_body text,
  -- Up to the last 20 messages of the conversation (up to the reported one):
  -- [{from: 'reporter'|'reported', body, sentAt}], oldest first.
  context jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (char_length(resolution_note) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint user_reports_resolved_when_closed check ((status = 'open') = (resolved_at is null))
);

-- The admin queue: by status, oldest first.
create index user_reports_status_created_idx on private.user_reports (status, created_at);
-- The `on delete set null` FKs look reports up by these on every delete of a
-- message (retention deletes many), a conversation or an account. Partial:
-- most reports have no message or conversation. resolved_by and event_id
-- aren't indexed: admins' accounts and events are never deleted in practice.
create index user_reports_message_idx on private.user_reports (message_id) where message_id is not null;
create index user_reports_conversation_idx on private.user_reports (conversation_id) where conversation_id is not null;
create index user_reports_reported_user_idx on private.user_reports (reported_user_id);
create index user_reports_reporter_idx on private.user_reports (reporter_id);

-- ---------------------------------------------------------------------------
-- Lock the Data API out
-- ---------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.user_blocks enable row level security;
alter table private.user_reports enable row level security;

revoke all on public.conversations, public.messages, public.user_blocks from anon, authenticated;
revoke all on sequence public.messages_id_seq from anon, authenticated;
revoke all on private.user_reports from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Start a conversation
-- ---------------------------------------------------------------------------

-- Sends p_body as a request from p_sender_id to the member behind
-- p_attendee_id (the opaque id on a Who's Going list). Returns
-- (result, new_conversation_id):
--   'sent'             created; new_conversation_id is set
--   'sender_suspended' the sender is suspended
--   'unavailable'      no such attendee, Who's Going for that event isn't
--                      open, the recipient is suspended, or either blocks
--                      the other (deliberately indistinguishable)
--   'not_going'        the sender isn't opted in to that event
--   'self'             that's the sender's own attendee id
--   'exists'           the pair already has a conversation (including one
--                      where the other member's request just won the race)
--   'rate_limited'     over p_request_limit per p_request_window, or
--                      p_message_limit per p_message_window
-- The sender's profile is locked first (no key update: it doesn't block the
-- FK checks of the other member's concurrent inserts, so mutual requests
-- can't deadlock), which serialises one member's requests and messages. Two
-- members requesting each other at once both pass the "exists" check; the
-- unique pair makes the second insert fail, which rolls back its rate-limit
-- hits too and returns 'exists'.
create function private.request_conversation(
  p_sender_id uuid, p_attendee_id uuid, p_body text,
  p_request_limit integer, p_request_window interval,
  p_message_limit integer, p_message_window interval,
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

  begin
    if not private.take_rate_limit(p_sender_id, 'conversation_requests', p_request_limit, p_request_window) then
      raise exception 'rate limited' using errcode = 'P0001';
    end if;
    if not private.take_rate_limit(p_sender_id, 'messages', p_message_limit, p_message_window) then
      raise exception 'rate limited' using errcode = 'P0001';
    end if;

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
      result := 'rate_limited';
      new_conversation_id := null;
      return;
  end;

  result := 'sent';
end;
$$;

revoke all on function private.request_conversation(uuid, uuid, text, integer, interval, integer, interval)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Send a message in an existing conversation
-- ---------------------------------------------------------------------------

-- Returns (result, new_message_id):
--   'sent'             sent; a reply to a request accepts it
--   'sender_suspended' the sender is suspended
--   'not_found'        not the sender's conversation, or hidden from them:
--                      either blocks the other, the other is suspended, or
--                      the sender declined it
--   'awaiting_reply'   the sender's own request hasn't been answered (also
--                      when it was declined: declining is silent)
--   'rate_limited'     over p_limit messages per p_window
-- Locks the sender's profile, then the conversation (always in that order),
-- so a sender's messages are counted one at a time and a reply and a decline
-- can't both win.
create function private.send_message(
  p_conversation_id uuid, p_sender_id uuid, p_body text, p_limit integer, p_window interval,
  out result text, out new_message_id bigint)
language plpgsql
set search_path = ''
as $$
declare
  v_low uuid;
  v_high uuid;
  v_initiator uuid;
  v_status text;
  v_other uuid;
begin
  if exists (select 1 from private.social_suspensions s where s.user_id = p_sender_id) then
    result := 'sender_suspended';
    return;
  end if;

  perform 1 from public.profiles p where p.user_id = p_sender_id for no key update;
  if not found then
    result := 'not_found';
    return;
  end if;

  select c.user_low, c.user_high, c.initiator_id, c.status into v_low, v_high, v_initiator, v_status
    from public.conversations c
   where c.id = p_conversation_id and (c.user_low = p_sender_id or c.user_high = p_sender_id)
     for no key update;
  if not found then
    result := 'not_found';
    return;
  end if;

  v_other := case when v_low = p_sender_id then v_high else v_low end;
  if exists (select 1 from private.social_suspensions s where s.user_id = v_other)
     or exists (select 1 from public.user_blocks b
                 where (b.blocker_id = v_low and b.blocked_id = v_high)
                    or (b.blocker_id = v_high and b.blocked_id = v_low)) then
    result := 'not_found';
    return;
  end if;

  if v_status in ('requested', 'declined') and v_initiator = p_sender_id then
    result := 'awaiting_reply';
    return;
  end if;
  if v_status = 'declined' then
    result := 'not_found';
    return;
  end if;

  if not private.take_rate_limit(p_sender_id, 'messages', p_limit, p_window) then
    result := 'rate_limited';
    return;
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, p_sender_id, p_body)
  returning id into new_message_id;

  update public.conversations c
     set status = 'accepted',
         last_message_at = now(),
         low_last_read_id = case when p_sender_id = v_low then new_message_id else c.low_last_read_id end,
         high_last_read_id = case when p_sender_id = v_high then new_message_id else c.high_last_read_id end
   where c.id = p_conversation_id;

  result := 'sent';
end;
$$;

revoke all on function private.send_message(uuid, uuid, text, integer, interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- Files a report by p_reporter_id about the other member of
-- p_conversation_id (optionally one of their messages, p_message_id), or
-- about the member behind p_attendee_id. Exactly one of the two. Copies the
-- reported message, the last 20 messages up to it, and the reported
-- member's display name into the report. Returns (result, new_report_id,
-- filed_at):
--   'filed'        filed
--   'not_found'    not the reporter's conversation, a message that isn't
--                  the other member's in it, or no such attendee
--   'self'         the reporter's own attendee id
--   'rate_limited' over p_limit reports per p_window
-- The reporter needn't be able to see the conversation any more (they may
-- have blocked or declined it first).
create function private.file_report(
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
     where c.id = p_conversation_id and (c.user_low = p_reporter_id or c.user_high = p_reporter_id);
    if not found then
      result := 'not_found';
      return;
    end if;

    if p_message_id is not null then
      select m.body into v_message_body
        from public.messages m
       where m.id = p_message_id and m.conversation_id = p_conversation_id and m.sender_id = v_reported;
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

  if not private.take_rate_limit(p_reporter_id, 'user_reports', p_limit, p_window) then
    result := 'rate_limited';
    return;
  end if;

  insert into private.user_reports (reporter_id, reported_user_id, conversation_id, message_id, event_id,
                                    reason, details, reported_display_name, message_body, context)
  values (p_reporter_id, v_reported, p_conversation_id, p_message_id, v_event_id,
          p_reason, p_details, v_display_name, v_message_body, v_context)
  returning id, created_at into new_report_id, filed_at;

  result := 'filed';
end;
$$;

revoke all on function private.file_report(uuid, uuid, uuid, bigint, text, text, integer, interval)
  from public, anon, authenticated;

-- Closes an open report: 'dismiss', or 'suspend', which also suspends the
-- reported member (private.social_suspensions) in the same step. Only an
-- open report can be resolved, so two admins acting at once can't both
-- succeed. Returns 'resolved', 'not_open' (already resolved: 409) or
-- 'not_found'.
create function private.resolve_report(p_report_id uuid, p_admin_id uuid, p_action text, p_note text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_reported uuid;
begin
  if p_action is null or p_action not in ('dismiss', 'suspend') then
    raise exception 'resolve_report: unknown action %', p_action using errcode = '22023';
  end if;

  update private.user_reports r
     set status = case when p_action = 'suspend' then 'actioned' else 'dismissed' end,
         resolved_by = p_admin_id,
         resolved_at = now(),
         resolution_note = p_note
   where r.id = p_report_id and r.status = 'open'
  returning r.reported_user_id into v_reported;
  if not found then
    if exists (select 1 from private.user_reports r where r.id = p_report_id) then
      return 'not_open';
    end if;
    return 'not_found';
  end if;

  -- A reported member who has since deleted their account has nothing left to suspend.
  if p_action = 'suspend' and v_reported is not null then
    insert into private.social_suspensions (user_id, reason)
    values (v_reported, 'Report ' || p_report_id::text || coalesce(': ' || p_note, ''))
    on conflict (user_id) do nothing;
  end if;

  return 'resolved';
end;
$$;

revoke all on function private.resolve_report(uuid, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- Same as 20261002000000_whos_going_hardening.sql, plus: conversations (with
-- their messages) 12 months after their last message, and resolved reports
-- 2 years after resolution. Open reports are kept until resolved. The OUT
-- columns change, which `create or replace` can't do, hence drop + create;
-- `select private.purge_social_data()` (the Cron job) is unaffected.
drop function private.purge_social_data();

create function private.purge_social_data(
  out event_attendees_deleted integer, out rate_limits_deleted integer,
  out conversations_deleted integer, out user_reports_deleted integer)
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
end;
$$;

revoke all on function private.purge_social_data() from public, anon, authenticated;
