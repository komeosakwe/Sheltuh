-- Changing a paid order's email (docs/architecture.md, "Buyer email checks").
--
-- A buyer who typed the wrong address can move their order to the right one
-- once, from the browser that paid (the API checks the order access token;
-- the database never sees it), until the event ends or a ticket is scanned.
-- Support (an admin) can change it at any time, with a reason; after that
-- the buyer can't change it themselves any more (only support can, again).
-- Either way the ticket email is sent again, to the new address only; the QR
-- codes don't change (nothing is sent to, or revoked from, the old address).
--
--   * private.order_email_changes: an append-only log of every change, with
--     both addresses masked (m***@example.com, never in full), who made it
--     (the buyer, or an admin with their reason) and when. The partial unique
--     index order_email_changes_one_buyer_change is the "one change per
--     order" rule for buyers: the database refuses a second one whatever the
--     API does.
--   * private.mask_email: the SQL twin of maskEmail (lib/server/email-address.ts);
--     tests/server/order-email-change.test.ts checks they agree.
--   * private.order_email_change_block: the one definition of why a buyer's
--     change is refused (null: allowed), read by the confirmation page's
--     lookup and re-checked under the locks by the change itself.
--   * private.buyer_change_order_email / private.admin_change_order_email,
--     over private.change_order_email: lock, check, update orders.buyer_email,
--     log, and queue the ticket email again, in one transaction.
--
-- Locks: the order's ticket_email outbox job (for update), then the order
-- (for update): the order private.finish_email_job takes them in (job, then
-- order), so a change and the email worker can't deadlock. A worker in the
-- middle of sending loses its lease (the job is pending again), so its finish
-- is 'lease_lost' and the email goes out again, to the new address. A job
-- queued after the first look (the payment recorded at that instant) is taken
-- only if it's free right now ('busy' otherwise): waiting for it while holding
-- the order would invert the order. record_payment_refund and check_in_ticket
-- lock the order too, so a refund or a scan either happens first (and the
-- change is refused) or waits for it. An admin's allowance (take_rate_limit,
-- 'order_email_changes') is taken last, after the order.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated; every new function's execute revoked from PUBLIC, anon and
-- authenticated, search_path pinned, none security definer.
--
-- Indexes: order_email_changes_order_idx (order_id, created_at desc, id desc)
-- serves the admin list's newest 5 changes per order, the confirmation page's
-- "changed at all" and "changed by support" checks and the orders
-- cascade; the partial unique index serves the "already changed" check. The block
-- function reads the order and event by primary key, the tickets by
-- tickets_order_idx and their scans by ticket_check_ins_code_idx; the
-- account check reads auth.users by lower(email), a scan, as the invites
-- already do (fine at this size).
--
-- No existing table, column, index or function is changed.
--
-- Not destructive on the way in (nothing existing changes). The way out:
-- roll the code back and leave this in place (the previous release never
-- reads it). Dropping it is destructive once any order's email has changed:
-- the log is what keeps a buyer to one change, keeps the paying browser out
-- after support's change, and hides a changed address from the order's
-- link, so a re-applied empty log would undo all three for those orders.
-- Only before any change, or with the log's rows exported first and put
-- back before the code that changes emails runs again (their ids too, with
-- `overriding system value`, and then the identity sequence advanced past
-- the highest: select setval(pg_get_serial_sequence('private.order_email_changes',
-- 'id'), (select max(id) from private.order_email_changes)); left at 1, the
-- next change's insert collides with a restored id and is refused): drop functions
-- private.admin_change_order_email, private.buyer_change_order_email,
-- private.change_order_email, private.order_email_change_block and
-- private.mask_email, then table private.order_email_changes (its trigger
-- goes with it), then function private.order_email_changes_append_only. The
-- addresses already changed stay as they are on the orders.

create table private.order_email_changes (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders (id) on delete cascade,
  -- buyer: the paying browser's own change (one per order). admin: support's, with a reason.
  changed_by text not null check (changed_by in ('buyer', 'admin')),
  -- The admin who made it; null for a buyer, and once that account is deleted.
  admin_id uuid references auth.users (id) on delete set null,
  reason text check (char_length(reason) between 3 and 500),
  -- private.mask_email of the addresses: never the address itself. The old one is null if there was none.
  old_email_masked text check (char_length(old_email_masked) <= 260),
  new_email_masked text not null check (char_length(new_email_masked) <= 260),
  -- When the change was written (under the order's lock), not when its transaction began (now()): so changes to
  -- one order sort in the order they were made in, whichever transaction started first.
  created_at timestamptz not null default clock_timestamp(),
  constraint order_email_changes_reason check ((changed_by = 'admin') = (reason is not null)),
  constraint order_email_changes_buyer_no_admin check (changed_by = 'admin' or admin_id is null)
);

-- One self-serve change per order, enforced here (decision 4).
create unique index order_email_changes_one_buyer_change on private.order_email_changes (order_id)
  where changed_by = 'buyer';
create index order_email_changes_order_idx on private.order_email_changes (order_id, created_at desc, id desc);

alter table private.order_email_changes enable row level security;
revoke all on private.order_email_changes from public, anon, authenticated;
revoke all on sequence private.order_email_changes_id_seq from public, anon, authenticated;

-- Append-only: an entry can't be rewritten. The one update allowed is the
-- foreign key's own `on delete set null` of admin_id when that account is
-- deleted. Deletes are allowed only so the log goes with its order.
create function private.order_email_changes_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.admin_id is null
     and old.admin_id is not null
     and (new.id, new.order_id, new.changed_by, new.reason, new.old_email_masked, new.new_email_masked, new.created_at)
         is not distinct from
         (old.id, old.order_id, old.changed_by, old.reason, old.old_email_masked, old.new_email_masked, old.created_at) then
    return new;
  end if;
  raise exception 'private.order_email_changes is append-only';
end;
$$;

create trigger order_email_changes_append_only
  before update on private.order_email_changes
  for each row execute function private.order_email_changes_append_only();

-- "mia@example.com" -> "m***@example.com": the first character, then the
-- domain from the last "@". "***" when there's no "@" or nothing before it.
-- maskEmail's (lib/server/email-address.ts) rule exactly.
create function private.mask_email(p_email text) returns text
language sql
immutable strict
set search_path = ''
as $$
  select case
           when strpos(p_email, '@') = 0 then '***'
           when char_length(p_email) - strpos(reverse(p_email), '@') + 1 <= 1 then '***'
           else left(p_email, 1) || '***' || substr(p_email, char_length(p_email) - strpos(reverse(p_email), '@') + 1)
         end;
$$;

-- Why the buyer can't change this order's email now, or null when they can:
--   'not_found'       no such order
--   'not_card_order'  not a card checkout (a free order: its address was
--                     confirmed by a link, or is the member's own)
--   'not_paid'        not paid (pending, failed, refunded or being refunded)
--   'changed_by_support' support (an admin) has changed it: from then on only
--                     support can change it again, so the paying browser (whose
--                     token may be on a device the old address's holder uses)
--                     can't undo what support checked with the buyer
--   'ended'           the event has ended (ends_at <= now(), the platform's
--                     definition), or is gone
--   'scanned'         one of its tickets was admitted at the door (even if
--                     that admission was undone since)
--   'already_changed' the buyer has already made their one change
create function private.order_email_change_block(p_order_id text) returns text
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
                         where t.order_id = o.id) then 'scanned'
           when exists (select 1 from private.order_email_changes x
                         where x.order_id = o.id and x.changed_by = 'buyer') then 'already_changed'
         end
    from (select p_order_id as id) k
    left join public.orders o on o.id = k.id
    left join public.events e on e.id = o.event_id;
$$;

-- The change itself (internal: called by the two below). p_new_email must be
-- one plain address (the API checks it; a malformed one raises 22023 here).
-- A buyer's change is refused for every order_email_change_block reason, and
-- for an address with a confirmed account (`account_email`) unless that
-- account is p_caller_id (the signed-in buyer moving the order to their own
-- confirmed address). An admin's skips both (support has checked with the
-- buyer), but needs a reason. Returns:
--   'changed'         buyer_email updated, the change logged, the ticket email
--                     pending again (due now, a fresh set of attempts)
--   'unchanged'       the same address, ignoring case: nothing written (a
--                     buyer's one change isn't used up)
--   'not_found', 'not_card_order', 'not_paid', and for a buyer
--   'changed_by_support', 'ended', 'scanned', 'already_changed' (also a lost
--   race: the unique index),
--   'account_email'   nothing written
--   'busy'            the order's ticket email was queued at this instant
--                     and a worker holds it: nothing written, try again
create function private.change_order_email(
  p_order_id text, p_new_email text, p_changed_by text, p_admin_id uuid, p_reason text, p_caller_id uuid
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_new text := btrim(p_new_email);
  v_job_id bigint;
  v_order public.orders;
  v_block text;
begin
  if v_new is null or char_length(v_new) > 254
     or v_new !~ '^[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$' then
    raise exception 'not one plain email address' using errcode = '22023';
  end if;
  if p_changed_by is null or p_changed_by not in ('buyer', 'admin') then
    raise exception 'unknown actor kind' using errcode = '22023';
  end if;
  if p_changed_by = 'admin' and (p_admin_id is null or p_reason is null or char_length(btrim(p_reason)) < 3) then
    raise exception 'an admin change needs the admin and a reason' using errcode = '22023';
  end if;

  -- The job, then the order: finish_email_job's order.
  select j.id into v_job_id
    from private.email_outbox j where j.order_id = p_order_id and j.kind = 'ticket_email';
  if v_job_id is not null then
    -- Null again if the job went meanwhile (the purge of sent jobs): then it's looked for once more below.
    select j.id into v_job_id from private.email_outbox j where j.id = v_job_id for update;
  end if;
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_job_id is null then
    -- Queued since the first look (the payment was recorded meanwhile): take it only if it's free now.
    select j.id into v_job_id
      from private.email_outbox j where j.order_id = p_order_id and j.kind = 'ticket_email'
       for update skip locked;
    if v_job_id is null then
      perform 1 from private.email_outbox j where j.order_id = p_order_id and j.kind = 'ticket_email';
      if found then
        return 'busy';
      end if;
    end if;
  end if;

  if v_order.total_cents <= 0 then
    return 'not_card_order';
  end if;
  if v_order.status <> 'paid' then
    return 'not_paid';
  end if;
  if p_changed_by = 'buyer' then
    v_block := private.order_email_change_block(p_order_id);
    if v_block is not null then
      return v_block;
    end if;
  end if;
  if lower(v_new) = lower(coalesce(btrim(v_order.buyer_email), '')) then
    return 'unchanged';
  end if;
  -- Decision 6: an address with a confirmed account is support's to give an
  -- order to, except the signed-in buyer's own (owner decision Q1).
  if p_changed_by = 'buyer' then
    perform 1 from auth.users u
     where lower(u.email) = lower(v_new) and u.email_confirmed_at is not null and u.deleted_at is null
       and u.id is distinct from p_caller_id;
    if found then
      return 'account_email';
    end if;
  end if;

  begin
    update public.orders o set buyer_email = v_new, tickets_emailed_at = null where o.id = p_order_id;
    insert into private.order_email_changes (order_id, changed_by, admin_id, reason, old_email_masked, new_email_masked)
    values (p_order_id, p_changed_by, case when p_changed_by = 'admin' then p_admin_id end,
            case when p_changed_by = 'admin' then btrim(p_reason) end,
            private.mask_email(btrim(v_order.buyer_email)), private.mask_email(v_new));
  exception when unique_violation then
    -- order_email_changes_one_buyer_change: another change got there first (undone with this block).
    return 'already_changed';
  end;

  -- The ticket email again, now, to the new address. A worker mid-send loses its lease.
  if v_job_id is not null then
    update private.email_outbox j
       set status = 'pending', attempts = 0, next_attempt_at = now(), lease_token = null, lease_expires_at = null,
           last_error = null, sent_at = null
     where j.id = v_job_id;
  else
    insert into private.email_outbox (kind, order_id) values ('ticket_email', p_order_id);
  end if;
  return 'changed';
end;
$$;

-- The buyer's change (POST /api/orders/by-session/{id}/email, after the API
-- has checked the order access token and the address). p_caller_id: the
-- signed-in caller, passed only when their confirmed account email is the new
-- address. Returns change_order_email's results.
create function private.buyer_change_order_email(p_order_id text, p_new_email text, p_caller_id uuid default null)
returns text
language sql
set search_path = ''
as $$
  select private.change_order_email(p_order_id, p_new_email, 'buyer', null, null, p_caller_id);
$$;

-- An admin's change, by the order's ticket email job (the admin list's id;
-- the order id is never shown to admins), with a reason: then one hit on the
-- admin's 'order_email_changes' allowance (take_rate_limit), only for a
-- change actually made, in the same transaction. Over it: 'rate_limited' and
-- nothing changed. Returns (result, order_id): change_order_email's results,
-- 'not_found' for an unknown job, or 'rate_limited'.
create function private.admin_change_order_email(
  p_admin_id uuid, p_job_id bigint, p_new_email text, p_reason text, p_limit integer, p_window interval,
  out result text, out order_id text)
language plpgsql
set search_path = ''
as $$
begin
  select j.order_id into order_id
    from private.email_outbox j where j.id = p_job_id and j.kind = 'ticket_email';
  if order_id is null then
    result := 'not_found';
    return;
  end if;
  begin
    result := private.change_order_email(order_id, p_new_email, 'admin', p_admin_id, p_reason, null);
    if result = 'changed' and not private.take_rate_limit(p_admin_id, 'order_email_changes', p_limit, p_window) then
      raise exception 'order email change allowance used up' using errcode = 'SH429';
    end if;
  exception
    -- Undoes the change (and the refused hit).
    when sqlstate 'SH429' then
      result := 'rate_limited';
  end;
end;
$$;

revoke all on function private.order_email_changes_append_only() from public, anon, authenticated;
revoke all on function private.mask_email(text) from public, anon, authenticated;
revoke all on function private.order_email_change_block(text) from public, anon, authenticated;
revoke all on function private.change_order_email(text, text, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.buyer_change_order_email(text, text, uuid) from public, anon, authenticated;
revoke all on function private.admin_change_order_email(uuid, bigint, text, text, integer, interval)
  from public, anon, authenticated;
