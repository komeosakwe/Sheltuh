-- Organiser links (docs/architecture.md, "Account invites" → "Organiser
-- links"; owner decision of 27 Oct 2026). An admin presses "Create organiser
-- link" (no email or details), copies the link and sends it however they
-- like (WhatsApp, email). Whoever opens it signs up or signs in as usual
-- (any address, verified), types their organiser name, and becomes an
-- approved organiser. One link, one organiser: it works once, for 7 days,
-- and an admin can cancel it until it's used. The link is
-- `/organisers/join#token=…` (32 random bytes, base64url, in the fragment);
-- only the token's SHA-256 is stored here.
--
-- A table of its own rather than an email-less kind of
-- private.account_invites: every invite path there is keyed on (or reveals)
-- the address (one pending invite per address, `view`'s masked address,
-- `GET /invites/me`, the sign-up token for the address, acceptance by a
-- verified email equal to the invite's, the admin list's `email`), so a row
-- without one would need a guard on each of them. This file changes none of
-- them.
--
--   * private.organiser_invite_links: one row per link. `status` active →
--     used / cancelled (an active link past `expires_at` reads as expired;
--     nothing marks it). Who created, used and cancelled it (each `on delete
--     set null`), and the organiser it made or approved.
--   * private.create_organiser_invite_link: an admin's new link, under their
--     hourly allowance and the platform's daily one, taken only when the
--     link is written.
--   * private.join_with_organiser_invite_link: the signed-in, verified
--     caller's join, in one transaction: locks the link, checks it's active,
--     unexpired and its creator is still an admin (otherwise it's marked
--     cancelled, as an invite whose inviter was demoted is revoked), then
--     locks the caller's organiser, if any: none → a new approved organiser
--     (the typed name and categories, their account's verified email as the
--     contact email, an empty bio to fill in later); pending → that
--     application approved as it is; approved, rejected (or taken down) →
--     refused, and the link stays unused. Marks the link used and logs
--     `invite_accepted` on the organiser's log. Idempotent for the account
--     that used it.
--   * private.purge_operational_data: also deletes links 90 days after they
--     were used or cancelled, or expired (`organiser_invite_links_deleted`;
--     drop + create since its result columns change; `select
--     private.purge_operational_data()`, the Supabase Cron job, is
--     unaffected).
--
-- A new organiser is approved from the start, so the admins' review email
-- trigger (organisers_review_email_insert: only `pending` rows) doesn't fire;
-- approving a pending application drops its waiting review email
-- (organisers_review_email_drop), as an admin's approval does.
--
-- Locks: join locks the link, then the caller's organiser row (or inserts
-- one: the owner_user_id unique index). Nothing locks an organiser and then
-- a link; cancel is a single conditional update of the link alone (`where
-- status = 'active'`), so a cancel and a join are serialised by the link's
-- row lock: whichever is second sees the other's result. An admin's approval
-- (a conditional update of the organiser `where status = 'pending'`) racing
-- a join of the same application: whichever is second finds it approved
-- (the admin 409, the join `already_organiser` with the link unused).
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC and its
-- search_path pinned. No security definer.
--
-- Indexes:
--   * token_hash unique: the link's lookup (view and join).
--   * organiser_invite_links_created_idx (created_at desc, id desc): the
--     admin list, newest first.
--   * No index on created_by / used_by / cancelled_by / organiser_id or for
--     the purge: read only with the row, and the foreign keys' `on delete
--     set null` and the daily purge scan a table of at most a few thousand
--     rows (20 links an hour per admin, 50 a day platform-wide, deleted 90
--     days after they're done).
--
-- Reversible, not destructive: restore private.purge_operational_data from
-- 20261109000400_checkout_attempts.sql (drop + create); drop the two
-- functions and table private.organiser_invite_links (discarding the links
-- and their history). Organisers created or approved by a link are ordinary
-- approved organisers and stay, as do their `invite_accepted` log entries.

-- ---------------------------------------------------------------------------
-- The links
-- ---------------------------------------------------------------------------

create table private.organiser_invite_links (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 (hex) of the link's token, never the token.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'used', 'cancelled')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  -- The organiser the link created, or the application it approved.
  organiser_id uuid references public.organisers (id) on delete set null,
  -- Null with cancelled_at set: cancelled because its creator is no longer an admin.
  cancelled_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  constraint organiser_invite_links_expiry check (expires_at > created_at),
  constraint organiser_invite_links_used check ((status = 'used') = (used_at is not null)),
  constraint organiser_invite_links_cancelled check ((status = 'cancelled') = (cancelled_at is not null))
);

create index organiser_invite_links_created_idx on private.organiser_invite_links (created_at desc, id desc);

alter table private.organiser_invite_links enable row level security;
revoke all on private.organiser_invite_links from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Creating
-- ---------------------------------------------------------------------------

-- An admin's new link, valid p_ttl from now. Returns result 'created' (with
-- the link's id) or 'rate_limited' (over the admin's hourly allowance or the
-- platform's daily one; a refusal keeps neither hit).
create function private.create_organiser_invite_link(
  p_admin_id uuid, p_token_hash text, p_ttl interval,
  p_admin_limit integer, p_admin_window interval, p_daily_limit integer, p_daily_window interval,
  out result text, out link_id uuid)
language plpgsql
set search_path = ''
as $$
begin
  begin
    if not private.take_rate_limit(p_admin_id, 'organiser_invite_links', p_admin_limit, p_admin_window)
       or not private.take_platform_rate_limit('organiser_invite_links_daily', p_daily_limit, p_daily_window) then
      raise exception 'organiser link allowance used up' using errcode = 'SH429';
    end if;
    insert into private.organiser_invite_links (token_hash, created_by, expires_at)
    values (p_token_hash, p_admin_id, now() + p_ttl)
    returning id into link_id;
    result := 'created';
  exception
    -- Undoes the hits taken in this block.
    when sqlstate 'SH429' then
      result := 'rate_limited';
      link_id := null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Joining
-- ---------------------------------------------------------------------------

-- The signed-in caller p_user_id (with the verified email p_email: the API
-- checks it's verified) joins with the link whose token hashes to
-- p_token_hash. p_display_name / p_categories: the new organiser's name and
-- categories (validated by the API with the application's rules), used only
-- when the account has no organiser yet. Returns:
--   'joined' / 'already_joined' (this account used the link before):
--     organiser_id;
--   'unavailable': no such link, or it's used (by another account),
--     cancelled or expired, or its creator is no longer an admin (then it's
--     marked cancelled);
--   'already_organiser' (approved), 'rejected' (rejected or taken down):
--     nothing written, the link stays active;
--   'details_required': no organiser yet, and no name or categories given
--     (nothing written);
--   'conflict': an application was committed for the account while this
--     ran (nothing written; trying again approves it).
create function private.join_with_organiser_invite_link(
  p_token_hash text, p_user_id uuid, p_email text, p_display_name text, p_categories jsonb,
  out result text, out organiser_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_link private.organiser_invite_links;
  v_status public.organiser_status;
  v_organiser_id uuid;
begin
  select * into v_link from private.organiser_invite_links l where l.token_hash = p_token_hash for update;
  if not found then
    result := 'unavailable';
    return;
  end if;
  if v_link.status = 'used' then
    if v_link.used_by = p_user_id and v_link.organiser_id is not null then
      result := 'already_joined';
      organiser_id := v_link.organiser_id;
    else
      result := 'unavailable';
    end if;
    return;
  end if;
  if v_link.status = 'cancelled' or v_link.expires_at <= now() then
    result := 'unavailable';
    return;
  end if;
  -- The organiser is approved on the creator's say-so: only while they're an admin.
  if not private.account_invite_inviter_is_admin(v_link.created_by) then
    update private.organiser_invite_links l set status = 'cancelled', cancelled_at = now()
     where l.id = v_link.id;
    result := 'unavailable';
    return;
  end if;

  select o.id, o.status into v_organiser_id, v_status
    from public.organisers o where o.owner_user_id = p_user_id for update;
  if found then
    if v_status = 'approved' then
      result := 'already_organiser';
      return;
    end if;
    if v_status = 'rejected' then
      result := 'rejected';
      return;
    end if;
    -- Pending: the application is approved as it was submitted.
    update public.organisers o
       set status = 'approved', rejection_reason = null, reviewed_by = v_link.created_by, reviewed_at = now()
     where o.id = v_organiser_id;
    insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
    values (v_organiser_id, 'invite_accepted', p_user_id,
            jsonb_build_object('status', jsonb_build_object('old', 'pending', 'new', 'approved')));
  else
    if p_display_name is null or p_categories is null then
      result := 'details_required';
      return;
    end if;
    -- One organiser per account (owner_user_id is unique): an application
    -- committed while this ran wins.
    insert into public.organisers (owner_user_id, display_name, contact_email, description, categories,
                                   status, reviewed_by, reviewed_at)
    values (p_user_id, p_display_name, p_email, '',
            array(select jsonb_array_elements_text(p_categories))::public.event_category[],
            'approved', v_link.created_by, now())
    on conflict (owner_user_id) do nothing
    returning id into v_organiser_id;
    if v_organiser_id is null then
      result := 'conflict';
      return;
    end if;
    insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
    values (v_organiser_id, 'invite_accepted', p_user_id,
            jsonb_build_object('status', jsonb_build_object('old', null, 'new', 'approved')));
  end if;

  update private.organiser_invite_links l
     set status = 'used', used_by = p_user_id, used_at = now(), organiser_id = v_organiser_id
   where l.id = v_link.id;
  result := 'joined';
  organiser_id := v_organiser_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- As in 20261109000400_checkout_attempts.sql, plus organiser links 90 days
-- after they were used or cancelled, or expired.
drop function private.purge_operational_data();

create function private.purge_operational_data(
  out unconfirmed_orders_deleted integer, out platform_rate_limits_deleted integer,
  out free_order_refusals_deleted integer, out email_jobs_deleted integer,
  out client_rate_limits_deleted integer, out account_invites_deleted integer,
  out early_charge_refunds_deleted integer, out payment_exceptions_deleted integer,
  out refund_status_marks_deleted integer, out checkout_attempts_deleted integer,
  out organiser_invite_links_deleted integer)
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.create_organiser_invite_link(uuid, text, interval, integer, interval, integer, interval)
  from public, anon, authenticated;
revoke all on function private.join_with_organiser_invite_link(text, uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function private.purge_operational_data() from public, anon, authenticated;
