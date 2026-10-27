-- An organiser's first paid event sold on Sheltüh goes to review (owner
-- decision, 27 Oct 2026, security review M2), and an admin's unpublish can
-- turn on review of the organiser's next events in the same step (security
-- review LOW 3). docs/architecture.md, "Publishing events".
--
--   * private.publish_event, redefined from its latest definition
--     (20261111000100_event_venue_location.sql) with everything else
--     unchanged (same signature and return type, search_path pinned, execute
--     revoked again):
--       - a new review rule, checked after the others and before the caps:
--         the event is paid on Sheltüh (ticketing_mode 'sheltuh' and a ticket
--         type priced above 0) and the organiser has no event that is paid on
--         Sheltüh whose latest admin decision (approved / rejected /
--         unpublished entry) is an `approved` logged by someone other than
--         the organiser's owner, i.e. "has had a paid Sheltüh event approved
--         by Sheltüh before, and not since taken down". Free and external
--         events are never held by it.
--       - a refusal-free publish that goes to review now says why:
--         'submitted:<reason>' instead of 'submitted', the reason the first
--         rule (in this order) that sent it: review_required (the organiser's
--         switch), removed_before (rejected now, or an admin's latest
--         decision rejected / unpublished), seated, unknown_ticket_site
--         (p_force_review), first_paid_event, daily_limit (either cap). The
--         API passes it on as the publish response's `reviewReason`.
--   * private.admin_unpublish_event (new): an admin's unpublish (published →
--     draft, logged `unpublished` with the optional reason, as
--     transition_event always did), and with p_review_future, review of the
--     organiser's events turned on through private.set_event_review_required
--     (logged on the organiser's log as the admin's `profile_edit`), in one
--     transaction. Locks the organiser (for update) before the event, the
--     order publish_event, submit_event and suspend_organiser use. Returns
--     'unpublished', 'not_published' or 'not_found'.
--
-- No new table, column or index. The first-paid rule reads the organiser's
-- events through events_organiser_created_idx, their ticket types through
-- ticket_types' primary key (event_id, id), and each one's latest decision
-- through event_moderation_log_event_idx (event_id, id); an organiser has
-- few events, and this runs once per publish.
--
-- Access model as everywhere else: RLS unchanged; both functions pin their
-- search_path, aren't security definer, and have execute revoked from PUBLIC,
-- anon and authenticated.
--
-- Deploy: apply it with 20261111000000 and 20261111000100, immediately
-- before this app deploys (docs/DEPLOYMENT.md). The app from before it reads
-- publish_event's result as 'submitted' exactly; that app was never deployed
-- (no organiser publish in production yet), and the live app never calls
-- publish_event or admin_unpublish_event.
-- Reversible: restore publish_event from 20261111000100_event_venue_location.sql
-- and drop private.admin_unpublish_event (the app needs its previous version
-- first). Nothing is written by the migration itself.

-- ---------------------------------------------------------------------------
-- The organiser's publish
-- ---------------------------------------------------------------------------

-- As in 20261111000100_event_venue_location.sql, plus the first-paid rule and
-- 'submitted:<reason>' (above).
create or replace function private.publish_event(
  p_event_id uuid, p_organiser_id uuid, p_actor_id uuid, p_external_url text, p_force_review boolean
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_org record;
  v_event record;
  v_last_decision public.moderation_action;
  v_reason text;
begin
  select o.status::text as status, o.payouts_enabled, o.event_review_required, o.owner_user_id
    into v_org
    from public.organisers o where o.id = p_organiser_id for share;
  -- Re-checked under the lock: a takedown that committed after the API's own
  -- (unlocked) check must win.
  if not found or v_org.status <> 'approved' or v_org.owner_user_id is distinct from p_actor_id then
    return 'not_found';
  end if;
  select e.status, e.ends_at, e.ticketing_mode, e.venue_lat,
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
  if v_event.venue_lat is null then
    return 'location_required';
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

  -- The first rule that applies, in this order (the reason the API returns).
  if v_org.event_review_required then
    v_reason := 'review_required';
  elsif v_event.status = 'rejected'
     or (v_last_decision is not null and v_last_decision in ('rejected', 'unpublished')) then
    v_reason := 'removed_before';
  elsif exists (select 1 from public.event_seat_maps m where m.event_id = p_event_id) then
    v_reason := 'seated';
  elsif coalesce(p_force_review, false) then
    v_reason := 'unknown_ticket_site';
  -- Paid on Sheltüh, and the organiser has no paid Sheltüh event that Sheltüh
  -- approved (an `approved` by anyone but the owner) and hasn't taken down since.
  elsif v_event.ticketing_mode = 'sheltuh'
     and exists (select 1 from public.ticket_types t where t.event_id = p_event_id and t.price_cents > 0)
     and not exists (
       select 1
         from public.events e2
         cross join lateral (
           select l.action, l.actor_id
             from public.event_moderation_log l
            where l.event_id = e2.id and l.action in ('approved', 'rejected', 'unpublished')
            order by l.id desc
            limit 1
         ) d
        where e2.organiser_id = p_organiser_id
          and e2.ticketing_mode = 'sheltuh'
          and exists (select 1 from public.ticket_types t2 where t2.event_id = e2.id and t2.price_cents > 0)
          and d.action = 'approved'
          and d.actor_id is distinct from v_org.owner_user_id) then
    v_reason := 'first_paid_event';
  -- The caps last (a publish going to review anyway takes no slot), the
  -- account's first (a refusal there takes no platform slot).
  elsif not private.take_rate_limit(p_actor_id, 'event_publishes', 10, interval '24 hours') then
    v_reason := 'daily_limit';
  elsif not private.take_platform_rate_limit('event_self_publishes_daily', 100, interval '24 hours') then
    v_reason := 'daily_limit';
  end if;

  if v_reason is not null then
    if not private.transition_event(p_event_id, array['draft', 'rejected']::public.event_status[], 'pending_review',
                                    'submitted', p_actor_id, null, p_organiser_id) then
      raise exception 'publish_event: the locked event could not be submitted';
    end if;
    return 'submitted:' || v_reason;
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
-- An admin's unpublish, optionally with review of the organiser's next events
-- ---------------------------------------------------------------------------

-- Published → draft (logged `unpublished` by p_admin_id with p_reason, which
-- becomes the event's rejection_reason), and with p_review_future, review of
-- its organiser's events turned on (private.set_event_review_required, logged
-- with p_review_reason; already on: nothing more logged). One transaction:
-- either both happen or neither. Returns 'unpublished', 'not_published' (it
-- isn't published: nothing written) or 'not_found'.
create function private.admin_unpublish_event(
  p_event_id uuid, p_admin_id uuid, p_reason text, p_review_future boolean, p_review_reason text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_organiser_id uuid;
begin
  -- An event never changes organiser, so this unlocked read is safe.
  select e.organiser_id into v_organiser_id from public.events e where e.id = p_event_id;
  if not found then
    return 'not_found';
  end if;
  if p_review_future then
    -- The organiser before the event, as everywhere else (set_event_review_required
    -- takes the same lock again below).
    perform 1 from public.organisers o where o.id = v_organiser_id for update;
  end if;
  if not private.transition_event(p_event_id, array['published']::public.event_status[], 'draft',
                                  'unpublished', p_admin_id, p_reason) then
    return 'not_published';
  end if;
  if p_review_future then
    perform private.set_event_review_required(v_organiser_id, p_admin_id, true, p_review_reason);
  end if;
  return 'unpublished';
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.publish_event(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function private.admin_unpublish_event(uuid, uuid, text, boolean, text) from public, anon, authenticated;
