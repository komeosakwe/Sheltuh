-- Event clips, step 4 (docs/design/event-clips.md, dependency B1): the size a
-- clip is shown at, so the viewer can pick a portrait or landscape dialog and
-- reserve the video's box before any bytes arrive.
--
--   * private.event_clips gains width and height: display pixels as
--     lib/server/mp4.ts reports them (tkhd's size, or the coded size when
--     tkhd has none, turned a quarter when tkhd's matrix rotates the
--     picture), each 1 to 4096 (MAX_CLIP_SIDE) and at most 2,100,000 pixels
--     together (MAX_CLIP_PIXELS), as the checker already refuses anything
--     else.
--   * private.put_event_clip takes them (p_width, p_height, after
--     p_duration_ms). The old eight-argument version is dropped: nothing
--     calls it yet (no handler did before this step), and keeping it would
--     let a clip be written without its size. Everything else about it is as
--     in 20261106000000_event_clips.sql: the same locks, rules, results and
--     log entries; a description-only change (or a replay of the same
--     object) keeps the stored size.
--
-- NOT NULL without a default: the table has no rows anywhere yet (nothing
-- wrote to it before this step, and the event_clips migration only shipped
-- with it). If one somehow does, this migration fails as a whole rather than
-- inventing a size; nothing is changed or lost.
--
-- Access model unchanged: the function pins its search_path and has execute
-- revoked from PUBLIC, anon and authenticated.
--
-- Additive (two columns, one function's signature). Reversible: drop
-- function private.put_event_clip(uuid, uuid, uuid, text, integer, integer,
-- integer, integer, text, text), recreate the eight-argument version from
-- 20261106000000_event_clips.sql (with its revoke), then drop the two
-- columns (destructive only for the clips' recorded sizes).

alter table private.event_clips
  add column width integer not null
    constraint event_clips_width_check check (width between 1 and 4096),
  add column height integer not null
    constraint event_clips_height_check check (height between 1 and 4096),
  add constraint event_clips_pixels_check check (width::bigint * height <= 2100000);

drop function private.put_event_clip(uuid, uuid, uuid, text, integer, integer, text, text);

-- p_object_path set: attach that clip (replacing any other; the same path
-- again is a replay, and only its description can change). p_object_path
-- null: change only the description of the event's clip (p_size_bytes,
-- p_duration_ms, p_width and p_height are ignored). p_reason is logged with
-- an admin's change. result:
--   'updated'       written (an admin's change logged); old_object_path is
--                   the replaced clip's object to delete after commit, if any
--   'unchanged'     nothing would change: nothing written
--   'no_clip'       a description change, but the event has no clip
--   'not_found'     no such event, or not the organiser's
--   'not_editable'  the organiser's event isn't a draft or rejected
create function private.put_event_clip(
  p_event_id uuid, p_actor_id uuid, p_organiser_id uuid, p_object_path text,
  p_size_bytes integer, p_duration_ms integer, p_width integer, p_height integer,
  p_description text, p_reason text
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
           (event_id, object_path, size_bytes, duration_ms, width, height, description, rights_confirmed_at, updated_at)
    values (p_event_id, p_object_path, p_size_bytes, p_duration_ms, p_width, p_height, p_description, now(),
            clock_timestamp())
    on conflict (event_id) do update
       set object_path = excluded.object_path,
           size_bytes = excluded.size_bytes,
           duration_ms = excluded.duration_ms,
           width = excluded.width,
           height = excluded.height,
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

revoke all on function private.put_event_clip(uuid, uuid, uuid, text, integer, integer, integer, integer, text, text)
  from public, anon, authenticated;
