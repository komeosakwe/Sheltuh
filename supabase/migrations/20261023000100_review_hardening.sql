-- Review hardening (security and code review of B2/B3; docs/architecture.md,
-- "Admin authoring", "External ticketing" and "Check-in"):
--
-- 1. A photo change is a change to the event. Every write to
--    public.event_images (insert, update, delete: the organiser's
--    PUT/DELETE /events/{id}/image, private.admin_put_event_image and
--    private.admin_delete_event_image) now bumps events.updated_at in the
--    same transaction (AFTER trigger event_images_touch_event). An admin's
--    PATCH /admin/events/{id} carries the updatedAt it loaded
--    (expectedUpdatedAt), so a photo the organiser swapped after the admin
--    opened the editor makes the save (and its publish) stale, a 409, instead
--    of publishing a photo the admin never saw. The image responses already
--    return the event record, so the editor takes its next version from them.
--
--    Lock order: every image writer locks the event row first (for no key
--    update), then the image row; the trigger's update of the event then
--    needs no lock it doesn't already hold. The admin functions below are
--    redefined to take that lock (they took `for key share`, which let an
--    admin's and an organiser's upload deadlock once the trigger updates
--    the event); the organiser's handler does the same
--    (lib/server/handlers/event-images.ts).
--
-- 2. The ticket link's rules apply when a link is written, not on every
--    later update of the row. The events_external_ticket_url_valid CHECK
--    constraint was evaluated on every update of an external event, so
--    adding a shortener to private.external_ticket_url_ok later would have
--    made every update of an event holding such a link fail, unpublishing
--    and suspending included. It's replaced by a BEFORE INSERT OR UPDATE OF
--    external_ticket_url trigger of the same name, which checks a link only
--    when it's inserted or changed (same errcode 23514 and constraint name,
--    so the API's error mapping is unchanged). The mode/link consistency
--    constraints (events_ticketing_fields, events_external_is_free) stay.
--    Existing links are revalidated first: if any fails, this migration
--    raises with the offending event ids and nothing is applied (replace
--    each link with PATCH /admin/events/{id}/ticketing, or unpublish, then
--    re-run).
--
-- 3. Admin check-in for platform-managed organisers' events (owner decision,
--    21 Oct 2026, docs/FEATURE_PLAN.md). ticket_check_ins_guard now allows a
--    check-in row (scan or undo) for a platform-managed organiser's event
--    when its actor is an admin (auth.users.raw_app_meta_data ->> 'role' =
--    'admin', the app_metadata.role the API reads), and refuses one by an
--    admin who isn't the owner for an organiser-owned event. Both are
--    constraint ticket_check_ins_actor_allowed (it replaces
--    ticket_check_ins_owned_organiser_only). External events are still
--    refused (ticket_check_ins_sheltuh_only). check_in_ticket and
--    undo_check_in are unchanged: the API passes the event's (platform)
--    organiser as p_organiser_id and the admin as p_actor_id, so the
--    ownership check, locks, idempotency, per-account rate limit and the
--    log's actor (the admin) all work as for an organiser.
--
-- Access model as everywhere else: no new table; every new or redefined
-- function pins its search_path and has execute revoked from PUBLIC, anon
-- and authenticated. No new index: the trigger's update is by primary key,
-- and the guard's reads are by primary key (events, organisers, auth.users).
--
-- Not destructive. Reversible: drop trigger event_images_touch_event on
-- public.event_images and function private.event_images_touch_event();
-- recreate admin_put_event_image / admin_delete_event_image and
-- ticket_check_ins_guard from 20261022000100_admin_event_authoring.sql;
-- drop trigger events_external_ticket_url_valid on public.events and
-- function private.events_external_ticket_url_valid(), and re-add the check
-- constraint from 20261022000000_external_ticketing.sql (which revalidates
-- every row). Reverting the guard after admins have checked people in
-- leaves their log rows in place (no data is lost or changed).

-- ---------------------------------------------------------------------------
-- First, before anything changes: every stored ticket link must pass the
-- current rules (part 2 below stops re-checking links that aren't written).
-- ---------------------------------------------------------------------------

do $$
declare
  v_ids text;
begin
  select string_agg(e.id::text, ', ' order by e.id) into v_ids
    from public.events e
   where e.external_ticket_url is not null and not private.external_ticket_url_ok(e.external_ticket_url);
  if v_ids is not null then
    raise exception 'These events have a ticket link that is no longer accepted: %. Replace each link (PATCH /admin/events/{id}/ticketing) or unpublish the event, then run this migration again.', v_ids
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Image writes bump the event's version
-- ---------------------------------------------------------------------------

create function private.event_images_touch_event() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- events_set_updated_at sets the time. When the event itself is being
  -- deleted (the image goes with it, on delete cascade), its row is already
  -- gone and this updates nothing.
  update public.events set updated_at = now()
   where id = case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  return null;
end;
$$;

create trigger event_images_touch_event after insert or update or delete on public.event_images
  for each row execute function private.event_images_touch_event();

revoke all on function private.event_images_touch_event() from public, anon, authenticated;

-- As in 20261022000100_admin_event_authoring.sql, but the event row is locked
-- for no key update (not key share) before the image is written: the order
-- every image writer uses (see the header).
create or replace function private.admin_put_event_image(
  p_event_id uuid, p_admin_id uuid, p_content_type text, p_data bytea
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_had boolean;
begin
  perform 1 from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  select exists (select 1 from public.event_images i where i.event_id = p_event_id) into v_had;

  insert into public.event_images (event_id, content_type, data)
  values (p_event_id, p_content_type, p_data)
  on conflict (event_id) do update set content_type = excluded.content_type, data = excluded.data, updated_at = now();

  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_admin_id,
          jsonb_build_object('image', jsonb_build_object('old', case when v_had then 'set' end, 'new', 'set')));
  return 'updated';
end;
$$;

create or replace function private.admin_delete_event_image(p_event_id uuid, p_admin_id uuid) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  delete from public.event_images i where i.event_id = p_event_id;
  if not found then
    return 'unchanged';
  end if;
  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_admin_id, jsonb_build_object('image', jsonb_build_object('old', 'set', 'new', null)));
  return 'deleted';
end;
$$;

revoke all on function private.admin_put_event_image(uuid, uuid, text, bytea) from public, anon, authenticated;
revoke all on function private.admin_delete_event_image(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The ticket link is checked when it's written
-- ---------------------------------------------------------------------------

create function private.events_external_ticket_url_valid() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only a new or changed link: an update that leaves the link alone (an
  -- unpublish, a takedown, an edit sending it back unchanged) never
  -- re-checks it against rules tightened since it was approved.
  if new.external_ticket_url is not null
     and (tg_op = 'INSERT' or new.external_ticket_url is distinct from old.external_ticket_url)
     and not private.external_ticket_url_ok(new.external_ticket_url) then
    raise exception 'That ticket link isn''t accepted.'
      using errcode = 'check_violation', constraint = 'events_external_ticket_url_valid';
  end if;
  return new;
end;
$$;

create trigger events_external_ticket_url_valid before insert or update of external_ticket_url on public.events
  for each row execute function private.events_external_ticket_url_valid();

revoke all on function private.events_external_ticket_url_valid() from public, anon, authenticated;

alter table public.events drop constraint events_external_ticket_url_valid;

-- ---------------------------------------------------------------------------
-- 3. Admins check in for platform-managed organisers' events only
-- ---------------------------------------------------------------------------

-- As in 20261022000100_admin_event_authoring.sql, except who may act:
--   * a platform-managed organiser's event (no owner): an admin only;
--   * an organiser's own event: anyone but an admin who isn't its owner
--     (the functions check the caller's organiser owns the event; this keeps
--     an admin out even if the API passed the event's organiser by mistake).
-- External events are still refused for everyone.
create or replace function private.ticket_check_ins_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_event record;
  v_admin boolean;
begin
  select o.owner_user_id, e.ticketing_mode into v_event
    from public.events e join public.organisers o on o.id = e.organiser_id
   where e.id = new.event_id;
  -- app_metadata.role, as the API reads it from Supabase Auth.
  select exists (
    select 1 from auth.users u where u.id = new.actor_user_id and u.raw_app_meta_data ->> 'role' = 'admin'
  ) into v_admin;
  if (v_event.owner_user_id is null and not v_admin)
     or (v_event.owner_user_id is not null and v_admin and new.actor_user_id is distinct from v_event.owner_user_id) then
    raise exception 'Only an admin can check in for a platform-managed organiser''s event, and an admin can''t check in for an organiser''s.'
      using errcode = 'check_violation', constraint = 'ticket_check_ins_actor_allowed';
  end if;
  if v_event.ticketing_mode = 'external' then
    raise exception 'Tickets for this event are sold on another site: there''s no check-in.'
      using errcode = 'check_violation', constraint = 'ticket_check_ins_sheltuh_only';
  end if;
  return new;
end;
$$;

revoke all on function private.ticket_check_ins_guard() from public, anon, authenticated;
