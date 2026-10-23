-- Organiser logos (docs/architecture.md, "Organiser profiles").
--
--   * private.organiser_logos: an approved organiser's logo, re-encoded by the
--     API (lib/server/organiser-logo.ts) to a 512 px square WebP and a 96 px
--     thumbnail: the whole logo fitted on white, no transparency and no
--     metadata (EXIF, GPS, ICC, XMP). The upload itself is never stored.
--     Stored in the database like event photos and member photos (no Storage
--     bucket). Deleted with the organiser.
--   * private.put_organiser_logo: the organiser's upload, as one step: lock
--     the organiser row, check it's still approved (the upload may have taken
--     a while), write the logo, bump the organiser's updated_at and log the
--     change in private.organiser_profile_edits (like any unreviewed profile
--     edit: owner, old and new version).
--   * private.delete_organiser_logo: the organiser removes it (any status, so
--     a suspended organiser can still take theirs down), logged the same way.
--     Nothing to remove writes nothing.
--   * private.admin_remove_organiser_logo: an admin removes it with a reason,
--     logged as a `profile_edit` by the admin (byStaff), like
--     admin_remove_featured_video.
--
-- The log records the logo's version (milliseconds since the epoch of its
-- updated_at, as text: the `v` of its URL), never the image. Each write sets
-- updated_at to clock_timestamp(), and a replacement to at least a
-- millisecond after the logo it replaces, so every new logo has a new
-- version (URL and ETag).
--
-- Locks: the organiser row first (for no key update), then the logo row, the
-- order suspend_organiser, edit_organiser_profile and
-- admin_remove_featured_video use (they take the organiser row for update,
-- which conflicts with for no key update), so an upload racing a takedown
-- either lands first (and is then hidden with the organiser: the public read
-- requires approved) or sees `rejected` and writes nothing. follow_organiser's
-- key-share lock doesn't conflict.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC and its
-- search_path pinned.
--
-- Index: none new. organiser_logos is only read by its primary key
-- (organiser_id): the version subqueries of the organiser and event reads,
-- and GET /organisers/{id}/logo. The log keeps
-- organiser_profile_edits_organiser_idx.
--
-- Reversible: drop functions private.admin_remove_organiser_logo,
-- private.delete_organiser_logo and private.put_organiser_logo, then table
-- private.organiser_logos (destructive: every logo). Log entries naming
-- `logo` can stay (an API without the field skips names it doesn't know:
-- EDIT_FIELDS in lib/server/records.ts). No existing table, column or row is
-- changed.

create table private.organiser_logos (
  organiser_id uuid primary key references public.organisers (id) on delete cascade,
  -- Always WebP, made by the server: 512 x 512, and the 96 x 96 thumbnail.
  image bytea not null check (octet_length(image) between 1 and 524288),
  thumb bytea not null check (octet_length(thumb) between 1 and 65536),
  updated_at timestamptz not null default now()
);

alter table private.organiser_logos enable row level security;
revoke all on private.organiser_logos from public, anon, authenticated;

-- The caller's organiser's new logo (already re-encoded by the API; the check
-- constraints bound the sizes). Returns:
--   'updated'      written and logged
--   'not_approved' the caller's organiser isn't approved (any more): nothing written
--   'not_found'    the caller has no organiser
create function private.put_organiser_logo(p_owner_user_id uuid, p_image bytea, p_thumb bytea) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_status public.organiser_status;
  v_old text;
  v_new text;
begin
  select o.id, o.status into v_id, v_status
    from public.organisers o where o.owner_user_id = p_owner_user_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_status <> 'approved' then
    return 'not_approved';
  end if;

  select floor(extract(epoch from l.updated_at) * 1000)::bigint::text into v_old
    from private.organiser_logos l where l.organiser_id = v_id;

  insert into private.organiser_logos as l (organiser_id, image, thumb, updated_at)
  values (v_id, p_image, p_thumb, clock_timestamp())
  on conflict (organiser_id) do update
     set image = excluded.image,
         thumb = excluded.thumb,
         updated_at = greatest(excluded.updated_at, l.updated_at + interval '1 millisecond')
  returning floor(extract(epoch from l.updated_at) * 1000)::bigint::text into v_new;

  -- The organisers_set_updated_at trigger sets it to now(): the admin queue
  -- sorts by it, and a client's copy of the record is stale.
  update public.organisers set updated_at = now() where id = v_id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
  values (v_id, 'profile_edit', p_owner_user_id,
          jsonb_build_object('logo', jsonb_build_object('old', v_old, 'new', v_new)));

  return 'updated';
end;
$$;

-- The caller's organiser removes its logo, whatever its status. Returns
-- 'deleted' (logged), 'unchanged' (no logo: nothing written) or 'not_found'
-- (no organiser).
create function private.delete_organiser_logo(p_owner_user_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_old text;
begin
  select o.id into v_id
    from public.organisers o where o.owner_user_id = p_owner_user_id
     for no key update;
  if not found then
    return 'not_found';
  end if;

  delete from private.organiser_logos l where l.organiser_id = v_id
  returning floor(extract(epoch from l.updated_at) * 1000)::bigint::text into v_old;
  if not found then
    return 'unchanged';
  end if;

  update public.organisers set updated_at = now() where id = v_id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
  values (v_id, 'profile_edit', p_owner_user_id,
          jsonb_build_object('logo', jsonb_build_object('old', v_old, 'new', null)));

  return 'deleted';
end;
$$;

-- An admin removes an organiser's logo (any status), with a reason, logged as
-- a `profile_edit` by the admin. Returns 'removed', 'unchanged' (no logo:
-- nothing logged) or 'not_found'.
create function private.admin_remove_organiser_logo(p_organiser_id uuid, p_admin_id uuid, p_reason text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_old text;
begin
  perform 1 from public.organisers o where o.id = p_organiser_id for no key update;
  if not found then
    return 'not_found';
  end if;

  delete from private.organiser_logos l where l.organiser_id = p_organiser_id
  returning floor(extract(epoch from l.updated_at) * 1000)::bigint::text into v_old;
  if not found then
    return 'unchanged';
  end if;

  update public.organisers set updated_at = now() where id = p_organiser_id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields, reason)
  values (p_organiser_id, 'profile_edit', p_admin_id,
          jsonb_build_object('logo', jsonb_build_object('old', v_old, 'new', null)), p_reason);

  return 'removed';
end;
$$;

revoke all on function private.put_organiser_logo(uuid, bytea, bytea) from public, anon, authenticated;
revoke all on function private.delete_organiser_logo(uuid) from public, anon, authenticated;
revoke all on function private.admin_remove_organiser_logo(uuid, uuid, text) from public, anon, authenticated;
