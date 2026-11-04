-- "Message ticket holders": an approved organiser sends one short, plain-text
-- email about an event to everyone holding a ticket for it, without ever
-- seeing an address (docs/architecture.md, "Messages to ticket holders").
-- Sheltüh sends it, from its own address, with no Reply-To.
--
-- Sorts after 20261118000000_event_reminders.sql. Needs the outbox as that
-- file leaves it, private.email_recipient_hash (same file), private.email_key
-- (20261017000000_free_order_caps.sql), private.take_rate_limit
-- (20261002000000_whos_going_hardening.sql) and the purge as
-- 20261111000500_organiser_invite_links.sql leaves it.
--
--   * private.holder_messages: one row per message sent. event_id and
--     organiser_id (cascade: the message is derived data); sender_id the
--     organiser's account (set null if the account goes: the message and its
--     send go on); request_id, chosen by the client, unique with the event,
--     so a double click or a retry after a lost response is the same message
--     (a replay, not a second send); subject (5 to 100 characters) and body
--     (20 to 1500), plain text, no control characters (the API refuses links
--     and invisible characters too, lib/server/handlers/holder-messages.ts);
--     recipient_count (how many addresses it was queued for); attested_at
--     (the organiser's tick: "this is about the event, no promotion");
--     cancelled_at and cancelled_by (an admin stopped it: anything unsent
--     isn't sent); created_at. Deleted 12 months after it was sent
--     (private.purge_operational_data).
--   * private.holder_message_recipients: one row per address (identified by
--     private.email_recipient_hash, never the address) a message was queued
--     for, unique (message_id, recipient_hash); order_id is the order whose
--     buyer address it goes to, read at send time. sent_at is set when it was
--     sent, skip_reason (a fixed phrase) when it never will be. Cascades from
--     the message and from the order.
--   * private.email_outbox.message_recipient_id and kind `holder_message`: the
--     job for one recipient row (a unique index: one job per row, ever). Its
--     own key column, as 20261118000000_event_reminders.sql did for
--     reminder_id; both kind checks are redefined from that file with the new
--     kind, and every other kind also requires message_recipient_id to be
--     null. private.lease_outbox_jobs is not changed: an older release, leasing
--     "every kind", takes only its allowlist, so it never takes this kind.
--   * private.holder_message_suppressions (organiser_id, recipient_hash,
--     created_at; primary key (organiser_id, recipient_hash)): an inbox
--     (private.email_recipient_hash, never the address) that asked to hear no
--     more from one organiser. Cascades from the organiser. Kept as long as
--     the organiser exists: honouring a request must outlast the message it
--     was made from.
--   * private.holder_message_stop_tokens (token_hash, recipient_id, created_at):
--     the credential behind the "Stop messages from {organiser}" link in every
--     message email. The link carries a random 32-byte token; only its SHA-256
--     is stored (as the waitlist's and follower links do), one row per email
--     sent, so a resend never invalidates the link in an earlier copy.
--     Cascades from the recipient row, so it goes with the message (12 months).
--   * private.holder_message_audience(event): the one definition of "who holds
--     a ticket": the buyer of a `paid` order of the event (a partly refunded
--     order stays paid; pending, failed and refunded ones don't count; free
--     member and confirmed guest orders do) with an address, once per inbox
--     (private.email_recipient_hash), using the inbox's oldest order, leaving
--     out inboxes that suppressed the event's organiser. Used by the send and
--     by the organiser's read of the audience size.
--   * private.stop_holder_messages(token_hash): the opt-out. Suppresses the
--     inbox behind the token for the message's organiser (idempotent) and
--     marks that inbox's unsent recipient rows for the organiser as skipped.
--   * private.send_holder_message: one atomic step. It locks the organiser
--     (for share) and then the event (for no key update), as
--     private.release_tickets (20261113000000_release_tickets.sql) does, so
--     it serialises with an admin's edit, an unpublish, and with another send
--     for the same event; rechecks everything under the locks; and inserts
--     the message, its recipients and their jobs. A message with the same
--     request_id for the same event is returned as it is ('replayed', before
--     any other recheck, once ownership is proved).
--   * private.cancel_holder_message: an admin stops a message.
--
-- Rules, all under the locks. Results of send_holder_message: 'sent',
-- 'replayed', 'not_found' (no such event for this organiser, the organiser
-- isn't the actor, a null actor), 'not_approved', 'not_published',
-- 'external' (tickets are sold on another site: Sheltüh has no ticket
-- holders), 'outside_window' (it ended more than p_after_end ago; before that
-- it can be sent at any time, started or not), 'no_recipients', 'too_many'
-- (more than p_max_recipients addresses), 'audience_changed' (the audience
-- isn't p_expected_recipients, which the organiser confirmed), 'event_day_cap'
-- (p_event_day_limit in a rolling 24 hours), 'event_total_cap'
-- (p_event_total_limit ever) and 'rate_limited' (the organiser's account:
-- p_limit per p_window, take_rate_limit 'holder_messages'). `audience` is the
-- current audience for 'too_many' and 'audience_changed'. The caps count
-- cancelled messages too. The organiser's allowance is taken last, so a
-- refusal costs nothing. A null limit, subject, body or request id, or
-- p_attested not true, raises.
--
-- What is sent, to whom, is decided again at send time
-- (lib/server/email-outbox.ts, deliverHolderMessage): the inbox must still
-- hold a paid order for the event (the queued one, or another of theirs), the
-- event published, the organiser approved, the message not cancelled, the
-- address a plain one, the inbox not suppressed. The platform sends at most 600
-- of these a day (bucket 'holder_messages_daily', taken just before sending):
-- past it a job is put back an hour, never dropped.
--
-- The deadlock note: the recipient rows' foreign key to public.orders takes a
-- key-share lock on each order, which waits only for a transaction holding an
-- order `for update` (fulfil_order, a refund). Those take the order first and
-- then the event; this takes the event first. A cycle needs both to be on the
-- same paid order at once; Postgres would then abort one of them with a
-- deadlock, which the API returns as a plain error and a retry resolves.
--
-- Indexes: holder_messages (event_id, created_at desc) serves the per-event
-- caps and the organiser's history; holder_messages (created_at desc, id desc)
-- the admin list (newest first) and the 12-month purge; holder_message_recipients
-- (message_id, recipient_hash) unique serves counts per message; (order_id)
-- the cascade from public.orders; email_outbox (message_recipient_id) unique
-- the cascade from the recipients.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC and its
-- search_path pinned. No security definer.
--
-- Additive; reversible, but not without losing data: in one transaction,
-- delete the `holder_message` jobs; restore the outbox's two kind checks from
-- 20261118000000_event_reminders.sql; drop the functions send_holder_message,
-- cancel_holder_message, stop_holder_messages and holder_message_audience; drop
-- the column email_outbox.message_recipient_id, then the tables
-- private.holder_message_stop_tokens, private.holder_message_suppressions (every
-- opt-out is lost for good), private.holder_message_recipients and
-- private.holder_messages (every message and its history are lost for good); restore private.purge_operational_data
-- from 20261111000500_organiser_invite_links.sql.

-- ---------------------------------------------------------------------------
-- Messages and their recipients
-- ---------------------------------------------------------------------------

create table private.holder_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  organiser_id uuid not null references public.organisers (id) on delete cascade,
  sender_id uuid references auth.users (id) on delete set null,
  request_id uuid not null,
  subject text not null check (char_length(subject) between 5 and 100 and subject !~ '[\x01-\x1f\x7f]'),
  body text not null check (char_length(body) between 20 and 1500 and body !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
  recipient_count integer not null check (recipient_count between 0 and 1000),
  attested_at timestamptz not null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint holder_messages_event_request_key unique (event_id, request_id)
);

create index holder_messages_event_created_idx on private.holder_messages (event_id, created_at desc);
create index holder_messages_created_idx on private.holder_messages (created_at desc, id desc);

alter table private.holder_messages enable row level security;
revoke all on private.holder_messages from public, anon, authenticated;

create table private.holder_message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references private.holder_messages (id) on delete cascade,
  order_id text not null references public.orders (id) on delete cascade,
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  sent_at timestamptz,
  skip_reason text check (char_length(skip_reason) <= 200),
  constraint holder_message_recipients_message_hash_key unique (message_id, recipient_hash)
);

create index holder_message_recipients_order_idx on private.holder_message_recipients (order_id);

alter table private.holder_message_recipients enable row level security;
revoke all on private.holder_message_recipients from public, anon, authenticated;

create table private.holder_message_suppressions (
  organiser_id uuid not null references public.organisers (id) on delete cascade,
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (organiser_id, recipient_hash)
);

alter table private.holder_message_suppressions enable row level security;
revoke all on private.holder_message_suppressions from public, anon, authenticated;

create table private.holder_message_stop_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  recipient_id uuid not null references private.holder_message_recipients (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index holder_message_stop_tokens_recipient_idx on private.holder_message_stop_tokens (recipient_id);

alter table private.holder_message_stop_tokens enable row level security;
revoke all on private.holder_message_stop_tokens from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------

alter table private.email_outbox
  add column message_recipient_id uuid references private.holder_message_recipients (id) on delete cascade;

create unique index email_outbox_message_recipient_key on private.email_outbox (message_recipient_id);

alter table private.email_outbox
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (
    kind in ('ticket_email', 'waitlist_available', 'organiser_new_events', 'event_review', 'organiser_review',
             'ops_alert', 'event_published', 'organiser_joined', 'onboarding', 'event_reminder', 'holder_message')),
  drop constraint email_outbox_kind_key,
  -- Each kind has exactly its own key.
  add constraint email_outbox_kind_key check (
    case kind
      when 'ticket_email' then order_id is not null and waitlist_entry_id is null and follow_id is null
                               and event_id is null and organiser_id is null
                               and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                               and reminder_id is null and message_recipient_id is null
      when 'waitlist_available' then waitlist_entry_id is not null and order_id is null and follow_id is null
                                     and event_id is null and organiser_id is null
                                     and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                     and reminder_id is null and message_recipient_id is null
      when 'organiser_new_events' then follow_id is not null and order_id is null and waitlist_entry_id is null
                                       and event_id is null and organiser_id is null
                                       and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                       and reminder_id is null and message_recipient_id is null
      when 'event_review' then event_id is not null and order_id is null and waitlist_entry_id is null
                               and follow_id is null and organiser_id is null
                               and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                               and reminder_id is null and message_recipient_id is null
      when 'event_published' then event_id is not null and order_id is null and waitlist_entry_id is null
                                  and follow_id is null and organiser_id is null
                                  and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                  and reminder_id is null and message_recipient_id is null
      when 'organiser_review' then organiser_id is not null and order_id is null and waitlist_entry_id is null
                                   and follow_id is null and event_id is null
                                   and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                   and reminder_id is null and message_recipient_id is null
      when 'organiser_joined' then organiser_id is not null and order_id is null and waitlist_entry_id is null
                                   and follow_id is null and event_id is null
                                   and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                   and reminder_id is null and message_recipient_id is null
      when 'onboarding' then onboarding_id is not null and order_id is null and waitlist_entry_id is null
                             and follow_id is null and event_id is null and organiser_id is null
                             and payment_exception_id is null and ops_event_id is null
                             and reminder_id is null and message_recipient_id is null
      when 'event_reminder' then reminder_id is not null and order_id is null and waitlist_entry_id is null
                                 and follow_id is null and event_id is null and organiser_id is null
                                 and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                 and message_recipient_id is null
      when 'holder_message' then message_recipient_id is not null and order_id is null and waitlist_entry_id is null
                                 and follow_id is null and event_id is null and organiser_id is null
                                 and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                 and reminder_id is null
      else (payment_exception_id is not null) <> (ops_event_id is not null)
           and order_id is null and waitlist_entry_id is null and follow_id is null
           and event_id is null and organiser_id is null and onboarding_id is null
           and reminder_id is null and message_recipient_id is null end);

-- ---------------------------------------------------------------------------
-- Who holds a ticket
-- ---------------------------------------------------------------------------

create function private.holder_message_audience(p_event_id uuid)
returns table (order_id text, recipient_hash text)
language sql
stable
set search_path = ''
as $$
  select distinct on (k.hash) k.id, k.hash
    from (
      select o.id, o.created_at, private.email_recipient_hash(o.buyer_email) as hash
        from public.orders o
       where o.event_id = p_event_id and o.status = 'paid'
         and o.buyer_email is not null and btrim(o.buyer_email) <> ''
    ) k
   where not exists (
           select 1
             from public.events e
             join private.holder_message_suppressions s on s.organiser_id = e.organiser_id
            where e.id = p_event_id and s.recipient_hash = k.hash)
   order by k.hash, k.created_at, k.id
$$;

-- The opt-out behind a message email's "Stop messages from {organiser}" link:
-- the inbox that received that email is suppressed for that message's
-- organiser, for every event. Idempotent. Recipient rows of that organiser's
-- messages that haven't been sent are marked skipped (the send checks again).
-- Returns 'stopped' or 'not_found' (an unknown token).
create function private.stop_holder_messages(p_token_hash text, out result text, out out_organiser_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_hash text;
begin
  select r.recipient_hash, m.organiser_id
    into v_hash, out_organiser_id
    from private.holder_message_stop_tokens t
    join private.holder_message_recipients r on r.id = t.recipient_id
    join private.holder_messages m on m.id = r.message_id
   where t.token_hash = p_token_hash;
  if not found then
    result := 'not_found';
    return;
  end if;

  insert into private.holder_message_suppressions (organiser_id, recipient_hash)
  values (out_organiser_id, v_hash)
  on conflict do nothing;

  update private.holder_message_recipients r
     set skip_reason = 'they asked to stop messages from this organiser'
    from private.holder_messages m
   where m.id = r.message_id and m.organiser_id = out_organiser_id
     and r.recipient_hash = v_hash and r.sent_at is null and r.skip_reason is null;

  result := 'stopped';
end;
$$;

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

create function private.send_holder_message(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_request_id uuid,
  p_subject text, p_body text, p_attested boolean, p_expected_recipients integer,
  p_max_recipients integer, p_after_end interval,
  p_event_day_limit integer, p_event_total_limit integer,
  p_limit integer, p_window interval,
  out result text, out out_message_id uuid, out out_audience integer, out out_created_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_org record;
  v_event record;
  v_message record;
  v_audience integer;
  v_inserted integer;
  v_day integer;
  v_total integer;
begin
  if p_actor_id is null then
    result := 'not_found';
    return;
  end if;
  if p_request_id is null or p_subject is null or p_body is null or p_expected_recipients is null
     or p_max_recipients is null or p_after_end is null or p_event_day_limit is null
     or p_event_total_limit is null or p_limit is null or p_window is null then
    raise exception 'send_holder_message: an input or limit is missing';
  end if;
  if p_attested is distinct from true then
    raise exception 'send_holder_message: the organiser has not attested';
  end if;

  -- Organiser (share), then event, as release_tickets and admin_edit_event.
  select o.status::text as status, o.owner_user_id
    into v_org
    from public.organisers o where o.id = p_organiser_id for share;
  if not found or v_org.owner_user_id is distinct from p_actor_id then
    result := 'not_found';
    return;
  end if;

  select e.status::text as status, e.ends_at, e.ticketing_mode
    into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    result := 'not_found';
    return;
  end if;

  -- Proved theirs: a repeat of the same request is the same message.
  select m.id, m.recipient_count, m.created_at
    into v_message
    from private.holder_messages m
   where m.event_id = p_event_id and m.request_id = p_request_id;
  if found then
    result := 'replayed';
    out_message_id := v_message.id;
    out_audience := v_message.recipient_count;
    out_created_at := v_message.created_at;
    return;
  end if;

  if v_org.status <> 'approved' then
    result := 'not_approved';
    return;
  end if;
  if v_event.status <> 'published' then
    result := 'not_published';
    return;
  end if;
  if v_event.ticketing_mode <> 'sheltuh' then
    result := 'external';
    return;
  end if;
  if v_event.ends_at + p_after_end <= now() then
    result := 'outside_window';
    return;
  end if;

  select count(*)::integer into v_audience from private.holder_message_audience(p_event_id);
  out_audience := v_audience;
  if v_audience = 0 then
    result := 'no_recipients';
    return;
  end if;
  if v_audience > p_max_recipients then
    result := 'too_many';
    return;
  end if;
  if v_audience <> p_expected_recipients then
    result := 'audience_changed';
    return;
  end if;

  -- The event is locked, so these counts can't race another send for it.
  select (count(*) filter (where m.created_at > now() - interval '24 hours'))::integer, count(*)::integer
    into v_day, v_total
    from private.holder_messages m where m.event_id = p_event_id;
  if v_total >= p_event_total_limit then
    result := 'event_total_cap';
    return;
  end if;
  if v_day >= p_event_day_limit then
    result := 'event_day_cap';
    return;
  end if;
  -- Last, so only a message that will be sent uses the organiser's allowance.
  if not private.take_rate_limit(p_actor_id, 'holder_messages', p_limit, p_window) then
    result := 'rate_limited';
    return;
  end if;

  insert into private.holder_messages
    (event_id, organiser_id, sender_id, request_id, subject, body, recipient_count, attested_at)
  values (p_event_id, p_organiser_id, p_actor_id, p_request_id, p_subject, p_body, v_audience, now())
  returning id, created_at into out_message_id, out_created_at;

  insert into private.holder_message_recipients (message_id, order_id, recipient_hash)
  select out_message_id, a.order_id, a.recipient_hash
    from private.holder_message_audience(p_event_id) a
   limit p_max_recipients;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_audience then
    -- An order changed between the two reads: the message goes to who was found now.
    update private.holder_messages m set recipient_count = v_inserted where m.id = out_message_id;
    out_audience := v_inserted;
  end if;

  insert into private.email_outbox (kind, message_recipient_id)
  select 'holder_message', r.id from private.holder_message_recipients r where r.message_id = out_message_id;

  result := 'sent';
end;
$$;

-- An admin stops a message: what hasn't been sent is never sent (the send
-- re-reads cancelled_at). Results: 'cancelled', 'already_cancelled',
-- 'not_found'.
create function private.cancel_holder_message(p_message_id uuid, p_admin_id uuid, out result text)
language plpgsql
set search_path = ''
as $$
begin
  update private.holder_messages m
     set cancelled_at = now(), cancelled_by = p_admin_id
   where m.id = p_message_id and m.cancelled_at is null;
  if found then
    result := 'cancelled';
  elsif exists (select 1 from private.holder_messages m where m.id = p_message_id) then
    result := 'already_cancelled';
  else
    result := 'not_found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- As in 20261111000500_organiser_invite_links.sql, plus messages 12 months after
-- they were sent (their recipients and jobs go with them) and reminder records
-- 12 months after their event ended.
drop function private.purge_operational_data();

create function private.purge_operational_data(
  out unconfirmed_orders_deleted integer, out platform_rate_limits_deleted integer,
  out free_order_refusals_deleted integer, out email_jobs_deleted integer,
  out client_rate_limits_deleted integer, out account_invites_deleted integer,
  out early_charge_refunds_deleted integer, out payment_exceptions_deleted integer,
  out refund_status_marks_deleted integer, out checkout_attempts_deleted integer,
  out organiser_invite_links_deleted integer, out holder_messages_deleted integer,
  out event_reminders_deleted integer)
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

  delete from private.account_invites i
   where (i.status = 'accepted' and i.accepted_at < now() - interval '90 days')
      or (i.status = 'revoked' and i.revoked_at < now() - interval '90 days')
      or (i.status in ('pending', 'expired') and i.expires_at < now() - interval '90 days');
  get diagnostics account_invites_deleted = row_count;

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

  delete from private.organiser_invite_links l
   where (l.status = 'used' and l.used_at < now() - interval '90 days')
      or (l.status = 'cancelled' and l.cancelled_at < now() - interval '90 days')
      or (l.status = 'active' and l.expires_at < now() - interval '90 days');
  get diagnostics organiser_invite_links_deleted = row_count;

  delete from private.holder_messages m where m.created_at < now() - interval '12 months';
  get diagnostics holder_messages_deleted = row_count;

  delete from private.event_reminders r
   using public.events e
   where e.id = r.event_id and e.ends_at < now() - interval '12 months';
  get diagnostics event_reminders_deleted = row_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.holder_message_audience(uuid) from public, anon, authenticated;
revoke all on function private.send_holder_message(
  uuid, uuid, uuid, uuid, text, text, boolean, integer, integer, interval, integer, integer, integer, interval)
  from public, anon, authenticated;
revoke all on function private.cancel_holder_message(uuid, uuid) from public, anon, authenticated;
revoke all on function private.stop_holder_messages(text) from public, anon, authenticated;
revoke all on function private.purge_operational_data() from public, anon, authenticated;
