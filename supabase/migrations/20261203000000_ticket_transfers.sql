-- Ticket transfers: "Send ticket to a friend" (docs/architecture.md, "Ticket
-- transfers"). A ticket's holder offers it to someone by email; whoever opens
-- the offer's link signed in to a verified account accepts it and gets a new
-- code of their own. The sender's code stops working at the door from then on.
--
--   * public.tickets rows and codes never change: tickets.code stays the
--     ticket's identity (its primary key, its "ticket n of N" order and the
--     check-in log's key). Every reader of tickets.code (the order page, the
--     wallet routes, the ticket email and its resends, reminders) can only ever
--     see the original code, which is dead once the ticket is sent.
--   * private.ticket_transfers: one row per offer (pending, then accepted,
--     declined, cancelled or expired). An accepted row carries the recipient's
--     door credential (issued_code) and pass id (wallet_serial). The live
--     credential of a ticket is its current holding's issued_code, else
--     tickets.code. The partial unique indexes ticket_transfers_one_pending and
--     ticket_transfers_one_holding are the "one offer at a time" and "one
--     holder" rules; ticket_transfers_guard allows only the listed changes.
--   * private.ticket_transfer_tokens: the offer link's tokens, SHA-256 hashed
--     (the API never stores or logs a token). Minted by the email worker
--     (PR-2), one per send attempt.
--   * tickets_code_not_reissued: a new ticket's code is never one already
--     issued to a recipient (codes and issued codes share one space).
--   * public.ticket_check_ins: a new result 'transferred' (the scanned code is
--     no longer the ticket's live credential: nothing is marked) and
--     scanned_last4, the last four of the credential actually scanned.
--   * private.email_outbox: ticket_transfer_id, one job per (transfer, kind),
--     and five new kinds (transfer_offer, transfer_accepted,
--     transfer_declined, transfer_expired, transfer_ticket). Nothing leases
--     them yet: private.lease_outbox_jobs leases only its allowlist unless a
--     kind is named, and no release names these until the code that sends
--     them (PR-2) ships.
--   * New functions: person_name_ok, member_held_tickets (the one definition
--     of "holds a ticket": a paid order's ticket not given away, or a ticket
--     received and still held), create_ticket_transfer,
--     create_holder_ticket_transfer, cancel_ticket_transfer,
--     accept_ticket_transfer, decline_ticket_transfer,
--     expire_ticket_transfers, and the two trigger functions.
--   * Redefined, each copied from its latest definition with only the change
--     named: check_in_ticket (20261101000100_seat_holds.sql: looks a code up as
--     a ticket's code or an issued code; 'transferred'; scanned_last4),
--     undo_check_in (20261021130000_check_in_followups.sql: the scanned code's
--     last four), set_going (20261022000000_external_ticketing.sql: holds a
--     ticket by member_held_tickets), purge_operational_data
--     (20261118000100_ticket_holder_messages.sql: tokens 30 days after their
--     offer was decided, offers that weren't accepted 30 days after their
--     event ended; two new OUT columns, so dropped and created),
--     order_email_change_block (20261130000000_order_email_changes.sql: a
--     recipient's scan isn't the buyer's), and the outbox's two kind checks
--     (20261118000100_ticket_holder_messages.sql).
--
-- Locks, in this order everywhere: the event (for share), the order (for
-- share), the ticket (for update), the transfer row(s) (for update), then
-- outbox and rate-limit rows. check_in_ticket takes the same prefix (event key
-- share, order share, ticket update), so a scan and an accept serialise on the
-- ticket row and the door's 'transferred' decision is made under that lock.
-- record_payment_refund locks the order for update (then, for a seated order,
-- its tickets): a refund and a transfer step serialise on the order, never in
-- the other order. Rate-limit hits are taken last, inside a block that rolls
-- them back with any refusal, so a refusal writes nothing.
-- expire_ticket_transfers locks transfer rows only, with skip locked. An
-- accept first takes a transaction advisory lock on its account
-- ('ticket_transfer_accept:' || user id), before any row lock, so one
-- account's accepts serialise and the held cap is exact.
--
-- Indexes: see each one below; every foreign key that cascades or sets null
-- has one, except cancel_admin_id (admin accounts are rarely deleted and the
-- table is small).
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated; every new or redefined function's execute revoked from
-- PUBLIC, anon and authenticated, search_path pinned, none security definer.
-- `for key share` on auth.users (accept) needs the UPDATE privilege on it for
-- the role the app connects as, as 20261201000100_member_usernames.sql does.
--
-- Every invisible character in this file is written as an escape
-- (tests/server/migrations-invisible-characters.test.ts).
--
-- Reversible, not destructive, until the first offer is accepted: restore
-- check_in_ticket, undo_check_in, set_going, purge_operational_data,
-- order_email_change_block and the two outbox checks from the files named
-- above, and ticket_check_ins_result_check from
-- 20261021000000_ticket_check_in.sql (only once no row is 'transferred');
-- drop the new functions, the tickets trigger, the two new columns and the
-- two tables. Destructive once any offer is accepted: dropping
-- private.ticket_transfers voids every recipient's code and revives the
-- senders'. The constraint swaps on ticket_check_ins and email_outbox take
-- ACCESS EXCLUSIVE and validate every row: brief pre-launch, off-peak later.

-- ---------------------------------------------------------------------------
-- Names typed by people (the sender, the recipient, the holder)
-- ---------------------------------------------------------------------------

-- The orders_buyer_name_check expression of 20261122000000_order_buyer_details.sql,
-- for any name: 1 to 80 characters, already trimmed, no control, format or
-- separator characters. The API (parsePersonName, lib/server/order-input.ts)
-- is the stricter.
create function private.person_name_ok(p text) returns boolean
language sql
immutable strict
set search_path = ''
as $$
  select char_length(p) between 1 and 80
     and p = btrim(p)
     -- Escapes only (\uXXXX and \UXXXXXXXX are fixed-width, unlike \x), so no invisible character is ever typed
     -- into this file: control and C1 characters, every Unicode format character
     -- (Cf), the line and paragraph separators and the combining grapheme joiner.
     -- U+200C and U+200D (joiners that real Persian and Indic names need) are left
     -- out here; the API allows them only between two letters.
     and p !~ '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B\u200E-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]'
$$;

-- ---------------------------------------------------------------------------
-- The offers
-- ---------------------------------------------------------------------------

create table private.ticket_transfers (
  -- The public transferId.
  id uuid primary key default gen_random_uuid(),
  -- The ticket's identity; never changes.
  ticket_code text not null references public.tickets (code) on delete cascade,
  -- Denormalised: the ticket's order and event.
  order_id text not null references public.orders (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  -- buyer: sent by the order's buyer (the paying browser or their account). holder: re-sent by a recipient.
  sender_kind text not null check (sender_kind in ('buyer', 'holder')),
  -- A holder's re-send only: the holding it was sent from.
  from_transfer_id uuid references private.ticket_transfers (id),
  -- The signed-in sender; null on the paying-browser path.
  sender_user_id uuid references auth.users (id) on delete set null,
  sender_name text not null check (private.person_name_ok(sender_name)),
  -- As the sender typed them: where the offer goes.
  recipient_name text not null check (private.person_name_ok(recipient_name)),
  recipient_email text not null check (
    char_length(recipient_email) <= 254
    and recipient_email ~ '^[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- When it left pending.
  decided_at timestamptz,
  cancelled_by text check (cancelled_by in ('sender', 'admin')),
  cancel_admin_id uuid references auth.users (id) on delete set null,
  cancel_reason text check (char_length(cancel_reason) between 3 and 500),
  -- The account that accepted, and its verified email then (where the recipient's emails go).
  accepted_user_id uuid references auth.users (id) on delete set null,
  accepted_email text check (char_length(accepted_email) between 3 and 320),
  -- The name the recipient confirmed, and when the organiser notice was shown (stamped here, at accept).
  holder_name text check (private.person_name_ok(holder_name)),
  holder_notice_at timestamptz,
  -- The recipient's door credential and pass id.
  issued_code text check (issued_code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  wallet_serial uuid,
  -- A later accepted re-send replaced this holding (only while recipients may re-send).
  superseded_at timestamptz,
  -- Support withdrew the holder's details from the organiser's view, on request.
  holder_details_withdrawn_at timestamptz,
  -- Support blanked the typed details (sender_name, recipient_name, recipient_email) of a decided offer, on request:
  -- they then hold the fixed placeholders below. Once.
  details_redacted_at timestamptz,
  constraint ticket_transfers_expiry check (expires_at > created_at),
  constraint ticket_transfers_decided check ((status = 'pending') = (decided_at is null)),
  constraint ticket_transfers_sender_kind check ((sender_kind = 'holder') = (from_transfer_id is not null)),
  constraint ticket_transfers_cancelled check (
    (status = 'cancelled') = (cancelled_by is not null)
    and coalesce(cancelled_by = 'admin', false) = (cancel_reason is not null)
    and (cancel_admin_id is null or coalesce(cancelled_by = 'admin', false))),
  constraint ticket_transfers_redacted check (
    details_redacted_at is null
    or (status <> 'pending' and sender_name = 'Redacted' and recipient_name = 'Redacted'
        and recipient_email = 'redacted@redacted.invalid')),
  -- accepted_user_id is left out of the accepted branch: deleting that account sets it to null.
  constraint ticket_transfers_accepted check (
    case when status = 'accepted'
      then accepted_email is not null and holder_name is not null and holder_notice_at is not null
           and issued_code is not null and wallet_serial is not null
      else accepted_user_id is null and accepted_email is null and holder_name is null and holder_notice_at is null
           and issued_code is null and wallet_serial is null and superseded_at is null
           and holder_details_withdrawn_at is null end)
);

-- One pending offer per ticket: decides two sends racing (the loser's insert is refused).
create unique index ticket_transfers_one_pending on private.ticket_transfers (ticket_code) where status = 'pending';
-- One current holder per ticket.
create unique index ticket_transfers_one_holding on private.ticket_transfers (ticket_code)
  where status = 'accepted' and superseded_at is null;
-- The door's lookup of a scanned issued code, and the code clash checks.
create unique index ticket_transfers_issued_code_key on private.ticket_transfers (issued_code) where issued_code is not null;
create unique index ticket_transfers_wallet_serial_key on private.ticket_transfers (wallet_serial) where wallet_serial is not null;
-- Offers per ticket (the per-ticket cap), and the tickets cascade.
create index ticket_transfers_ticket_idx on private.ticket_transfers (ticket_code, created_at);
-- The admin list by order reference, and the orders cascade.
create index ticket_transfers_order_idx on private.ticket_transfers (order_id, created_at desc);
-- The organiser's view (PR-3), and the events cascade.
create index ticket_transfers_event_idx on private.ticket_transfers (event_id);
-- The per-sender pending cap, and the account's set-null.
create index ticket_transfers_sender_idx on private.ticket_transfers (sender_user_id);
-- The received page and a member's holdings, and the account's set-null.
create index ticket_transfers_holder_idx on private.ticket_transfers (accepted_user_id);
-- The expiry sweep: only pending rows, which are few.
create index ticket_transfers_pending_expiry_idx on private.ticket_transfers (expires_at) where status = 'pending';
-- The self-reference's check on delete.
create index ticket_transfers_from_idx on private.ticket_transfers (from_transfer_id) where from_transfer_id is not null;
-- The admin list's newest first (keyset on created_at, id).
create index ticket_transfers_created_idx on private.ticket_transfers (created_at desc, id desc);

alter table private.ticket_transfers enable row level security;
revoke all on private.ticket_transfers from public, anon, authenticated;

create table private.ticket_transfer_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  transfer_id uuid not null references private.ticket_transfers (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- The transfers cascade and the purge.
create index ticket_transfer_tokens_transfer_idx on private.ticket_transfer_tokens (transfer_id);

alter table private.ticket_transfer_tokens enable row level security;
revoke all on private.ticket_transfer_tokens from public, anon, authenticated;

-- Only these changes, each in one update:
--   * pending to accepted, declined, cancelled or expired, with that decision's
--     columns (the table checks say which must be set);
--   * an accepted row's superseded_at, once (null to a time), nothing else;
--   * an accepted row's holder_details_withdrawn_at, once, nothing else;
--   * a decided row's typed details (sender_name, recipient_name,
--     recipient_email) set to the placeholders with details_redacted_at, once,
--     nothing else (support's redaction, docs/supabase-setup.md);
--   * a foreign key's own set-null of sender_user_id, accepted_user_id or
--     cancel_admin_id, nothing else.
-- Everything an offer was made with (who, to whom, when, until when) never changes.
create function private.ticket_transfers_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_decision text[] := array['status', 'decided_at', 'cancelled_by', 'cancel_admin_id', 'cancel_reason',
                              'accepted_user_id', 'accepted_email', 'holder_name', 'holder_notice_at',
                              'issued_code', 'wallet_serial'];
  v_user_columns text[] := array['sender_user_id', 'accepted_user_id', 'cancel_admin_id'];
  v_redacted text[] := array['sender_name', 'recipient_name', 'recipient_email', 'details_redacted_at'];
begin
  if old.status = 'pending' and new.status <> 'pending' and (v_new - v_decision) = (v_old - v_decision) then
    return new;
  end if;
  if old.status = 'accepted' and new.status = 'accepted' and old.superseded_at is null
     and new.superseded_at is not null and (v_new - 'superseded_at') = (v_old - 'superseded_at') then
    return new;
  end if;
  if old.status = 'accepted' and new.status = 'accepted' and old.holder_details_withdrawn_at is null
     and new.holder_details_withdrawn_at is not null
     and (v_new - 'holder_details_withdrawn_at') = (v_old - 'holder_details_withdrawn_at') then
    return new;
  end if;
  -- The placeholders themselves are ticket_transfers_redacted's.
  if old.status <> 'pending' and old.details_redacted_at is null and new.details_redacted_at is not null
     and (v_new - v_redacted) = (v_old - v_redacted) then
    return new;
  end if;
  if (v_new - v_user_columns) = (v_old - v_user_columns)
     and (new.sender_user_id is null or new.sender_user_id = old.sender_user_id)
     and (new.accepted_user_id is null or new.accepted_user_id = old.accepted_user_id)
     and (new.cancel_admin_id is null or new.cancel_admin_id = old.cancel_admin_id) then
    return new;
  end if;
  raise exception 'This change to a ticket transfer isn''t allowed.'
    using errcode = 'check_violation', constraint = 'ticket_transfers_guard';
end;
$$;

create trigger ticket_transfers_guard before update on private.ticket_transfers
  for each row execute function private.ticket_transfers_guard();

-- A new ticket's code is never a code already issued to a recipient. Raised as
-- the primary key's clash, so the API's code retry (withTicketCodes,
-- lib/server/handlers/free-orders.ts, and fulfilment) tries fresh codes, as for
-- any clash. Reads ticket_transfers_issued_code_key.
create function private.tickets_code_not_reissued() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from private.ticket_transfers x where x.issued_code = new.code) then
    raise exception 'ticket code already issued' using errcode = 'unique_violation', constraint = 'tickets_pkey';
  end if;
  return new;
end;
$$;

create trigger tickets_code_not_reissued before insert on public.tickets
  for each row execute function private.tickets_code_not_reissued();

-- ---------------------------------------------------------------------------
-- The door's log
-- ---------------------------------------------------------------------------

-- The original is the inline column check of 20261021000000_ticket_check_in.sql
-- (named ticket_check_ins_result_check by Postgres).
alter table public.ticket_check_ins
  drop constraint ticket_check_ins_result_check,
  add constraint ticket_check_ins_result_check check (
    result in ('admitted', 'already_checked_in', 'invalid', 'not_admissible', 'other_event', 'undone', 'transferred')),
  -- The last four of the credential actually scanned (a recipient's issued code, or the ticket's own code). Null for
  -- invalid scans, undo rows and rows from before this migration.
  add column scanned_last4 text check (scanned_last4 ~ '^[A-HJ-NP-Z2-9]{4}$');

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------

alter table private.email_outbox
  add column ticket_transfer_id uuid references private.ticket_transfers (id) on delete cascade;

-- One job per (transfer, kind), ever; also the transfers cascade.
create unique index email_outbox_ticket_transfer_kind_key on private.email_outbox (ticket_transfer_id, kind)
  where ticket_transfer_id is not null;

alter table private.email_outbox
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (
    kind in ('ticket_email', 'waitlist_available', 'organiser_new_events', 'event_review', 'organiser_review',
             'ops_alert', 'event_published', 'organiser_joined', 'onboarding', 'event_reminder', 'holder_message',
             'transfer_offer', 'transfer_accepted', 'transfer_declined', 'transfer_expired', 'transfer_ticket')),
  drop constraint email_outbox_kind_key,
  -- Each kind has exactly its own key.
  add constraint email_outbox_kind_key check (
    case kind
      when 'ticket_email' then order_id is not null and waitlist_entry_id is null and follow_id is null
                               and event_id is null and organiser_id is null
                               and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                               and reminder_id is null and message_recipient_id is null and ticket_transfer_id is null
      when 'waitlist_available' then waitlist_entry_id is not null and order_id is null and follow_id is null
                                     and event_id is null and organiser_id is null
                                     and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                     and reminder_id is null and message_recipient_id is null and ticket_transfer_id is null
      when 'organiser_new_events' then follow_id is not null and order_id is null and waitlist_entry_id is null
                                       and event_id is null and organiser_id is null
                                       and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                       and reminder_id is null and message_recipient_id is null and ticket_transfer_id is null
      when 'event_review' then event_id is not null and order_id is null and waitlist_entry_id is null
                               and follow_id is null and organiser_id is null
                               and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                               and reminder_id is null and message_recipient_id is null and ticket_transfer_id is null
      when 'event_published' then event_id is not null and order_id is null and waitlist_entry_id is null
                                  and follow_id is null and organiser_id is null
                                  and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                  and reminder_id is null and message_recipient_id is null and ticket_transfer_id is null
      when 'organiser_review' then organiser_id is not null and order_id is null and waitlist_entry_id is null
                                   and follow_id is null and event_id is null
                                   and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                   and reminder_id is null and message_recipient_id is null and ticket_transfer_id is null
      when 'organiser_joined' then organiser_id is not null and order_id is null and waitlist_entry_id is null
                                   and follow_id is null and event_id is null
                                   and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                   and reminder_id is null and message_recipient_id is null and ticket_transfer_id is null
      when 'onboarding' then onboarding_id is not null and order_id is null and waitlist_entry_id is null
                             and follow_id is null and event_id is null and organiser_id is null
                             and payment_exception_id is null and ops_event_id is null
                             and reminder_id is null and message_recipient_id is null and ticket_transfer_id is null
      when 'event_reminder' then reminder_id is not null and order_id is null and waitlist_entry_id is null
                                 and follow_id is null and event_id is null and organiser_id is null
                                 and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                 and message_recipient_id is null and ticket_transfer_id is null
      when 'holder_message' then message_recipient_id is not null and order_id is null and waitlist_entry_id is null
                                 and follow_id is null and event_id is null and organiser_id is null
                                 and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                 and reminder_id is null and ticket_transfer_id is null
      when 'transfer_offer' then ticket_transfer_id is not null and order_id is null and waitlist_entry_id is null
                                 and follow_id is null and event_id is null and organiser_id is null
                                 and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                 and reminder_id is null and message_recipient_id is null
      when 'transfer_accepted' then ticket_transfer_id is not null and order_id is null and waitlist_entry_id is null
                                    and follow_id is null and event_id is null and organiser_id is null
                                    and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                    and reminder_id is null and message_recipient_id is null
      when 'transfer_declined' then ticket_transfer_id is not null and order_id is null and waitlist_entry_id is null
                                    and follow_id is null and event_id is null and organiser_id is null
                                    and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                    and reminder_id is null and message_recipient_id is null
      when 'transfer_expired' then ticket_transfer_id is not null and order_id is null and waitlist_entry_id is null
                                   and follow_id is null and event_id is null and organiser_id is null
                                   and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                   and reminder_id is null and message_recipient_id is null
      when 'transfer_ticket' then ticket_transfer_id is not null and order_id is null and waitlist_entry_id is null
                                  and follow_id is null and event_id is null and organiser_id is null
                                  and payment_exception_id is null and ops_event_id is null and onboarding_id is null
                                  and reminder_id is null and message_recipient_id is null
      else (payment_exception_id is not null) <> (ops_event_id is not null)
           and order_id is null and waitlist_entry_id is null and follow_id is null
           and event_id is null and organiser_id is null and onboarding_id is null
           and reminder_id is null and message_recipient_id is null and ticket_transfer_id is null end);

-- ---------------------------------------------------------------------------
-- Who holds a ticket
-- ---------------------------------------------------------------------------

-- The one definition of "holds a ticket" (Who's Going, GET /me, the accept's
-- Who's Going cleanup; later a member's tickets and the holder audiences):
--   * by email (p_email: a verified address, or null): every ticket of a paid
--     order whose buyer_email is p_email, ignoring case (the exact address, as
--     set_going always matched), that hasn't been given away (no current
--     holding); transfer_id null;
--   * by account (p_user_id, or null): every ticket this account accepted and
--     still holds (not superseded), while its order is paid; transfer_id set.
-- Reads orders_paid_email_event_idx, tickets_order_idx and
-- ticket_transfers_one_holding; and ticket_transfers_holder_idx.
create function private.member_held_tickets(p_user_id uuid, p_email text)
returns table (ticket_code text, order_id text, event_id uuid, transfer_id uuid)
language sql
stable
set search_path = ''
as $$
  select t.code, t.order_id, t.event_id, null::uuid
    from public.orders o
    join public.tickets t on t.order_id = o.id
   where p_email is not null and o.status = 'paid' and lower(o.buyer_email) = lower(p_email)
     and not exists (select 1 from private.ticket_transfers x
                      where x.ticket_code = t.code and x.status = 'accepted' and x.superseded_at is null)
  union all
  select t.code, t.order_id, t.event_id, x.id
    from private.ticket_transfers x
    join public.tickets t on t.code = x.ticket_code
    join public.orders o on o.id = t.order_id
   where p_user_id is not null and x.status = 'accepted' and x.superseded_at is null
     and x.accepted_user_id = p_user_id and o.status = 'paid'
$$;

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

-- Expires p_code's pending offer if it's overdue (past expires_at, or the
-- event's cut-off has passed) and queues its transfer_expired email. Called
-- with the ticket locked.
create function private.expire_overdue_ticket_offer(p_code text, p_starts_at timestamptz, p_cutoff interval)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update private.ticket_transfers x set status = 'expired', decided_at = now()
   where x.ticket_code = p_code and x.status = 'pending'
     and (x.expires_at <= now() or now() >= p_starts_at - p_cutoff)
  returning x.id into v_id;
  if v_id is not null then
    insert into private.email_outbox (kind, ticket_transfer_id) values ('transfer_expired', v_id);
  end if;
end;
$$;

-- Why p_code (an order's ticket, locked by the caller) can't be offered now,
-- or null when it can. Checks in order: the order is paid ('not_paid'); the
-- event is published and ticketed on Sheltuh ('event_unlisted'); the cut-off
-- ('closed'); paid / free allowed ('type_not_allowed': the line's unit price
-- for the ticket's type); not checked in ('checked_in'); then, after expiring
-- an overdue offer, no pending offer ('pending'); not given away already, or
-- accepted p_max_accepted times ('already_sent' for the buyer; a holder is
-- checked by its caller); not to p_own_email ('own_email'); fewer than
-- p_max_offers offers ever ('attempts_used'); and the sender's pending cap
-- ('pending_cap', only with p_sender_user_id).
create function private.ticket_offer_refusal(
  p_code text, p_order public.orders, p_event public.events, p_kind text, p_sender_user_id uuid,
  p_own_email text, p_recipient_email text,
  p_allow_paid boolean, p_allow_free boolean, p_cutoff interval,
  p_max_accepted integer, p_max_offers integer, p_max_pending_per_sender integer
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_ticket public.tickets;
  v_price integer;
begin
  select * into v_ticket from public.tickets t where t.code = p_code;
  if p_order.status <> 'paid' then
    return 'not_paid';
  end if;
  if p_event.status <> 'published' or p_event.ticketing_mode <> 'sheltuh' then
    return 'event_unlisted';
  end if;
  if now() >= p_event.starts_at - p_cutoff then
    return 'closed';
  end if;
  -- A group ticket's line price is the group's: above 0 is a paid ticket either way.
  select max((li ->> 'unitPriceCents')::integer) into v_price
    from jsonb_array_elements(p_order.line_items) li
   where li ->> 'ticketTypeId' = v_ticket.ticket_type_id;
  if (coalesce(v_price, 1) > 0 and not p_allow_paid) or (v_price = 0 and not p_allow_free) then
    return 'type_not_allowed';
  end if;
  if v_ticket.checked_in_at is not null then
    return 'checked_in';
  end if;

  perform private.expire_overdue_ticket_offer(p_code, p_event.starts_at, p_cutoff);

  if exists (select 1 from private.ticket_transfers x where x.ticket_code = p_code and x.status = 'pending') then
    return 'pending';
  end if;
  if (p_kind = 'buyer' and exists (select 1 from private.ticket_transfers x
                                    where x.ticket_code = p_code and x.status = 'accepted' and x.superseded_at is null))
     or (select count(*) from private.ticket_transfers x where x.ticket_code = p_code and x.status = 'accepted')
        >= p_max_accepted then
    return 'already_sent';
  end if;
  if p_own_email is not null and lower(p_recipient_email) = lower(p_own_email) then
    return 'own_email';
  end if;
  if (select count(*) from private.ticket_transfers x where x.ticket_code = p_code) >= p_max_offers then
    return 'attempts_used';
  end if;
  if p_sender_user_id is not null
     and (select count(*) from private.ticket_transfers x
           where x.sender_user_id = p_sender_user_id and x.status = 'pending' and x.expires_at > now())
         >= p_max_pending_per_sender then
    return 'pending_cap';
  end if;
  return null;
end;
$$;

-- Takes the send's allowances and inserts the offer and its transfer_offer
-- job: 'created' with the id, 'rate_limited' (nothing written: the block
-- rolls the hits back), or 'pending' (another offer for the ticket won a
-- race: ticket_transfers_one_pending).
create function private.insert_ticket_offer(
  p_code text, p_order_id text, p_event_id uuid, p_kind text, p_from_transfer_id uuid, p_sender_user_id uuid,
  p_sender_name text, p_recipient_name text, p_recipient_email text, p_expires_at timestamptz,
  p_account_limit integer, p_account_window interval,
  p_recipient_limit integer, p_recipient_window interval,
  p_platform_limit integer, p_platform_window interval,
  out result text, out transfer_id uuid
)
language plpgsql
set search_path = ''
as $$
declare
  v_constraint text;
begin
  begin
    if (p_sender_user_id is not null
        and not private.take_rate_limit(p_sender_user_id, 'ticket_transfer_sends', p_account_limit, p_account_window))
       or not private.take_platform_rate_limit('ticket_transfer_to:' || left(private.email_recipient_hash(p_recipient_email), 40),
                                               p_recipient_limit, p_recipient_window)
       or not private.take_platform_rate_limit('ticket_transfer_offers_daily', p_platform_limit, p_platform_window) then
      raise exception 'ticket transfer allowance used up' using errcode = 'SH429';
    end if;
    insert into private.ticket_transfers (ticket_code, order_id, event_id, sender_kind, from_transfer_id, sender_user_id,
                                          sender_name, recipient_name, recipient_email, expires_at)
    values (p_code, p_order_id, p_event_id, p_kind, p_from_transfer_id, p_sender_user_id,
            p_sender_name, p_recipient_name, p_recipient_email, p_expires_at)
    returning id into transfer_id;
    insert into private.email_outbox (kind, ticket_transfer_id) values ('transfer_offer', transfer_id);
    result := 'created';
  exception
    -- Both undo the hits taken in this block.
    when sqlstate 'SH429' then
      result := 'rate_limited';
      transfer_id := null;
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'ticket_transfers_one_pending' then
        raise;
      end if;
      result := 'pending';
      transfer_id := null;
  end;
end;
$$;

-- The buyer's send of their order's ticket number p_ticket_number (1-based:
-- ticket type, then code, as the page and the email number them). The API
-- has checked the sender controls the order (the paying browser, or the
-- signed-in buyer: p_sender_user_id) and passes the rules
-- (lib/ticket-transfer-rules.ts) and limits. Returns 'created' (with the
-- id), 'not_found', 'owner_only' (re-checked here under the order's lock:
-- the paying browser, p_sender_user_id null, once support has changed the
-- order's email, as its token may be on a device the old address's holder
-- uses, as private.order_email_change_block's 'changed_by_support'; or a
-- signed-in sender whose verified email, p_sender_email, isn't the order's
-- buyer_email any more, trimmed and ignoring case as the API compares them:
-- the email changed after the API checked it), or a refusal
-- (ticket_offer_refusal's, or 'rate_limited'; 'pending' also for a lost
-- race). Expires at the sooner of p_pending_for from now and the event's
-- start less p_cutoff.
create function private.create_ticket_transfer(
  p_order_id text, p_ticket_number integer, p_sender_user_id uuid, p_sender_email text,
  p_sender_name text, p_recipient_name text, p_recipient_email text,
  p_allow_paid boolean, p_allow_free boolean, p_cutoff interval, p_pending_for interval,
  p_max_accepted integer, p_max_offers_per_ticket integer, p_max_pending_per_sender integer,
  p_account_limit integer, p_account_window interval,
  p_recipient_limit integer, p_recipient_window interval,
  p_platform_limit integer, p_platform_window interval,
  out result text, out transfer_id uuid
)
language plpgsql
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_event public.events;
  v_order public.orders;
  v_code text;
  v_refusal text;
  v_offer record;
begin
  if p_order_id is null or p_ticket_number is null or p_ticket_number < 1 or p_sender_name is null
     or (p_sender_user_id is null) <> (p_sender_email is null)
     or p_recipient_name is null or p_recipient_email is null or p_allow_paid is null or p_allow_free is null
     or p_cutoff is null or p_cutoff < interval '0' or p_pending_for is null or p_pending_for <= interval '0'
     or p_max_accepted is null or p_max_accepted < 1 or p_max_offers_per_ticket is null or p_max_offers_per_ticket < 1
     or p_max_pending_per_sender is null or p_max_pending_per_sender < 1
     or p_account_limit is null or p_account_window is null or p_recipient_limit is null or p_recipient_window is null
     or p_platform_limit is null or p_platform_window is null then
    raise exception 'missing or out-of-range argument' using errcode = '22023';
  end if;

  select o.event_id into v_event_id from public.orders o where o.id = p_order_id;
  if not found then
    result := 'not_found';
    return;
  end if;
  select * into v_event from public.events e where e.id = v_event_id for share;
  select * into v_order from public.orders o where o.id = p_order_id for share;
  if (p_sender_user_id is null
      and exists (select 1 from private.order_email_changes c where c.order_id = p_order_id and c.changed_by = 'admin'))
     or (p_sender_user_id is not null
         and lower(btrim(p_sender_email)) is distinct from lower(btrim(v_order.buyer_email))) then
    result := 'owner_only';
    return;
  end if;

  select x.code into v_code
    from (select t.code, row_number() over (order by t.ticket_type_id, t.code) as n
            from public.tickets t where t.order_id = p_order_id) x
   where x.n = p_ticket_number;
  if v_code is null then
    result := 'not_found';
    return;
  end if;
  perform 1 from public.tickets t where t.code = v_code for update;

  v_refusal := private.ticket_offer_refusal(v_code, v_order, v_event, 'buyer', p_sender_user_id, v_order.buyer_email,
                                            p_recipient_email, p_allow_paid, p_allow_free, p_cutoff, p_max_accepted,
                                            p_max_offers_per_ticket, p_max_pending_per_sender);
  if v_refusal is not null then
    result := v_refusal;
    return;
  end if;

  select * into v_offer
    from private.insert_ticket_offer(v_code, p_order_id, v_event_id, 'buyer', null, p_sender_user_id,
                                     p_sender_name, p_recipient_name, p_recipient_email,
                                     least(now() + p_pending_for, v_event.starts_at - p_cutoff),
                                     p_account_limit, p_account_window, p_recipient_limit, p_recipient_window,
                                     p_platform_limit, p_platform_window);
  result := v_offer.result;
  transfer_id := v_offer.transfer_id;
end;
$$;

-- A recipient's re-send of the ticket they hold (p_from_transfer_id, accepted
-- by p_user_id and not superseded; 'not_found' otherwise). As
-- create_ticket_transfer, except the offer is the holder's (sender_kind
-- 'holder', from_transfer_id, sender_user_id p_user_id) and 'own_email' is
-- the holder's accepted_email. The API refuses it while recipients may not
-- re-send (TICKET_TRANSFER_RULES.recipientMayResend); it's here so that rule
-- is a one-line change.
create function private.create_holder_ticket_transfer(
  p_from_transfer_id uuid, p_user_id uuid,
  p_sender_name text, p_recipient_name text, p_recipient_email text,
  p_allow_paid boolean, p_allow_free boolean, p_cutoff interval, p_pending_for interval,
  p_max_accepted integer, p_max_offers_per_ticket integer, p_max_pending_per_sender integer,
  p_account_limit integer, p_account_window interval,
  p_recipient_limit integer, p_recipient_window interval,
  p_platform_limit integer, p_platform_window interval,
  out result text, out transfer_id uuid
)
language plpgsql
set search_path = ''
as $$
declare
  v_from private.ticket_transfers;
  v_event public.events;
  v_order public.orders;
  v_refusal text;
  v_offer record;
begin
  if p_from_transfer_id is null or p_user_id is null or p_sender_name is null
     or p_recipient_name is null or p_recipient_email is null or p_allow_paid is null or p_allow_free is null
     or p_cutoff is null or p_cutoff < interval '0' or p_pending_for is null or p_pending_for <= interval '0'
     or p_max_accepted is null or p_max_accepted < 1 or p_max_offers_per_ticket is null or p_max_offers_per_ticket < 1
     or p_max_pending_per_sender is null or p_max_pending_per_sender < 1
     or p_account_limit is null or p_account_window is null or p_recipient_limit is null or p_recipient_window is null
     or p_platform_limit is null or p_platform_window is null then
    raise exception 'missing or out-of-range argument' using errcode = '22023';
  end if;

  select * into v_from from private.ticket_transfers x
   where x.id = p_from_transfer_id and x.accepted_user_id = p_user_id and x.status = 'accepted' and x.superseded_at is null;
  if not found then
    result := 'not_found';
    return;
  end if;
  select * into v_event from public.events e where e.id = v_from.event_id for share;
  select * into v_order from public.orders o where o.id = v_from.order_id for share;
  perform 1 from public.tickets t where t.code = v_from.ticket_code for update;
  select * into v_from from private.ticket_transfers x where x.id = p_from_transfer_id for update;
  if v_from.status <> 'accepted' or v_from.superseded_at is not null or v_from.accepted_user_id is distinct from p_user_id then
    result := 'not_found';
    return;
  end if;

  v_refusal := private.ticket_offer_refusal(v_from.ticket_code, v_order, v_event, 'holder', p_user_id, v_from.accepted_email,
                                            p_recipient_email, p_allow_paid, p_allow_free, p_cutoff, p_max_accepted,
                                            p_max_offers_per_ticket, p_max_pending_per_sender);
  if v_refusal is not null then
    result := v_refusal;
    return;
  end if;

  select * into v_offer
    from private.insert_ticket_offer(v_from.ticket_code, v_from.order_id, v_from.event_id, 'holder', v_from.id, p_user_id,
                                     p_sender_name, p_recipient_name, p_recipient_email,
                                     least(now() + p_pending_for, v_event.starts_at - p_cutoff),
                                     p_account_limit, p_account_window, p_recipient_limit, p_recipient_window,
                                     p_platform_limit, p_platform_window);
  result := v_offer.result;
  transfer_id := v_offer.transfer_id;
end;
$$;

-- Cancels a pending, unexpired offer: by its buyer (p_by 'sender', with the
-- order it must belong to: the API has checked the caller controls it, and
-- p_sender_user_id the signed-in buyer's account, null for the paying
-- browser) or by support (p_by 'admin', p_order_id null, p_admin_id and a 3
-- to 500 character reason). No email: the offer's link simply stops working.
-- Returns 'cancelled', 'not_pending', 'not_found' (also a holder's re-send:
-- the buyer can't cancel that), or 'owner_only' (as create_ticket_transfer:
-- the paying browser once support has changed the order's email, or a
-- signed-in buyer, p_sender_email, whose email isn't the order's any more).
create function private.cancel_ticket_transfer(
  p_transfer_id uuid, p_order_id text, p_by text, p_admin_id uuid, p_reason text, p_sender_user_id uuid,
  p_sender_email text, out result text
)
language plpgsql
set search_path = ''
as $$
declare
  v_transfer private.ticket_transfers;
  v_buyer_email text;
begin
  if p_transfer_id is null
     or p_by is null or p_by not in ('sender', 'admin')
     or (p_by = 'sender' and (p_order_id is null or p_admin_id is not null or p_reason is not null
                              or (p_sender_user_id is null) <> (p_sender_email is null)))
     or (p_by = 'admin' and (p_order_id is not null or p_admin_id is null or p_reason is null
                             or char_length(p_reason) not between 3 and 500 or p_sender_user_id is not null
                             or p_sender_email is not null)) then
    raise exception 'missing or out-of-range argument' using errcode = '22023';
  end if;

  select * into v_transfer from private.ticket_transfers x
   where x.id = p_transfer_id and (p_order_id is null or (x.order_id = p_order_id and x.sender_kind = 'buyer'));
  if not found then
    result := 'not_found';
    return;
  end if;
  select o.buyer_email into v_buyer_email from public.orders o where o.id = v_transfer.order_id for share;
  if p_by = 'sender'
     and ((p_sender_user_id is null
           and exists (select 1 from private.order_email_changes c
                        where c.order_id = v_transfer.order_id and c.changed_by = 'admin'))
          or (p_sender_user_id is not null
              and lower(btrim(p_sender_email)) is distinct from lower(btrim(v_buyer_email)))) then
    result := 'owner_only';
    return;
  end if;
  perform 1 from public.tickets t where t.code = v_transfer.ticket_code for update;
  select * into v_transfer from private.ticket_transfers x where x.id = p_transfer_id for update;
  if v_transfer.status <> 'pending' or v_transfer.expires_at <= now() then
    result := 'not_pending';
    return;
  end if;

  update private.ticket_transfers x
     set status = 'cancelled', decided_at = now(), cancelled_by = p_by,
         cancel_admin_id = case when p_by = 'admin' then p_admin_id end,
         cancel_reason = case when p_by = 'admin' then p_reason end
   where x.id = p_transfer_id;
  result := 'cancelled';
end;
$$;

-- ---------------------------------------------------------------------------
-- Accepting and declining
-- ---------------------------------------------------------------------------

-- The offer behind the link token's hash, accepted by the signed-in account
-- p_user_id (its verified email p_email: any account, owner decision O1),
-- with the name it confirmed and a fresh code (p_new_code, made by the API).
-- Returns, with the transfer's id where there is one:
--   'accepted'          now held by p_user_id: issued_code, a new
--                       wallet_serial, holder_notice_at stamped; the
--                       previous holder's Who's Going opt-in is removed if
--                       they hold nothing else for the event; the
--                       transfer_accepted and transfer_ticket emails queued
--   'already_accepted'  p_user_id accepted it before (idempotent)
--   'unavailable'       no such token, or the offer isn't pending (accepted
--                       by someone else, declined, cancelled, expired); an
--                       overdue offer is marked expired (its email queued)
--   'closed'            past the event's start less p_cutoff (the event's
--                       current start: an event moved earlier closes it)
--   'ticket_unavailable' the order isn't paid, the event isn't published (or
--                       is ticketed elsewhere), or the ticket was checked in
--   'own_ticket'        the sender's own account, or the buyer's email
--   'held_cap'          p_user_id already holds p_max_held received tickets
--                       for the event
--   'user_unavailable'  the account is gone
--   'code_taken'        p_new_code is a ticket's code or an issued code (the
--                       API retries with another)
--   'rate_limited'      the account's allowance; nothing written
create function private.accept_ticket_transfer(
  p_token_hash text, p_user_id uuid, p_email text, p_holder_name text, p_new_code text,
  p_cutoff interval, p_max_held integer, p_account_limit integer, p_account_window interval,
  out result text, out transfer_id uuid
)
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_transfer private.ticket_transfers;
  v_event public.events;
  v_order public.orders;
  v_ticket public.tickets;
  v_previous_holder uuid;
  v_constraint text;
begin
  if p_token_hash is null or p_user_id is null or p_email is null or p_holder_name is null or p_new_code is null
     or p_cutoff is null or p_max_held is null or p_max_held < 1 or p_account_limit is null or p_account_window is null then
    raise exception 'missing or out-of-range argument' using errcode = '22023';
  end if;

  select k.transfer_id into v_id from private.ticket_transfer_tokens k where k.token_hash = p_token_hash;
  if not found then
    result := 'unavailable';
    return;
  end if;
  select * into v_transfer from private.ticket_transfers x where x.id = v_id;
  if v_transfer.status = 'accepted' and v_transfer.accepted_user_id = p_user_id then
    result := 'already_accepted';
    transfer_id := v_id;
    return;
  end if;
  if v_transfer.status <> 'pending' then
    result := 'unavailable';
    return;
  end if;

  -- One account's accepts one at a time, until commit, so two of different
  -- offers can't both count p_max_held - 1 holdings and pass the cap. Taken
  -- before any row lock, and nothing else takes it, so whoever waits for it
  -- holds nothing another accept needs: it can't join a lock cycle.
  perform pg_advisory_xact_lock(hashtextextended('ticket_transfer_accept:' || p_user_id::text, 0));

  select * into v_event from public.events e where e.id = v_transfer.event_id for share;
  select * into v_order from public.orders o where o.id = v_transfer.order_id for share;
  select * into v_ticket from public.tickets t where t.code = v_transfer.ticket_code for update;
  select * into v_transfer from private.ticket_transfers x where x.id = v_id for update;
  if v_transfer.status = 'accepted' and v_transfer.accepted_user_id = p_user_id then
    result := 'already_accepted';
    transfer_id := v_id;
    return;
  end if;
  if v_transfer.status <> 'pending' then
    result := 'unavailable';
    return;
  end if;
  if v_transfer.expires_at <= now() then
    update private.ticket_transfers x set status = 'expired', decided_at = now() where x.id = v_id;
    insert into private.email_outbox (kind, ticket_transfer_id) values ('transfer_expired', v_id);
    result := 'unavailable';
    return;
  end if;

  if now() >= v_event.starts_at - p_cutoff then
    result := 'closed';
    return;
  end if;
  if v_order.status <> 'paid' or v_event.status <> 'published' or v_event.ticketing_mode <> 'sheltuh'
     or v_ticket.checked_in_at is not null then
    result := 'ticket_unavailable';
    return;
  end if;
  if v_transfer.sender_kind = 'holder' then
    select x.accepted_user_id into v_previous_holder from private.ticket_transfers x where x.id = v_transfer.from_transfer_id;
  end if;
  if p_user_id = v_transfer.sender_user_id or lower(p_email) = lower(v_order.buyer_email)
     or p_user_id = v_previous_holder then
    result := 'own_ticket';
    return;
  end if;
  if (select count(*) from private.member_held_tickets(p_user_id, null) h
       where h.event_id = v_transfer.event_id and h.transfer_id is not null) >= p_max_held then
    result := 'held_cap';
    return;
  end if;
  perform 1 from auth.users u where u.id = p_user_id for key share;
  if not found then
    result := 'user_unavailable';
    return;
  end if;
  if exists (select 1 from public.tickets t where t.code = p_new_code)
     or exists (select 1 from private.ticket_transfers x where x.issued_code = p_new_code) then
    result := 'code_taken';
    return;
  end if;

  begin
    if not private.take_rate_limit(p_user_id, 'ticket_transfer_accepts', p_account_limit, p_account_window) then
      raise exception 'ticket transfer accept allowance used up' using errcode = 'SH429';
    end if;
    -- A re-send's previous holding first: ticket_transfers_one_holding allows one current holding at a time.
    if v_transfer.sender_kind = 'holder' then
      update private.ticket_transfers x set superseded_at = now() where x.id = v_transfer.from_transfer_id;
    end if;
    update private.ticket_transfers x
       set status = 'accepted', decided_at = now(), accepted_user_id = p_user_id, accepted_email = p_email,
           holder_name = p_holder_name, holder_notice_at = now(), issued_code = p_new_code,
           wallet_serial = gen_random_uuid()
     where x.id = v_id;
  exception
    when sqlstate 'SH429' then
      result := 'rate_limited';
      return;
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'ticket_transfers_issued_code_key' then
        result := 'code_taken';
        return;
      elsif v_constraint = 'ticket_transfers_one_holding' then
        result := 'unavailable';
        return;
      end if;
      raise;
  end;

  -- Their profiles first (for update): private.set_going share-locks the
  -- profile before it checks the member holds a ticket and inserts, so an
  -- opt-in racing this accept either commits first (and is deleted below) or
  -- waits and then sees the ticket gone ('not_eligible'). In user id order.
  perform 1
     from public.profiles p
     join auth.users u on u.id = p.user_id
    where (u.email_confirmed_at is not null and lower(u.email) = lower(v_order.buyer_email)) or u.id = v_previous_holder
    order by p.user_id
      for update of p;

  -- Who's Going: whoever gave this ticket away (the buyer's verified account
  -- by email, and for a re-send the previous holder) no longer shows as going
  -- unless they still hold a ticket for the event, so they can't keep
  -- messaging its attendees.
  delete from public.event_attendees a
   using auth.users u
   where a.event_id = v_transfer.event_id and a.user_id = u.id
     and ((u.email_confirmed_at is not null and lower(u.email) = lower(v_order.buyer_email))
          or u.id = v_previous_holder)
     and not exists (select 1
                       from private.member_held_tickets(u.id, case when u.email_confirmed_at is not null then u.email end) h
                      where h.event_id = v_transfer.event_id);

  insert into private.email_outbox (kind, ticket_transfer_id)
  values ('transfer_accepted', v_id), ('transfer_ticket', v_id);
  result := 'accepted';
  transfer_id := v_id;
end;
$$;

-- Declines the pending, unexpired offer behind the link token's hash (no
-- sign-in: owner decision D6) and queues the transfer_declined email.
-- Returns 'declined' with the id, or 'unavailable'.
create function private.decline_ticket_transfer(p_token_hash text, out result text, out transfer_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_transfer private.ticket_transfers;
begin
  if p_token_hash is null then
    raise exception 'missing argument' using errcode = '22023';
  end if;
  select k.transfer_id into v_id from private.ticket_transfer_tokens k where k.token_hash = p_token_hash;
  if not found then
    result := 'unavailable';
    return;
  end if;
  select * into v_transfer from private.ticket_transfers x where x.id = v_id;
  perform 1 from public.orders o where o.id = v_transfer.order_id for share;
  perform 1 from public.tickets t where t.code = v_transfer.ticket_code for update;
  select * into v_transfer from private.ticket_transfers x where x.id = v_id for update;
  if v_transfer.status <> 'pending' or v_transfer.expires_at <= now() then
    result := 'unavailable';
    return;
  end if;
  update private.ticket_transfers x set status = 'declined', decided_at = now() where x.id = v_id;
  insert into private.email_outbox (kind, ticket_transfer_id) values ('transfer_declined', v_id);
  result := 'declined';
  transfer_id := v_id;
end;
$$;

-- The email cron's sweep: up to p_limit pending offers that are overdue
-- (past expires_at, or past their event's start less p_cutoff), soonest
-- first, become expired with their transfer_expired email queued. Returns how
-- many. One run at a time (the advisory lock; another run returns 0), and it
-- skips rows another transaction holds, so it never waits on an accept,
-- cancel or decline (they lock the transfer row last). Nothing depends on it
-- running: every function treats an overdue offer as expired.
create function private.expire_ticket_transfers(p_limit integer, p_cutoff interval) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_cutoff is null then
    raise exception 'missing or out-of-range argument' using errcode = '22023';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('private.expire_ticket_transfers', 0)) then
    return 0;
  end if;
  with due as (
    select x.id
      from private.ticket_transfers x
      join public.events e on e.id = x.event_id
     where x.status = 'pending' and (x.expires_at <= now() or now() >= e.starts_at - p_cutoff)
     order by x.expires_at
     limit p_limit
       for update of x skip locked
  ), expired as (
    update private.ticket_transfers x set status = 'expired', decided_at = now()
      from due where x.id = due.id
    returning x.id
  )
  insert into private.email_outbox (kind, ticket_transfer_id)
  select 'transfer_expired', expired.id from expired;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check-in: the ticket's live credential
-- ---------------------------------------------------------------------------

-- As in 20261101000100_seat_holds.sql, except:
--   * a well-formed code is looked up as a ticket's code, else as a
--     recipient's issued code (ticket_transfers_issued_code_key); either way
--     v_code is the ticket's identity (tickets.code) and p_code the credential
--     scanned;
--   * a new scan whose credential isn't the ticket's live one (its current
--     holding's issued_code, else its own code) is 'transferred', decided
--     under the ticket's lock and before 'not_admissible'; nothing is marked;
--   * the log row keeps the scanned credential's last four (scanned_last4),
--     and code_last4 is the scanned credential's (identical to before for
--     every ticket never sent);
--   * a replayed request id is a 'conflict' when its row kept other last
--     four (the ticket's other credential).
create or replace function private.check_in_ticket(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_code text, p_request_id uuid,
  p_limit integer, p_window interval,
  out result text, out check_in_id uuid, out admission_id uuid, out ticket_type_name text, out ticket_number integer,
  out ticket_count integer, out code_last4 text, out first_checked_in_at timestamptz, out other_event_title text,
  out seat_section text, out seat_row text, out seat_label text, out seat_kind text
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
  v_live text;
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
  --    further. Unknown and someone else's are the same: no code. A
  --    recipient's issued code is its ticket (the identity, tickets.code).
  if p_code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$' then
    select t.code, t.order_id, t.event_id, e.organiser_id
      into v_code, v_order_id, v_ticket_event, v_ticket_organiser
      from public.tickets t
      join public.events e on e.id = t.event_id
     where t.code = p_code;
    if not found then
      select t.code, t.order_id, t.event_id, e.organiser_id
        into v_code, v_order_id, v_ticket_event, v_ticket_organiser
        from private.ticket_transfers x
        join public.tickets t on t.code = x.ticket_code
        join public.events e on e.id = t.event_id
       where x.issued_code = p_code;
    end if;
    if v_ticket_organiser is distinct from p_organiser_id then
      v_code := null;
      v_order_id := null;
      v_ticket_event := null;
    end if;
  end if;

  -- 4. A retried request gets its original result back, if it's for the same code.
  select c.id, c.public_id, c.result, c.ticket_code, c.created_at, c.scanned_last4 into v_log
    from public.ticket_check_ins c
   where c.event_id = p_event_id and c.request_id = p_request_id;

  if found then
    -- The same ticket by its other credential (the buyer's code, then the
    -- recipient's) is another scan too: compared by the last four kept (rows
    -- from before this migration kept none).
    if v_log.ticket_code is distinct from v_code
       or (v_code is not null and v_log.scanned_last4 is not null and v_log.scanned_last4 <> right(p_code, 4)) then
      result := 'conflict';
      return;
    end if;
    result := v_log.result;
    check_in_id := v_log.public_id;
    if v_log.result = 'admitted' then
      first_checked_in_at := v_log.created_at;
      admission_id := v_log.public_id;
    elsif v_log.result = 'already_checked_in' then
      select c.id, c.public_id, c.created_at into v_seen
        from public.ticket_check_ins c
       where c.ticket_code = v_log.ticket_code and c.result = 'admitted' and c.id < v_log.id
       order by c.id desc
       limit 1;
      if found then
        first_checked_in_at := v_seen.created_at;
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
      result := 'other_event';
    else
      select o.status into v_status from public.orders o where o.id = v_order_id for share;
      select t.checked_in_at into v_checked_in_at from public.tickets t where t.code = v_code for update;
      -- The ticket's live credential, read under its lock (an accept takes the same lock).
      v_live := coalesce((select x.issued_code from private.ticket_transfers x
                           where x.ticket_code = v_code and x.status = 'accepted' and x.superseded_at is null), v_code);

      if p_code <> v_live then
        result := 'transferred';
      elsif v_status is distinct from 'paid' then
        result := 'not_admissible';
      elsif v_checked_in_at is not null then
        result := 'already_checked_in';
        first_checked_in_at := v_checked_in_at;
        select c.public_id into admission_id
          from public.ticket_check_ins c
         where c.ticket_code = v_code and c.result = 'admitted'
         order by c.id desc
         limit 1;
      else
        update public.tickets set checked_in_at = now() where code = v_code;
        result := 'admitted';
        first_checked_in_at := now();
      end if;
    end if;

    insert into public.ticket_check_ins (event_id, ticket_code, actor_user_id, request_id, result, scanned_last4)
    values (p_event_id, v_code, p_actor_id, p_request_id, result, case when v_code is null then null else right(p_code, 4) end)
    returning public_id into check_in_id;
    if result = 'admitted' then
      admission_id := check_in_id;
    end if;
  end if;

  if v_code is null then
    return;
  end if;

  select x.ticket_type_name, x.n, x.total, right(p_code, 4)
    into ticket_type_name, ticket_number, ticket_count, code_last4
    from (select t.code, t.ticket_type_name,
                 (row_number() over (order by t.ticket_type_id, t.code))::integer as n,
                 (count(*) over ())::integer as total
            from public.tickets t
           where t.order_id = (select t2.order_id from public.tickets t2 where t2.code = v_code)) x
   where x.code = v_code;

  -- The seat, so the door can say where to go.
  select s.section_label, s.row_label, s.seat_label, s.kind
    into seat_section, seat_row, seat_label, seat_kind
    from public.tickets t
    join public.event_seats s on s.event_id = t.event_id and s.id = t.seat_id
   where t.code = v_code;

  if result = 'other_event' then
    select e.title into other_event_title
      from public.tickets t join public.events e on e.id = t.event_id
     where t.code = v_code;
  end if;
end;
$$;

-- As in 20261021130000_check_in_followups.sql, except code_last4 is the last
-- four of the credential the admission scanned (scanned_last4), so door
-- staff see the recipient's code; the ticket's own code's for rows from
-- before 20261203000000_ticket_transfers.sql.
create or replace function private.undo_check_in(
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
  v_scanned_last4 text;
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

  select c.id, c.ticket_code, c.scanned_last4 into v_admission_id, v_code, v_scanned_last4
    from public.ticket_check_ins c
   where c.public_id = p_check_in_id and c.event_id = p_event_id and c.result = 'admitted';
  if not found then
    result := 'not_found';
    return;
  end if;

  select t.order_id, t.ticket_type_name, coalesce(v_scanned_last4, right(t.code, 4))
    into v_order_id, ticket_type_name, code_last4
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

-- ---------------------------------------------------------------------------
-- Who's Going: holding a ticket
-- ---------------------------------------------------------------------------

-- As in 20261022000000_external_ticketing.sql, except a member holds a ticket
-- for the event by member_held_tickets: a paid order's ticket under their
-- verified email that they haven't given away, or a ticket they received
-- (by their account, so p_email may be null).
create or replace function private.set_going(p_event_id uuid, p_user_id uuid, p_email text) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events
   where id = p_event_id and status = 'published' and whos_going_enabled and ends_at > now()
     and ticketing_mode = 'sheltuh'
     for share;
  if not found then
    return 'event_unavailable';
  end if;

  if exists (select 1 from private.social_suspensions where user_id = p_user_id) then
    return 'suspended';
  end if;

  perform 1 from public.profiles where user_id = p_user_id for share;
  if not found then
    return 'no_profile';
  end if;

  if not exists (select 1 from private.member_held_tickets(p_user_id, p_email) h where h.event_id = p_event_id) then
    return 'not_eligible';
  end if;

  insert into public.event_attendees (event_id, user_id) values (p_event_id, p_user_id)
  on conflict (event_id, user_id) do nothing;
  return 'going';
end;
$$;

-- ---------------------------------------------------------------------------
-- Buyer email changes: a recipient's scan isn't the buyer's
-- ---------------------------------------------------------------------------

-- As in 20261130000000_order_email_changes.sql, except 'scanned' ignores a
-- ticket that was sent and accepted: the recipient's admission doesn't end
-- the buyer's own email change.
create or replace function private.order_email_change_block(p_order_id text) returns text
language sql
stable
set search_path = ''
as $$
  select case
           when o.id is null then 'not_found'
           when o.total_cents <= 0 then 'not_card_order'
           when o.status <> 'paid' then 'not_paid'
           when exists (select 1 from private.order_email_changes x
                         where x.order_id = o.id and x.changed_by = 'admin') then 'changed_by_support'
           when e.ends_at is null or e.ends_at <= now() then 'ended'
           when exists (select 1
                          from public.tickets t
                          join public.ticket_check_ins c on c.ticket_code = t.code and c.result = 'admitted'
                         where t.order_id = o.id
                           and not exists (select 1 from private.ticket_transfers x
                                            where x.ticket_code = t.code and x.status = 'accepted')) then 'scanned'
           when exists (select 1 from private.order_email_changes x
                         where x.order_id = o.id and x.changed_by = 'buyer') then 'already_changed'
         end
    from (select p_order_id as id) k
    left join public.orders o on o.id = k.id
    left join public.events e on e.id = o.event_id;
$$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- As in 20261118000100_ticket_holder_messages.sql, plus an offer's link tokens
-- 30 days after it left pending, and offers that weren't accepted (declined,
-- cancelled, expired: a third party's name and email) 30 days after their
-- event ended. Accepted offers are kept: they carry the recipient's code, as
-- orders keep the buyer's details.
drop function private.purge_operational_data();

create function private.purge_operational_data(
  out unconfirmed_orders_deleted integer, out platform_rate_limits_deleted integer,
  out free_order_refusals_deleted integer, out email_jobs_deleted integer,
  out client_rate_limits_deleted integer, out account_invites_deleted integer,
  out early_charge_refunds_deleted integer, out payment_exceptions_deleted integer,
  out refund_status_marks_deleted integer, out checkout_attempts_deleted integer,
  out organiser_invite_links_deleted integer, out holder_messages_deleted integer,
  out event_reminders_deleted integer, out ticket_transfer_tokens_deleted integer,
  out ticket_transfers_deleted integer)
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

  delete from private.ticket_transfer_tokens k
   using private.ticket_transfers x
   where x.id = k.transfer_id and x.status <> 'pending' and x.decided_at < now() - interval '30 days';
  get diagnostics ticket_transfer_tokens_deleted = row_count;

  -- Their tokens and jobs go with them (on delete cascade).
  delete from private.ticket_transfers x
   using public.events e
   where e.id = x.event_id and x.status in ('declined', 'cancelled', 'expired')
     and e.ends_at < now() - interval '30 days';
  get diagnostics ticket_transfers_deleted = row_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.person_name_ok(text) from public, anon, authenticated;
revoke all on function private.ticket_transfers_guard() from public, anon, authenticated;
revoke all on function private.tickets_code_not_reissued() from public, anon, authenticated;
revoke all on function private.member_held_tickets(uuid, text) from public, anon, authenticated;
revoke all on function private.expire_overdue_ticket_offer(text, timestamptz, interval) from public, anon, authenticated;
revoke all on function private.ticket_offer_refusal(text, public.orders, public.events, text, uuid, text, text, boolean,
  boolean, interval, integer, integer, integer) from public, anon, authenticated;
revoke all on function private.insert_ticket_offer(text, text, uuid, text, uuid, uuid, text, text, text, timestamptz,
  integer, interval, integer, interval, integer, interval) from public, anon, authenticated;
revoke all on function private.create_ticket_transfer(text, integer, uuid, text, text, text, text, boolean, boolean, interval,
  interval, integer, integer, integer, integer, interval, integer, interval, integer, interval) from public, anon, authenticated;
revoke all on function private.create_holder_ticket_transfer(uuid, uuid, text, text, text, boolean, boolean, interval,
  interval, integer, integer, integer, integer, interval, integer, interval, integer, interval) from public, anon, authenticated;
revoke all on function private.cancel_ticket_transfer(uuid, text, text, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function private.accept_ticket_transfer(text, uuid, text, text, text, interval, integer, integer, interval)
  from public, anon, authenticated;
revoke all on function private.decline_ticket_transfer(text) from public, anon, authenticated;
revoke all on function private.expire_ticket_transfers(integer, interval) from public, anon, authenticated;
revoke all on function private.check_in_ticket(uuid, uuid, uuid, text, uuid, integer, interval) from public, anon, authenticated;
revoke all on function private.undo_check_in(uuid, uuid, uuid, uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function private.set_going(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.order_email_change_block(text) from public, anon, authenticated;
revoke all on function private.purge_operational_data() from public, anon, authenticated;
