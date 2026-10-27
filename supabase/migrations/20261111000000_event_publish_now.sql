-- Approved organisers publish their events straight away (owner decision,
-- 27 Oct 2026; docs/architecture.md, "Admin review emails" and the event
-- status flow). Until now every organiser event waited for an admin's
-- approval (private.submit_event, still the /submit route's). Now:
--
--   * private.publish_event: the organiser's publish, in one step. Draft or
--     rejected → published, logged 'approved' by the organiser's own account
--     (private.transition_event), so everything that reads "approved before"
--     (the ticketing freeze in edit_event_draft and admin_edit_event, the
--     seat-map freeze, trending's 6-hour rule, analytics' everPublished, the
--     dashboard's "Unpublished") treats it exactly as an admin's approval.
--     The followers' and the waitlist's deferred triggers fire as for any
--     publish, and the admins get an `event_published` email (below).
--     It goes to the review queue instead (→ pending_review, logged
--     'submitted', whose trigger queues the admins' review email, as
--     submit_event does) when any of these holds:
--       - the organiser's events are reviewed (organisers.event_review_required,
--         an admin's switch: private.set_event_review_required);
--       - an admin rejected or unpublished it last (the latest of its
--         approved / rejected / unpublished log entries isn't 'approved'),
--         or it's rejected now;
--       - it has a seat map (seated on-sales stay a human decision until
--         hold protection exists; docs/architecture.md, "Not built yet");
--       - p_force_review (the API sets it for a ticket link on a site that
--         isn't a known ticketing site: lib/ticketing.ts ticketProviderName);
--       - the account has published 10 in 24 hours (`event_publishes` in
--         private.rate_limits), or the platform 100
--         (`event_self_publishes_daily` in private.platform_rate_limits).
--         Taken last, and the account's first, so an event that goes to
--         review anyway takes no slot, and a refusal of the account's takes
--         no platform slot. Over either, it goes to review: never refused.
--     Refused (nothing written): not the organiser's, or the organiser isn't
--     approved ('not_found'); already published ('already_published', the
--     API's idempotent 200) or waiting for review ('in_review'); ended
--     ('ended'); a paid Sheltüh ticket type without payouts
--     ('payouts_required', as submit_event); the ticket link isn't the one
--     the API judged (`stale`: it changed in between).
--   * organisers.event_review_required (default false) and
--     private.set_event_review_required: an admin's per-organiser switch,
--     logged in private.organiser_profile_edits as a `profile_edit` by the
--     admin with the reason (changed_fields `event_review_required`, "on" /
--     "off").
--   * private.email_outbox kind `event_published`: the admins' "an organiser
--     published an event" email, keyed on event_id (the same one-active-job
--     per event index as `event_review`). Queued by publish_event only (an
--     admin's own approval or publish sends nothing), through
--     private.queue_review_email (redefined from 20261107000000 with that
--     kind: the same throttles, 10 a day per account, 100 a day platform-wide,
--     one waiting per event, in buckets of their own so publishes never use
--     up the review emails). A waiting one is deleted when the event leaves
--     `published` (an admin unpublished it first); one being sent checks the
--     status itself.
--   * private.lease_outbox_jobs (redefined from 20261109000200): without
--     p_kind it leaves `event_published` jobs alone, as it does ops alerts,
--     so a previous app version (whose cron leases every kind) can't take
--     one and fail it as an unknown job. This release's drain asks for them
--     by kind.
--   * event_moderation_log_approved_idx: the admin "recently published"
--     list and the admin home's count of events organisers published.
--
-- Locks: publish_event share-locks the organiser, then locks the event (for
-- no key update), as submit_event, the admin approval's guard and
-- suspend_organiser (organiser for update, then events) do, so none of them
-- can deadlock with it and a takedown, a payouts change or the review switch
-- either waits for the publish or is seen by it. Then the rate-limit rows,
-- then (queue_review_email) the per-event advisory lock and the review-email
-- limits, as the review trigger does at commit. set_event_review_required
-- locks only the organiser row (for update).
--
-- Indexes:
--   * event_moderation_log (created_at, event_id) where action = 'approved':
--     approvals in the last 14 days (GET /admin/events?recent=1) and 72 hours
--     (GET /admin/summary) by range, without walking every event's log.
--   * Everything else is by primary key, event_moderation_log_event_idx
--     (event_id, id: an event's latest decision) or the outbox's existing
--     event_id indexes.
--
-- Access model as everywhere else: no new table; RLS stays on everywhere;
-- every new or redefined function pins its search_path, isn't security
-- definer and has execute revoked from PUBLIC, anon and authenticated.
--
-- Additive, no data change. Reversible: drop the trigger
-- events_published_email_drop and the functions private.publish_event,
-- private.set_event_review_required and private.drop_published_email;
-- restore private.queue_review_email from 20261107000000_admin_review_emails.sql
-- and private.lease_outbox_jobs from 20261109000200_payment_reconciliation.sql;
-- delete the outbox's `event_published` jobs and restore its kind checks from
-- 20261109000400_checkout_attempts.sql (kind_key) and
-- 20261109000200_payment_reconciliation.sql (kind_check); drop the index
-- event_moderation_log_approved_idx and the column
-- organisers.event_review_required (that discards only the switch; its log
-- entries stay). Events self-published meanwhile stay published, logged
-- 'approved' by their organiser.

-- ---------------------------------------------------------------------------
-- The per-organiser review switch
-- ---------------------------------------------------------------------------

alter table public.organisers
  add column event_review_required boolean not null default false;

-- An admin turns review of p_organiser_id's events on or off, with a reason
-- (1-500 characters: organiser_profile_edits.reason), logged as a
-- `profile_edit` by the admin. Locks the organiser row (for update), as
-- admin_remove_featured_video does. Returns 'updated', 'unchanged' (already
-- so: nothing logged) or 'not_found'.
create function private.set_event_review_required(
  p_organiser_id uuid, p_admin_id uuid, p_required boolean, p_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_old boolean;
begin
  select o.event_review_required into v_old from public.organisers o where o.id = p_organiser_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_old = p_required then
    return 'unchanged';
  end if;
  update public.organisers set event_review_required = p_required where id = p_organiser_id;
  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields, reason)
  values (p_organiser_id, 'profile_edit', p_admin_id,
          jsonb_build_object('event_review_required', jsonb_build_object(
            'old', case when v_old then 'on' else 'off' end,
            'new', case when p_required then 'on' else 'off' end)),
          p_reason);
  return 'updated';
end;
$$;

-- ---------------------------------------------------------------------------
-- The outbox's new kind
-- ---------------------------------------------------------------------------

-- From 20261109000200_payment_reconciliation.sql (kind_check) and
-- 20261109000400_checkout_attempts.sql (kind_key), plus `event_published`,
-- keyed on event_id like `event_review`.
alter table private.email_outbox
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (
    kind in ('ticket_email', 'waitlist_available', 'organiser_new_events', 'event_review', 'organiser_review',
             'ops_alert', 'event_published')),
  drop constraint email_outbox_kind_key,
  -- Each kind has exactly its own key.
  add constraint email_outbox_kind_key check (
    case kind
      when 'ticket_email' then order_id is not null and waitlist_entry_id is null and follow_id is null
                               and event_id is null and organiser_id is null
                               and payment_exception_id is null and ops_event_id is null
      when 'waitlist_available' then waitlist_entry_id is not null and order_id is null and follow_id is null
                                     and event_id is null and organiser_id is null
                                     and payment_exception_id is null and ops_event_id is null
      when 'organiser_new_events' then follow_id is not null and order_id is null and waitlist_entry_id is null
                                       and event_id is null and organiser_id is null
                                       and payment_exception_id is null and ops_event_id is null
      when 'event_review' then event_id is not null and order_id is null and waitlist_entry_id is null
                               and follow_id is null and organiser_id is null
                               and payment_exception_id is null and ops_event_id is null
      when 'event_published' then event_id is not null and order_id is null and waitlist_entry_id is null
                                  and follow_id is null and organiser_id is null
                                  and payment_exception_id is null and ops_event_id is null
      when 'organiser_review' then organiser_id is not null and order_id is null and waitlist_entry_id is null
                                   and follow_id is null and event_id is null
                                   and payment_exception_id is null and ops_event_id is null
      else (payment_exception_id is not null) <> (ops_event_id is not null)
           and order_id is null and waitlist_entry_id is null and follow_id is null
           and event_id is null and organiser_id is null end);

-- As in 20261109000200_payment_reconciliation.sql, but without p_kind it also
-- leaves `event_published` jobs alone (as ops alerts): a previous app version
-- leasing every kind would fail one as an unknown job. This release's drain
-- asks for them by kind (lib/server/email-outbox.ts).
create or replace function private.lease_outbox_jobs(
  p_limit integer, p_lease interval, p_max_attempts integer, p_order_id text default null, p_kind text default null
) returns table (
  job_id bigint, job_kind text, job_order_id text, job_waitlist_entry_id uuid, job_follow_id uuid,
  job_event_id uuid, job_organiser_id uuid, job_lease_token uuid, job_attempts integer)
language plpgsql
set search_path = ''
as $$
begin
  update private.email_outbox o
     set status = 'failed', lease_token = null, lease_expires_at = null,
         last_error = coalesce(o.last_error, 'the last attempt never finished')
   where o.status = 'sending' and o.lease_expires_at <= now() and o.attempts >= p_max_attempts
     and (p_order_id is null or o.order_id = p_order_id)
     and (case when p_kind is null then o.kind not in ('ops_alert', 'event_published') else o.kind = p_kind end);

  return query
  with picked as (
    select o.id from private.email_outbox o
     where ((o.status = 'pending' and o.next_attempt_at <= now())
         or (o.status = 'sending' and o.lease_expires_at <= now()))
       and (p_order_id is null or o.order_id = p_order_id)
       and (case when p_kind is null then o.kind not in ('ops_alert', 'event_published') else o.kind = p_kind end)
     order by o.next_attempt_at, o.id
     limit p_limit
     for update skip locked
  )
  update private.email_outbox o
     set status = 'sending', lease_token = gen_random_uuid(), lease_expires_at = now() + p_lease,
         attempts = o.attempts + 1
    from picked
   where o.id = picked.id
  returning o.id, o.kind, o.order_id, o.waitlist_entry_id, o.follow_id, o.event_id, o.organiser_id,
            o.lease_token, o.attempts;
end;
$$;

-- As in 20261107000000_admin_review_emails.sql, plus p_kind 'event_published':
-- the admins' "an organiser published an event" email, queued only while the
-- event is published and its organiser has an owner. The same rules: one
-- waiting per event (whatever its kind: they share the event's active-job
-- index), an hour after the last one about it was sent, 10 a day per account
-- and 100 a day platform-wide, in buckets of their own (`published_emails`,
-- `admin_published_emails_daily`): an organiser publishing 10 events can't
-- use up the review emails an 11th, sent to review by the cap, needs.
create or replace function private.queue_review_email(p_kind text, p_subject_id uuid) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_last_sent timestamptz;
  v_owner uuid;
begin
  if p_kind = 'event_review' then
    select o.owner_user_id into v_owner from public.events e join public.organisers o on o.id = e.organiser_id
     where e.id = p_subject_id and e.status = 'pending_review';
  elsif p_kind = 'event_published' then
    select o.owner_user_id into v_owner from public.events e join public.organisers o on o.id = e.organiser_id
     where e.id = p_subject_id and e.status = 'published';
  elsif p_kind = 'organiser_review' then
    select o.owner_user_id into v_owner from public.organisers o
     where o.id = p_subject_id and o.status = 'pending';
  else
    raise exception 'unknown review email kind: %', p_kind;
  end if;
  if v_owner is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('review_email:' || p_kind || ':' || p_subject_id::text, 0));

  if p_kind in ('event_review', 'event_published') then
    perform 1 from private.email_outbox j where j.event_id = p_subject_id and j.status in ('pending', 'sending');
    if found then
      return false;
    end if;
    select max(j.sent_at) into v_last_sent from private.email_outbox j
     where j.event_id = p_subject_id and j.status = 'sent';
  else
    perform 1 from private.email_outbox j where j.organiser_id = p_subject_id and j.status in ('pending', 'sending');
    if found then
      return false;
    end if;
    select max(j.sent_at) into v_last_sent from private.email_outbox j
     where j.organiser_id = p_subject_id and j.status = 'sent';
  end if;

  -- The account's own limit first: a refusal there takes no platform slot.
  -- The published emails have their own (as many as publishes can go live),
  -- so an organiser's publishes never use up their review emails.
  if not private.take_rate_limit(v_owner, case when p_kind = 'event_published' then 'published_emails' else 'review_emails' end,
                                 10, interval '24 hours') then
    return false;
  end if;
  if not private.take_platform_rate_limit(
           case when p_kind = 'event_published' then 'admin_published_emails_daily' else 'admin_review_emails_daily' end,
           100, interval '24 hours') then
    return false;
  end if;

  if p_kind in ('event_review', 'event_published') then
    insert into private.email_outbox (kind, event_id, next_attempt_at)
    values (p_kind, p_subject_id, greatest(now(), coalesce(v_last_sent + interval '1 hour', now())))
    on conflict (event_id) where status in ('pending', 'sending') do nothing;
  else
    insert into private.email_outbox (kind, organiser_id, next_attempt_at)
    values ('organiser_review', p_subject_id, greatest(now(), coalesce(v_last_sent + interval '1 hour', now())))
    on conflict (organiser_id) where status in ('pending', 'sending') do nothing;
  end if;
  return found;
end;
$$;

-- An event leaving `published` (an admin unpublished it, a takedown): its
-- "published" email, if still waiting, has nothing left to say. One a worker
-- is sending checks the status itself and sends nothing.
create function private.drop_published_email() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from private.email_outbox j where j.event_id = new.id and j.kind = 'event_published' and j.status = 'pending';
  return null;
end;
$$;

create trigger events_published_email_drop
  after update of status on public.events
  for each row
  when (old.status = 'published' and new.status is distinct from 'published')
  execute function private.drop_published_email();

-- ---------------------------------------------------------------------------
-- The organiser's publish
-- ---------------------------------------------------------------------------

-- p_organiser_id's event p_event_id, from draft or rejected: published,
-- logged 'approved' by p_actor_id (the organiser's owner), with the admins'
-- `event_published` email queued; or, when it needs a person (see the top of
-- this file), to pending_review, logged 'submitted' (the review email's
-- trigger queues that one). p_external_url: the ticket link the API judged
-- (null for Sheltüh ticketing); p_force_review: the API's own reason to send
-- it to review (a ticket link on an unknown site). Locks the organiser
-- (share), then the event. Returns:
--   'published'          live now
--   'submitted'          waiting for review
--   'already_published'  nothing to do (a repeat)
--   'in_review'          already waiting for review: nothing written
--   'not_found'          no such event, not p_organiser_id's, the organiser
--                        isn't approved or p_actor_id isn't its owner
--   'ended'              its end has passed: nothing written
--   'payouts_required'   Sheltüh-ticketed with a paid ticket type, and the
--                        organiser's payouts aren't enabled: nothing written
--   'stale'              its ticket link isn't p_external_url: nothing written
create function private.publish_event(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_external_url text, p_force_review boolean
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_org record;
  v_event record;
  v_last_decision public.moderation_action;
  v_review boolean;
begin
  select o.status::text as status, o.payouts_enabled, o.event_review_required, o.owner_user_id
    into v_org
    from public.organisers o where o.id = p_organiser_id for share;
  -- Re-checked under the lock: a takedown that committed after the API's own
  -- (unlocked) check must win.
  if not found or v_org.status <> 'approved' or v_org.owner_user_id is distinct from p_actor_id then
    return 'not_found';
  end if;
  select e.status, e.ends_at, e.ticketing_mode,
         case when e.ticketing_mode = 'external' then e.external_ticket_url end as external_url
    into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status = 'published' then
    return 'already_published';
  end if;
  if v_event.status = 'pending_review' then
    return 'in_review';
  end if;
  if v_event.ends_at <= now() then
    return 'ended';
  end if;
  if not v_org.payouts_enabled and v_event.ticketing_mode = 'sheltuh'
     and exists (select 1 from public.ticket_types t where t.event_id = p_event_id and t.price_cents > 0) then
    return 'payouts_required';
  end if;
  if v_event.external_url is distinct from p_external_url then
    return 'stale';
  end if;

  -- The latest admin decision about it (event_moderation_log_event_idx, newest first).
  select l.action into v_last_decision
    from public.event_moderation_log l
   where l.event_id = p_event_id and l.action in ('approved', 'rejected', 'unpublished')
   order by l.id desc
   limit 1;

  v_review := v_org.event_review_required
    or v_event.status = 'rejected'
    or (v_last_decision is not null and v_last_decision in ('rejected', 'unpublished'))
    or exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id)
    or coalesce(p_force_review, false);
  -- The caps last (a publish going to review anyway takes no slot), the
  -- account's first (a refusal there takes no platform slot).
  if not v_review then
    v_review := not private.take_rate_limit(p_actor_id, 'event_publishes', 10, interval '24 hours');
  end if;
  if not v_review then
    v_review := not private.take_platform_rate_limit('event_self_publishes_daily', 100, interval '24 hours');
  end if;

  if v_review then
    if not private.transition_event(p_event_id, array['draft', 'rejected']::public.event_status[], 'pending_review',
                                    'submitted', p_actor_id, null, p_organiser_id) then
      raise exception 'publish_event: the locked event could not be submitted';
    end if;
    return 'submitted';
  end if;

  if not private.transition_event(p_event_id, array['draft', 'rejected']::public.event_status[], 'published',
                                  'approved', p_actor_id, null, p_organiser_id) then
    raise exception 'publish_event: the locked event could not be published';
  end if;
  perform private.queue_review_email('event_published', p_event_id);
  return 'published';
end;
$$;

-- ---------------------------------------------------------------------------
-- Recent approvals
-- ---------------------------------------------------------------------------

create index event_moderation_log_approved_idx on public.event_moderation_log (created_at, event_id)
  where action = 'approved';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.set_event_review_required(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function private.lease_outbox_jobs(integer, interval, integer, text, text) from public, anon, authenticated;
revoke all on function private.queue_review_email(text, uuid) from public, anon, authenticated;
revoke all on function private.drop_published_email() from public, anon, authenticated;
revoke all on function private.publish_event(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
