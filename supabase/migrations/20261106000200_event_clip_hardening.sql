-- Event clips, review fixes (lib/server/handlers/event-clips.ts):
--
--   * private.event_clip_uploads: every upload id the API issues (POST
--     …/clip/uploads), with its event, the account it was issued to, when,
--     and when it was used. Attaching (PUT …/clip with an uploadId) first
--     claims the id in one statement:
--       update … set consumed_at = now()
--        where id = … and event_id = … and user_id = … and consumed_at is null
--          and created_at > now() - interval '1 day'
--       returning …
--     before anything is downloaded, so an upload is checked and attached at
--     most once: a second (or concurrent duplicate) claim matches no row and
--     the API answers 410. Postgres' row lock makes the claim exclusive: a
--     second claimer waits for the first to commit, then re-checks
--     consumed_at and matches nothing. The API gives the claim back
--     (consumed_at = null) only when Storage failed before anything was
--     recorded (a 503), so the person can retry. Rows older than a day are
--     deleted by the clip sweep (sweepEventClips, run after the trending
--     cron), the same age at which the staged object itself is swept.
--     Deleted with the event or the account (on delete cascade).
--   * private.put_event_clip: the same signature, locks, rules, results and
--     log entries as in 20261106000100_event_clip_dimensions.sql, except
--     that a description-only change, or a replay of the attached object,
--     no longer sets rights_confirmed_at: it records when the clip itself
--     was attached (whoever attached it confirmed the rights to it then),
--     and only a new object moves it.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated (revoke all, as Supabase grants new tables to both by
-- default); the function pins its search_path and has execute revoked from
-- PUBLIC, anon and authenticated (create or replace keeps the existing
-- revokes; they're repeated here so this file says so on its own).
--
-- Indexes: the primary key serves the claim (by id; event and account are
-- checked on that one row). event_clip_uploads_created_at_idx serves the
-- sweep's delete by age. No index on event_id or user_id for the foreign
-- keys' cascades: the table only holds a day or two of rows (at most 20 a
-- day per account, take_rate_limit 'event_clip_uploads'), and events and
-- accounts are rarely deleted.
--
-- Additive: one new table (empty), one function body replaced in place
-- (create or replace: same signature, so its grants stay). Upload ids issued
-- before this migration have no row, so attaching one is a 410 ("The upload
-- expired. Choose the clip again."). Reversible: recreate put_event_clip
-- from 20261106000100_event_clip_dimensions.sql (create or replace, with its
-- revoke), then drop table private.event_clip_uploads (destructive only for
-- the issued-upload records, which are worth nothing after a day).

create table private.event_clip_uploads (
  -- crypto.randomUUID() in the API: the {upload} of uploads/{event}/{account}/{upload}.mp4.
  id uuid primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Set once the API has claimed the id for an attach; null until then.
  consumed_at timestamptz
);

create index event_clip_uploads_created_at_idx on private.event_clip_uploads (created_at);

alter table private.event_clip_uploads enable row level security;
revoke all on private.event_clip_uploads from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- put_event_clip: re-describing a clip doesn't re-date its rights
-- ---------------------------------------------------------------------------

-- p_object_path set: attach that clip (replacing any other; the same path
-- again is a replay, and only its description can change). p_object_path
-- null: change only the description of the event's clip (p_size_bytes,
-- p_duration_ms, p_width and p_height are ignored). rights_confirmed_at is
-- set only when a new object is attached. p_reason is logged with an
-- admin's change. result:
--   'updated'       written (an admin's change logged); old_object_path is
--                   the replaced clip's object to delete after commit, if any
--   'unchanged'     nothing would change: nothing written
--   'no_clip'       a description change, but the event has no clip
--   'not_found'     no such event, or not the organiser's
--   'not_editable'  the organiser's event isn't a draft or rejected
create or replace function private.put_event_clip(
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
    -- The description only: rights_confirmed_at stays the attach's.
    update private.event_clips c
       set description = p_description,
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
