-- Admin invites (docs/architecture.md, "Account invites"; owner decisions of
-- 25 Oct 2026). An admin invites someone who asked to join, as an organiser
-- (with their organiser details, approved on acceptance) or as a member. The
-- server emails a link, `/invite#token=…`, through our own SMTP; only the
-- token's SHA-256 is stored here. The link works for 14 days.
--
--   * private.account_invites: one row per invite. `kind` organiser (with
--     `organiser_profile`: the application's fields, validated by the API
--     with the application's rules, re-checked by public.organisers' own
--     constraints on acceptance) or member. `status` pending → accepted /
--     revoked / expired (an invite whose `expires_at` has passed counts as
--     expired whether or not its status says so yet; create and resend mark
--     it). At most one pending invite per address (ignoring case).
--   * private.create_account_invite: an admin's invite, refused when the
--     address already has a pending invite (`already_invited`) or, for an
--     organiser invite, when the address's account already has an organiser
--     (`already_organiser`); then the admin's hourly allowance and the
--     platform's daily one, taken only when the invite is written (a refusal
--     keeps neither hit).
--   * private.resend_account_invite: a new token (the old link stops
--     working), 14 days from now, at most once a minute, under the same
--     allowances.
--   * private.issue_invite_account_link: the invite page's "Create account"
--     step. Locks the invite, checks it's usable, refuses an address that
--     already has a confirmed account (`has_account`: sign in instead) and
--     more than p_cap link requests per invite; otherwise counts one and
--     returns the address (the API then asks Supabase Auth for a sign-up
--     token: lib/server/auth-admin.ts).
--   * private.accept_account_invite: the signed-in invitee's acceptance, by
--     a verified email equal to the invite's (ignoring case). For an
--     organiser invite, creates their organiser, approved (reviewed by the
--     inviting admin), owned by their account, and logs `invite_accepted` on
--     private.organiser_profile_edits, in the same step. Idempotent for the
--     same account. An account that already has an organiser (any status) is
--     `has_organiser`, also when it loses a race with an application.
--   * private.organiser_profile_edits: kind 'invite_accepted' added.
--   * private.purge_operational_data: also deletes invites 90 days after they
--     were accepted, revoked or expired (`account_invites_deleted`; drop +
--     create since its result columns change; `select
--     private.purge_operational_data()`, the Supabase Cron job, is unaffected).
--
-- A new organiser created here is approved from the start, so the admins'
-- review email trigger (organisers_review_email_insert: only `pending` rows)
-- doesn't fire.
--
-- Locks: accept locks the invite, then inserts the organiser (the
-- owner_user_id unique index). Nothing else locks an invite and then an
-- organiser, and nothing that locks organisers (suspend_organiser,
-- edit_organiser_profile) touches invites, so there's no lock cycle. Revoke
-- is a single conditional update in the API (`where status = 'pending'`), so
-- a revoke and an accept are serialised by the invite's row lock: whichever
-- is second sees the other's result.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC and its
-- search_path pinned. No security definer.
--
-- Indexes:
--   * account_invites_pending_email_key: unique (lower(email)) among pending
--     invites: one pending invite per address, the create's lookup, and the
--     signed-in invitee's lookup (GET /invites/me) by their verified email.
--   * token_hash unique: the emailed link's lookup.
--   * account_invites_status_created_idx (status, created_at desc): the
--     admin list (one status, newest first) and the purge's scan by status.
--   * No index on invited_by / last_sent_by / accepted_by / revoked_by /
--     accepted_organiser_id: they're only read with the row, and the
--     foreign keys' `on delete set null` scans the table, which holds at most
--     a few thousand rows (100 invites a day platform-wide, purged after 90
--     days).
--   * The "already has an account" checks read auth.users by lower(email):
--     a scan of Supabase's own table, once per create and link request; fine
--     while accounts number in the thousands (as the admin review emails).
--
-- Reversible, not destructive: restore private.purge_operational_data from
-- 20261103000000_seat_hold_client_limits.sql (drop + create); drop the four
-- functions and table private.account_invites (discarding invites); delete
-- the organiser log's `invite_accepted` entries and restore its kind check
-- from 20261018000000_organiser_profile_moderation.sql. Organisers created by
-- accepted invites are ordinary approved organisers and stay.

-- ---------------------------------------------------------------------------
-- The invites
-- ---------------------------------------------------------------------------

create table private.account_invites (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('organiser', 'member')),
  -- As the admin typed it (a plain address, checked by the API); matched ignoring case.
  email text not null check (char_length(email) between 3 and 254),
  -- SHA-256 (hex) of the emailed token, never the token.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- An organiser invite's organiser: the public.organisers columns
  -- display_name, contact_email, description, categories (array),
  -- website_url, instagram_handle, tiktok_handle, facebook_page, x_handle,
  -- featured_video_provider, featured_video_id (absent or null: unset).
  organiser_profile jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references auth.users (id) on delete set null,
  last_sent_by uuid references auth.users (id) on delete set null,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- When a resend last replaced the token.
  rotated_at timestamptz,
  last_sent_at timestamptz,
  -- Set when the last email failed to send (the admin can resend); cleared by a resend.
  last_send_failed_at timestamptz,
  send_count integer not null default 1 check (send_count >= 0),
  -- Sign-up tokens requested from Supabase Auth with the current link (capped by the API).
  links_issued integer not null default 0 check (links_issued >= 0),
  accepted_at timestamptz,
  accepted_organiser_id uuid references public.organisers (id) on delete set null,
  revoked_at timestamptz,
  constraint account_invites_kind_profile check (
    (kind = 'organiser') = (organiser_profile is not null)
    and (organiser_profile is null or jsonb_typeof(organiser_profile) = 'object')),
  constraint account_invites_accepted check ((status = 'accepted') = (accepted_at is not null)),
  constraint account_invites_revoked check ((status = 'revoked') = (revoked_at is not null)),
  constraint account_invites_accepted_organiser check (accepted_organiser_id is null or kind = 'organiser')
);

create unique index account_invites_pending_email_key on private.account_invites (lower(email)) where status = 'pending';
create index account_invites_status_created_idx on private.account_invites (status, created_at desc);

alter table private.account_invites enable row level security;
revoke all on private.account_invites from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The organiser log's new kind
-- ---------------------------------------------------------------------------

-- The inline check of 20261018000000_organiser_profile_moderation.sql has
-- Postgres's default name.
alter table private.organiser_profile_edits
  drop constraint organiser_profile_edits_kind_check,
  add constraint organiser_profile_edits_kind_check check (kind in ('profile_edit', 'suspended', 'invite_accepted'));

-- ---------------------------------------------------------------------------
-- Creating and resending
-- ---------------------------------------------------------------------------

-- An admin's invite (see the header). p_organiser_profile: an organiser
-- invite's organiser (null for a member). Returns result 'created' (with the
-- invite's id), 'already_invited', 'already_organiser' or 'rate_limited'.
-- Nothing is written on a refusal, apart from marking an expired invite for
-- the same address expired.
create function private.create_account_invite(
  p_admin_id uuid, p_kind text, p_email text, p_token_hash text, p_organiser_profile jsonb, p_ttl interval,
  p_admin_limit integer, p_admin_window interval, p_daily_limit integer, p_daily_window interval,
  out result text, out invite_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_constraint text;
begin
  -- An expired invite no longer holds the address's one pending slot.
  update private.account_invites i set status = 'expired'
   where lower(i.email) = lower(p_email) and i.status = 'pending' and i.expires_at <= now();

  perform 1 from private.account_invites i where lower(i.email) = lower(p_email) and i.status = 'pending';
  if found then
    result := 'already_invited';
    return;
  end if;

  if p_kind = 'organiser' then
    perform 1 from auth.users u join public.organisers o on o.owner_user_id = u.id
     where lower(u.email) = lower(p_email);
    if found then
      result := 'already_organiser';
      return;
    end if;
  end if;

  begin
    if not private.take_rate_limit(p_admin_id, 'account_invites', p_admin_limit, p_admin_window)
       or not private.take_platform_rate_limit('account_invites_daily', p_daily_limit, p_daily_window) then
      raise exception 'invite allowance used up' using errcode = 'SH429';
    end if;
    insert into private.account_invites (kind, email, token_hash, organiser_profile, invited_by, last_sent_by,
                                         expires_at, last_sent_at)
    values (p_kind, p_email, p_token_hash, p_organiser_profile, p_admin_id, p_admin_id, now() + p_ttl, now())
    returning id into invite_id;
    result := 'created';
  exception
    -- Both undo the hits taken in this block.
    when sqlstate 'SH429' then
      result := 'rate_limited';
      invite_id := null;
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- Another admin invited the same address at the same moment.
      if v_constraint <> 'account_invites_pending_email_key' then
        raise;
      end if;
      result := 'already_invited';
      invite_id := null;
  end;
end;
$$;

-- An admin's resend: a new token (p_token_hash; the old link stops working),
-- valid p_ttl from now, its link count reset. A pending invite, or an
-- expired one (it becomes pending again, unless the address has another
-- pending invite by now: 'already_invited'). Not within p_cooldown of the
-- last send ('too_soon'). Same allowances as create_account_invite, taken
-- only when it's resent. Returns 'resent', 'not_found', 'not_pending'
-- (accepted or revoked), 'too_soon', 'already_invited' or 'rate_limited'.
create function private.resend_account_invite(
  p_admin_id uuid, p_invite_id uuid, p_token_hash text, p_ttl interval, p_cooldown interval,
  p_admin_limit integer, p_admin_window interval, p_daily_limit integer, p_daily_window interval,
  out result text)
language plpgsql
set search_path = ''
as $$
declare
  v_invite private.account_invites;
  v_constraint text;
begin
  select * into v_invite from private.account_invites i where i.id = p_invite_id for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  if v_invite.status not in ('pending', 'expired') then
    result := 'not_pending';
    return;
  end if;
  if v_invite.last_sent_at > now() - p_cooldown then
    result := 'too_soon';
    return;
  end if;

  begin
    if not private.take_rate_limit(p_admin_id, 'account_invites', p_admin_limit, p_admin_window)
       or not private.take_platform_rate_limit('account_invites_daily', p_daily_limit, p_daily_window) then
      raise exception 'invite allowance used up' using errcode = 'SH429';
    end if;
    update private.account_invites i
       set status = 'pending', token_hash = p_token_hash, expires_at = now() + p_ttl, rotated_at = now(),
           last_sent_at = now(), last_sent_by = p_admin_id, last_send_failed_at = null,
           send_count = i.send_count + 1, links_issued = 0
     where i.id = p_invite_id;
    result := 'resent';
  exception
    when sqlstate 'SH429' then
      result := 'rate_limited';
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'account_invites_pending_email_key' then
        raise;
      end if;
      result := 'already_invited';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- The invitee
-- ---------------------------------------------------------------------------

-- The invite page's "Create account": by the emailed token's hash. Returns
-- 'ok' with the invite's address (one sign-up token request counted),
-- 'not_found', 'used' (accepted), 'revoked', 'expired', 'has_account' (the
-- address already has a confirmed account: sign in instead) or 'limit'
-- (p_cap requests already made with this link).
create function private.issue_invite_account_link(p_token_hash text, p_cap integer, out result text, out email text)
language plpgsql
set search_path = ''
as $$
declare
  v_invite private.account_invites;
begin
  select * into v_invite from private.account_invites i where i.token_hash = p_token_hash for update;
  if not found then
    result := 'not_found';
    return;
  end if;
  if v_invite.status = 'accepted' then
    result := 'used';
    return;
  end if;
  if v_invite.status = 'revoked' then
    result := 'revoked';
    return;
  end if;
  if v_invite.status = 'expired' or v_invite.expires_at <= now() then
    result := 'expired';
    return;
  end if;
  perform 1 from auth.users u where lower(u.email) = lower(v_invite.email) and u.email_confirmed_at is not null;
  if found then
    result := 'has_account';
    return;
  end if;
  if v_invite.links_issued >= p_cap then
    result := 'limit';
    return;
  end if;
  update private.account_invites i set links_issued = i.links_issued + 1 where i.id = v_invite.id;
  result := 'ok';
  email := v_invite.email;
end;
$$;

-- The signed-in invitee accepts invite p_invite_id. p_email is their account's
-- verified email (the API checks it's verified); it must equal the invite's,
-- ignoring case, otherwise the invite is 'not_found' (nothing about it is
-- revealed). Returns:
--   'accepted' / 'already_accepted' (by this account before): kind, and the
--     organiser for an organiser invite;
--   'not_found', 'used' (accepted by another account), 'revoked', 'expired';
--   'has_organiser': the account already has an organiser (nothing written).
create function private.accept_account_invite(
  p_invite_id uuid, p_user_id uuid, p_email text,
  out result text, out kind text, out organiser_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_invite private.account_invites;
  v_profile jsonb;
begin
  select * into v_invite from private.account_invites i where i.id = p_invite_id for update;
  if not found or lower(v_invite.email) <> lower(p_email) then
    result := 'not_found';
    return;
  end if;
  kind := v_invite.kind;
  if v_invite.status = 'accepted' then
    if v_invite.accepted_by = p_user_id then
      result := 'already_accepted';
      organiser_id := v_invite.accepted_organiser_id;
    else
      result := 'used';
      kind := null;
    end if;
    return;
  end if;
  if v_invite.status = 'revoked' then
    result := 'revoked';
    kind := null;
    return;
  end if;
  if v_invite.status = 'expired' or v_invite.expires_at <= now() then
    result := 'expired';
    kind := null;
    return;
  end if;

  if v_invite.kind = 'organiser' then
    v_profile := v_invite.organiser_profile;
    -- One organiser per account (owner_user_id is unique): an existing one, or
    -- an application committed while this ran, wins.
    insert into public.organisers (owner_user_id, display_name, contact_email, description, categories, website_url,
                                   instagram_handle, tiktok_handle, facebook_page, x_handle,
                                   featured_video_provider, featured_video_id,
                                   status, reviewed_by, reviewed_at)
    values (p_user_id, v_profile ->> 'display_name', v_profile ->> 'contact_email', v_profile ->> 'description',
            array(select jsonb_array_elements_text(v_profile -> 'categories'))::public.event_category[],
            v_profile ->> 'website_url', v_profile ->> 'instagram_handle', v_profile ->> 'tiktok_handle',
            v_profile ->> 'facebook_page', v_profile ->> 'x_handle',
            v_profile ->> 'featured_video_provider', v_profile ->> 'featured_video_id',
            'approved', v_invite.invited_by, now())
    on conflict (owner_user_id) do nothing
    returning id into organiser_id;
    if organiser_id is null then
      result := 'has_organiser';
      kind := null;
      return;
    end if;
    insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
    values (organiser_id, 'invite_accepted', p_user_id,
            jsonb_build_object('status', jsonb_build_object('old', null, 'new', 'approved')));
  end if;

  update private.account_invites i
     set status = 'accepted', accepted_at = now(), accepted_by = p_user_id, accepted_organiser_id = organiser_id
   where i.id = v_invite.id;
  result := 'accepted';
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- As in 20261103000000_seat_hold_client_limits.sql, plus invites 90 days
-- after they were accepted, revoked or expired.
drop function private.purge_operational_data();

create function private.purge_operational_data(
  out unconfirmed_orders_deleted integer, out platform_rate_limits_deleted integer,
  out free_order_refusals_deleted integer, out email_jobs_deleted integer,
  out client_rate_limits_deleted integer, out account_invites_deleted integer)
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.create_account_invite(uuid, text, text, text, jsonb, interval, integer, interval, integer, interval)
  from public, anon, authenticated;
revoke all on function private.resend_account_invite(uuid, uuid, text, interval, interval, integer, interval, integer, interval)
  from public, anon, authenticated;
revoke all on function private.issue_invite_account_link(text, integer) from public, anon, authenticated;
revoke all on function private.accept_account_invite(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.purge_operational_data() from public, anon, authenticated;
