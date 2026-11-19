-- Organiser cover images (docs/architecture.md, "Organiser profiles").
--
--   * private.organiser_covers: an approved organiser's cover (the wide banner
--     at the top of their public profile), re-encoded by the API
--     (lib/server/organiser-cover.ts) to a 2240 x 640 WebP and a 1120 x 320
--     one (`small`): centre-cropped to 7:2, transparency flattened onto
--     white, no metadata (EXIF, GPS, ICC, XMP). The upload itself is never
--     stored. Stored in the database like logos and event photos (no Storage
--     bucket). Deleted with the organiser.
--   * private.put_organiser_cover: the organiser's upload, as one step: lock
--     the organiser row, check it's still approved (the upload may have taken
--     a while), write the cover, bump the organiser's updated_at and log the
--     change in private.organiser_profile_edits (owner, old and new version).
--   * private.delete_organiser_cover: the organiser removes it (any status, so
--     a suspended organiser can still take theirs down), logged the same way.
--     Nothing to remove writes nothing.
--   * private.admin_remove_organiser_cover: an admin removes it with a reason,
--     logged as a `profile_edit` by the admin (byStaff), like
--     admin_remove_organiser_logo.
--
-- The functions mirror the logo's (20261105000000_organiser_logos.sql). The
-- log records the cover's version (milliseconds since the epoch of its
-- updated_at, as text: the `v` of its URL), never the image. Each write sets
-- updated_at to clock_timestamp(), and a replacement to at least a
-- millisecond after the cover it replaces, so every new cover has a new
-- version (URL and ETag).
--
-- Locks: the organiser row first (for no key update), then the cover row, the
-- order every organiser-profile writer uses (suspend_organiser,
-- edit_organiser_profile and admin_remove_featured_video take the organiser
-- row for update, which conflicts with for no key update), so an upload
-- racing a takedown either lands first (and is then hidden with the
-- organiser: the public read requires approved) or sees `rejected` and writes
-- nothing.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC and its
-- search_path pinned.
--
-- Index: none new. organiser_covers is only read by its primary key
-- (organiser_id): the version subqueries of the organiser reads, and
-- GET /organisers/{id}/cover. The log keeps organiser_profile_edits_organiser_idx.
--
-- Additive: no existing table, column, function or row is changed; the
-- previous app never reads the table. Reversible: drop functions
-- private.admin_remove_organiser_cover, private.delete_organiser_cover and
-- private.put_organiser_cover, then table private.organiser_covers
-- (destructive: every cover). Log entries naming `cover` can stay (an API
-- without the field skips names it doesn't know: EDIT_FIELDS in
-- lib/server/records.ts).

create table private.organiser_covers (
  organiser_id uuid primary key references public.organisers (id) on delete cascade,
  -- Always WebP, made by the server: 2240 x 640, and the 1120 x 320 `small`.
  image bytea not null check (octet_length(image) between 1 and 1048576),
  small bytea not null check (octet_length(small) between 1 and 262144),
  updated_at timestamptz not null default now()
);

alter table private.organiser_covers enable row level security;
revoke all on private.organiser_covers from public, anon, authenticated;

-- The caller's organiser's new cover (already re-encoded by the API; the check
-- constraints bound the sizes). Returns:
--   'updated'      written and logged
--   'not_approved' the caller's organiser isn't approved (any more): nothing written
--   'not_found'    the caller has no organiser
create function private.put_organiser_cover(p_owner_user_id uuid, p_image bytea, p_small bytea) returns text
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

  select floor(extract(epoch from c.updated_at) * 1000)::bigint::text into v_old
    from private.organiser_covers c where c.organiser_id = v_id;

  insert into private.organiser_covers as c (organiser_id, image, small, updated_at)
  values (v_id, p_image, p_small, clock_timestamp())
  on conflict (organiser_id) do update
     set image = excluded.image,
         small = excluded.small,
         updated_at = greatest(excluded.updated_at, c.updated_at + interval '1 millisecond')
  returning floor(extract(epoch from c.updated_at) * 1000)::bigint::text into v_new;

  -- The organisers_set_updated_at trigger sets it to now(): the admin queue
  -- sorts by it, and a client's copy of the record is stale.
  update public.organisers set updated_at = now() where id = v_id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
  values (v_id, 'profile_edit', p_owner_user_id,
          jsonb_build_object('cover', jsonb_build_object('old', v_old, 'new', v_new)));

  return 'updated';
end;
$$;

-- The caller's organiser removes its cover, whatever its status. Returns
-- 'deleted' (logged), 'unchanged' (no cover: nothing written) or 'not_found'
-- (no organiser).
create function private.delete_organiser_cover(p_owner_user_id uuid) returns text
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

  delete from private.organiser_covers c where c.organiser_id = v_id
  returning floor(extract(epoch from c.updated_at) * 1000)::bigint::text into v_old;
  if not found then
    return 'unchanged';
  end if;

  update public.organisers set updated_at = now() where id = v_id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
  values (v_id, 'profile_edit', p_owner_user_id,
          jsonb_build_object('cover', jsonb_build_object('old', v_old, 'new', null)));

  return 'deleted';
end;
$$;

-- An admin removes an organiser's cover (any status), with a reason, logged as
-- a `profile_edit` by the admin. Returns 'removed', 'unchanged' (no cover:
-- nothing logged) or 'not_found'.
create function private.admin_remove_organiser_cover(p_organiser_id uuid, p_admin_id uuid, p_reason text) returns text
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

  delete from private.organiser_covers c where c.organiser_id = p_organiser_id
  returning floor(extract(epoch from c.updated_at) * 1000)::bigint::text into v_old;
  if not found then
    return 'unchanged';
  end if;

  update public.organisers set updated_at = now() where id = p_organiser_id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields, reason)
  values (p_organiser_id, 'profile_edit', p_admin_id,
          jsonb_build_object('cover', jsonb_build_object('old', v_old, 'new', null)), p_reason);

  return 'removed';
end;
$$;

revoke all on function private.put_organiser_cover(uuid, bytea, bytea) from public, anon, authenticated;
revoke all on function private.delete_organiser_cover(uuid) from public, anon, authenticated;
revoke all on function private.admin_remove_organiser_cover(uuid, uuid, text) from public, anon, authenticated;
