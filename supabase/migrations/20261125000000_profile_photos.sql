-- Member photos (docs/architecture.md, "Member photos"; owner decisions 12 Nov
-- 2026): up to 6 photos on a member profile, beside the profile photo, seen by
-- exactly whoever may see the profile (private.member_profile_visible). The
-- API only adds them while NEXT_PUBLIC_MEMBER_PHOTOS is "1".
--
--   * private.profile_photos: each photo as the API re-encoded it
--     (lib/server/avatar.ts encodeMemberPhoto): a WebP fitted inside
--     1080 px (at most 512 KB, the same bound as a report's photo copy,
--     private.report_photos) and a 320 px square thumbnail (at most 64 KB),
--     no metadata. Its size, an optional description (1 to 100 characters,
--     one line, used as alt text and caption) and the image's SHA-256, unique
--     per member, so uploading the same photo again finds the first. Stored in
--     the database like profile photos (no Storage bucket, no public or signed
--     URLs). Deleted with the profile.
--   * private.profile_photos_cap (trigger): at most 6 per member, whatever
--     inserts them. Locks the member's profile row first, so two inserts at
--     once count one after the other.
--   * private.add_profile_photo: the one write that adds a photo. Locks the
--     profile (no key update), re-checks it exists and its member isn't
--     suspended (the upload may have taken a while), then: the same image
--     already there is 'exists' with its id; 6 already is 'full'; else it's
--     inserted ('added'). Lock order profile, then photos, as in
--     private.admin_remove_profile_content.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC, every
-- function's search_path pinned. Neither function is security definer.
--
-- Indexes: profile_photos_user_created_idx (user_id, created_at, id) serves
-- listing a member's photos in upload order (every profile read) and the
-- count; profile_photos_user_image_key (user_id, image_sha256) the
-- same-image lookup. Either serves the profile cascade. Reads by photo id use
-- the primary key.
--
-- Additive (a new table, two new functions and a trigger); nothing existing
-- changes. Reversible, with data loss: drop the trigger, both functions and
-- the table (that deletes every member photo).

create table private.profile_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  -- Always WebP, made by the server.
  image bytea not null check (octet_length(image) between 1 and 524288),
  thumb bytea not null check (octet_length(thumb) between 1 and 65536),
  image_sha256 bytea not null,
  width integer not null check (width between 1 and 1080),
  height integer not null check (height between 1 and 1080),
  description text
    constraint profile_photos_description_check
    check (char_length(description) between 1 and 100 and description = btrim(description)
           and description !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now(),
  constraint profile_photos_sha256_check check (image_sha256 = sha256(image)),
  constraint profile_photos_user_image_key unique (user_id, image_sha256)
);

create index profile_photos_user_created_idx on private.profile_photos (user_id, created_at, id);

alter table private.profile_photos enable row level security;
revoke all on private.profile_photos from public, anon, authenticated;

-- At most 6 photos per member, enforced by the database whatever inserts
-- them: the member's profile row is locked (no key update) before counting,
-- so concurrent inserts for one member count in turn.
create function private.profile_photos_cap() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.profiles p where p.user_id = new.user_id for no key update;
  if (select count(*) from private.profile_photos ph where ph.user_id = new.user_id) >= 6 then
    raise exception 'A member has at most 6 photos.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger profile_photos_cap before insert on private.profile_photos
  for each row execute function private.profile_photos_cap();

-- Adds a photo for p_user_id (the API has re-encoded it). Returns (result,
-- photo_id): 'added' (the new photo), 'exists' (the same image is already one
-- of theirs: its id, nothing inserted), 'full' (6 already), 'no_profile' or
-- 'suspended'.
create function private.add_profile_photo(
  p_user_id uuid, p_image bytea, p_thumb bytea, p_width integer, p_height integer,
  out result text, out photo_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_sha bytea := sha256(p_image);
begin
  perform 1 from public.profiles p where p.user_id = p_user_id for no key update;
  if not found then
    result := 'no_profile';
    return;
  end if;
  if exists (select 1 from private.social_suspensions s where s.user_id = p_user_id) then
    result := 'suspended';
    return;
  end if;

  select ph.id into photo_id from private.profile_photos ph
   where ph.user_id = p_user_id and ph.image_sha256 = v_sha;
  if found then
    result := 'exists';
    return;
  end if;

  if (select count(*) from private.profile_photos ph where ph.user_id = p_user_id) >= 6 then
    result := 'full';
    return;
  end if;

  insert into private.profile_photos (user_id, image, thumb, image_sha256, width, height)
  values (p_user_id, p_image, p_thumb, v_sha, p_width, p_height)
  returning id into photo_id;
  result := 'added';
end;
$$;

revoke all on function private.profile_photos_cap() from public, anon, authenticated;
revoke all on function private.add_profile_photo(uuid, bytea, bytea, integer, integer) from public, anon, authenticated;
