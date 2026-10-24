-- Event clips, step 1 (owner decisions, 24 Oct 2026): an optional short video
-- per event, shown when someone taps the play button on the event's image.
--
--   * MP4 with H.264 video only: at most 15 s (15.5 s allowed for encoder
--     rounding), at most 10 MB, and no audio track at all (so there's no
--     has_audio column: a clip never has sound). The API checks the file
--     with lib/server/mp4.ts and neutralises its metadata (location, device)
--     before it writes the final object itself.
--   * The bytes live in Supabase Storage, in the private bucket `event-clips`
--     created below, never in the database. There are no storage.objects
--     policies: clients can't list, read or write the bucket directly. Only
--     the server (a dedicated Supabase secret key, read only by
--     lib/server/clip-storage.ts, a later step) uploads and signs URLs.
--   * private.event_clips: the clip attached to an event (its object path,
--     size, duration, text description and when its rights were confirmed).
--     Deleted with the event (the object is left for the cleanup sweep).
--   * Trigger event_clips_touch_event: every write to a clip bumps
--     events.updated_at in the same transaction, as event_images_touch_event
--     does for photos (20261023000100_review_hardening.sql), so an admin's
--     save from an older version of the event is stale (409).
--   * private.put_event_clip / private.delete_event_clip: the same rules as
--     an event photo:
--       - an organiser (p_organiser_id set): only their own event (anything
--         else is 'not_found'), and only while it's a draft or rejected
--         ('not_editable' otherwise), checked with the event row locked, so
--         a slow upload can't land on an event that was submitted or approved
--         meanwhile. Not logged, like an organiser's photo change.
--       - an admin (p_organiser_id null): any event, whatever its status,
--         logged 'edited' in event_moderation_log with p_reason:
--         {"clip": {old, new}} (the clip's version: milliseconds since the
--         epoch of its updated_at, as text, the `v` of its URL; null for none)
--         and {"clipDescription": {old, new}} when the description changes.
--         The actor must be an admin in auth.users (app_metadata.role, as the
--         API reads it); anything else raises, whatever the API passed.
--     Both return the object path the API must delete from Storage after the
--     transaction commits (the replaced or removed clip), or null.
--
-- Versions: each write sets updated_at to clock_timestamp(), and to at least
-- a millisecond after the clip it replaces (as put_organiser_logo), so every
-- change gives the clip a new URL.
--
-- Locks: the event row first (for no key update), then the clip row, the
-- order every event image writer uses (20261023000100_review_hardening.sql).
-- The trigger's update of the event then needs no lock it doesn't already
-- hold. The organiser row isn't locked (it's only read, to check the caller
-- owns it), so this can't deadlock with admin_edit_event or
-- suspend_organiser (organiser, then event).
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated; every new function pins its search_path and has execute
-- revoked from PUBLIC, anon and authenticated.
--
-- Indexes: none beyond the constraints'. Every read is by the primary key
-- (event_id): the event reads and the clip routes. The unique object_path
-- constraint's index serves the cleanup sweep's "is this object still
-- referenced" lookup.
--
-- Additive: no existing table, column, function or row changes (the bucket
-- row is new; if a bucket named event-clips already exists, it's made
-- private with these limits). Reversible while the bucket is empty: drop
-- functions private.put_event_clip and private.delete_event_clip, trigger
-- event_clips_touch_event on private.event_clips and function
-- private.event_clips_touch_event(), then table private.event_clips
-- (destructive: every clip's details), and delete the bucket through the
-- Storage API once it's empty. Log entries naming `clip` can stay (the API
-- drops change fields it doesn't know: LOG_CHANGE_FIELDS in
-- lib/server/records.ts).

create table private.event_clips (
  event_id uuid primary key references public.events (id) on delete cascade,
  -- Written by the server only: clips/{event id}/{upload id}.mp4.
  object_path text not null unique
    constraint event_clips_object_path_check
    check (object_path ~ ('^clips/' || event_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$')),
  -- The bucket's file_size_limit (10 MB).
  size_bytes integer not null constraint event_clips_size_bytes_check check (size_bytes between 1 and 10485760),
  -- 15 s, plus half a second for encoder rounding.
  duration_ms integer not null constraint event_clips_duration_ms_check check (duration_ms between 1 and 15500),
  -- The clip's text alternative, shown with it.
  description text not null
    constraint event_clips_description_check
    check (char_length(description) between 1 and 300 and description = btrim(description)),
  -- When whoever attached it (or last changed it) confirmed they own or may
  -- use the clip, its contents and everyone in it.
  rights_confirmed_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table private.event_clips enable row level security;
revoke all on private.event_clips from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Clip writes bump the event's version
-- ---------------------------------------------------------------------------

create function private.event_clips_touch_event() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- events_set_updated_at sets the time. When the event itself is being
  -- deleted (the clip goes with it, on delete cascade), its row is already
  -- gone and this updates nothing.
  update public.events set updated_at = now()
   where id = case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  return null;
end;
$$;

create trigger event_clips_touch_event after insert or update or delete on private.event_clips
  for each row execute function private.event_clips_touch_event();

-- ---------------------------------------------------------------------------
-- Attach, replace or re-describe a clip
-- ---------------------------------------------------------------------------

-- Locks p_event_id's row and checks who may act (see the header). Returns
-- the event's status, or null with p_refusal set ('not_found' or
-- 'not_editable'). Raises if p_organiser_id is null and p_actor_id isn't an
-- admin.
create function private.lock_event_for_clip(p_event_id uuid, p_actor_id uuid, p_organiser_id uuid, out p_refusal text)
language plpgsql
set search_path = ''
as $$
declare
  v_status public.event_status;
begin
  p_refusal := null;
  if p_organiser_id is null then
    if not exists (
      select 1 from auth.users u where u.id = p_actor_id and u.raw_app_meta_data ->> 'role' = 'admin'
    ) then
      raise exception 'Only an admin can change a clip without an organiser.'
        using errcode = 'insufficient_privilege';
    end if;
    select e.status into v_status from public.events e where e.id = p_event_id for no key update;
    if not found then
      p_refusal := 'not_found';
    end if;
    return;
  end if;

  -- The caller's own event only: the organiser is read (not locked) to check
  -- the actor owns it.
  select e.status into v_status
    from public.events e join public.organisers o on o.id = e.organiser_id
   where e.id = p_event_id and e.organiser_id = p_organiser_id and o.owner_user_id = p_actor_id
     for no key update of e;
  if not found then
    p_refusal := 'not_found';
  elsif v_status not in ('draft', 'rejected') then
    p_refusal := 'not_editable';
  end if;
end;
$$;

-- p_object_path set: attach that clip (replacing any other; the same path
-- again is a replay, and only its description can change). p_object_path
-- null: change only the description of the event's clip (p_size_bytes and
-- p_duration_ms are ignored). p_reason is logged with an admin's change.
-- result:
--   'updated'       written (an admin's change logged); old_object_path is
--                   the replaced clip's object to delete after commit, if any
--   'unchanged'     nothing would change: nothing written
--   'no_clip'       a description change, but the event has no clip
--   'not_found'     no such event, or not the organiser's
--   'not_editable'  the organiser's event isn't a draft or rejected
create function private.put_event_clip(
  p_event_id uuid, p_actor_id uuid, p_organiser_id uuid, p_object_path text,
  p_size_bytes integer, p_duration_ms integer, p_description text, p_reason text
) returns table (result text, old_object_path text)
language plpgsql
set search_path = ''
as $$
declare
  v_refusal text;
  v_old private.event_clips;
  v_new private.event_clips;
  v_details jsonb := '{}'::jsonb;
begin
  v_refusal := private.lock_event_for_clip(p_event_id, p_actor_id, p_organiser_id);
  if v_refusal is not null then
    return query select v_refusal, null::text;
    return;
  end if;

  select c.* into v_old from private.event_clips c where c.event_id = p_event_id for update;

  if p_object_path is null or p_object_path = v_old.object_path then
    if v_old.event_id is null then
      return query select 'no_clip'::text, null::text;
      return;
    end if;
    if v_old.description = p_description then
      return query select 'unchanged'::text, null::text;
      return;
    end if;
    update private.event_clips c
       set description = p_description,
           rights_confirmed_at = now(),
           updated_at = greatest(clock_timestamp(), c.updated_at + interval '1 millisecond')
     where c.event_id = p_event_id
    returning c.* into v_new;
  else
    insert into private.event_clips as c
           (event_id, object_path, size_bytes, duration_ms, description, rights_confirmed_at, updated_at)
    values (p_event_id, p_object_path, p_size_bytes, p_duration_ms, p_description, now(), clock_timestamp())
    on conflict (event_id) do update
       set object_path = excluded.object_path,
           size_bytes = excluded.size_bytes,
           duration_ms = excluded.duration_ms,
           description = excluded.description,
           rights_confirmed_at = excluded.rights_confirmed_at,
           updated_at = greatest(excluded.updated_at, c.updated_at + interval '1 millisecond')
    returning c.* into v_new;
  end if;

  if p_organiser_id is null then
    if v_new.object_path is distinct from v_old.object_path then
      v_details := v_details || jsonb_build_object('clip', jsonb_build_object(
        'old', floor(extract(epoch from v_old.updated_at) * 1000)::bigint::text,
        'new', floor(extract(epoch from v_new.updated_at) * 1000)::bigint::text));
    end if;
    if v_new.description is distinct from v_old.description then
      v_details := v_details || jsonb_build_object('clipDescription', jsonb_build_object(
        'old', v_old.description, 'new', v_new.description));
    end if;
    insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
    values (p_event_id, 'edited', p_actor_id, p_reason, v_details);
  end if;

  return query select 'updated'::text,
    case when v_old.object_path is distinct from v_new.object_path then v_old.object_path end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Remove a clip
-- ---------------------------------------------------------------------------

-- Same rules as put_event_clip. result:
--   'deleted'       removed (an admin's removal logged); old_object_path is
--                   the object to delete after commit
--   'unchanged'     the event has no clip: nothing written
--   'not_found'     no such event, or not the organiser's
--   'not_editable'  the organiser's event isn't a draft or rejected
create function private.delete_event_clip(
  p_event_id uuid, p_actor_id uuid, p_organiser_id uuid, p_reason text
) returns table (result text, old_object_path text)
language plpgsql
set search_path = ''
as $$
declare
  v_refusal text;
  v_old private.event_clips;
begin
  v_refusal := private.lock_event_for_clip(p_event_id, p_actor_id, p_organiser_id);
  if v_refusal is not null then
    return query select v_refusal, null::text;
    return;
  end if;

  delete from private.event_clips c where c.event_id = p_event_id returning c.* into v_old;
  if not found then
    return query select 'unchanged'::text, null::text;
    return;
  end if;

  if p_organiser_id is null then
    insert into public.event_moderation_log (event_id, action, actor_id, reason, details)
    values (p_event_id, 'edited', p_actor_id, p_reason,
            jsonb_build_object('clip', jsonb_build_object(
              'old', floor(extract(epoch from v_old.updated_at) * 1000)::bigint::text, 'new', null)));
  end if;

  return query select 'deleted'::text, v_old.object_path;
end;
$$;

revoke all on function private.event_clips_touch_event() from public, anon, authenticated;
revoke all on function private.lock_event_for_clip(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.put_event_clip(uuid, uuid, uuid, text, integer, integer, text, text)
  from public, anon, authenticated;
revoke all on function private.delete_event_clip(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The Storage bucket
-- ---------------------------------------------------------------------------

-- Private (objects are served only through short-lived signed URLs the API
-- mints), at most 10 MB per object, MP4 or QuickTime as uploaded (the API
-- checks the bytes, never the declared type, and always writes the final
-- object as video/mp4). No storage.objects policies: clients get no access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-clips', 'event-clips', false, 10485760, array['video/mp4', 'video/quicktime'])
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;
