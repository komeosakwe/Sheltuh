-- Organiser profile categories (docs/architecture.md, "Organiser profiles",
-- "Categories").
--
--   * public.organisers.profile_tags: the chips an approved organiser chose
--     for their public profile, as slugs from a fixed list of 18 (the API's
--     ORGANISER_TAGS, lib/api/organiser-tags.ts), in list order. Null: not
--     chosen yet (the profile then shows their reviewed event categories,
--     mapped to the list); an empty array: chosen none. Not the reviewed
--     `categories` column, which stays as it is.
--   * public.organisers.custom_tags: up to 2 of those chips in the
--     organiser's own words. Never set while profile_tags is null, and at most
--     5 chips in all.
--   * private.organiser_custom_tag_ok: the database's own structural check of
--     one own word (the API's rules are stricter: parseCustomTag): 2 to 24
--     characters, trimmed, no double spaces, and none of what a link, handle,
--     markup or hidden text needs (@ # . / : \ < >, control, format and
--     separator characters, everything else Unicode says renders as nothing)
--     or what emoji are made of.
--     Applied by the trigger organisers_custom_tags_valid when a word is
--     added, not on every later update of the row (as the ticket link's check,
--     20261023000100_review_hardening.sql), so tightening the rule later never
--     blocks an unrelated update (a takedown, an edit). The trigger also
--     refuses a repeated chip in either column.
--   * private.set_organiser_tags: the organiser's save, as one step: lock the
--     organiser row, check it's approved, write only the columns that really
--     change, bump updated_at and log the old and new values in
--     private.organiser_profile_edits (`profile_tags`, `custom_tags`: the
--     values joined with ", "; null for none, and for profile_tags null for
--     "not chosen" and "" for "chosen none").
--   * private.admin_remove_organiser_custom_tags: an admin clears the
--     organiser's own words with a reason, logged as a `profile_edit` by the
--     admin (byStaff). The list items stay (they can't be abusive).
--
-- Locks: the organiser row (for no key update), as every organiser-profile
-- writer; no other row is written but the log.
--
-- Access model as everywhere else: no new grants (public.organisers has none
-- for anon or authenticated), every new function's execute revoked from
-- PUBLIC and its search_path pinned.
--
-- Index: none new. Both columns are only read with the organiser's row (by
-- id or owner), never filtered or sorted on.
--
-- Additive: the new columns are nullable or have a default, so the previous
-- app's reads (named columns) and inserts (defaults) are unaffected; no
-- existing function is redefined. Reversible: drop functions
-- private.admin_remove_organiser_custom_tags and private.set_organiser_tags,
-- trigger organisers_custom_tags_valid and function
-- private.organisers_custom_tags_valid, function
-- private.organiser_custom_tag_ok, then the two columns (destructive: every
-- organiser's chosen chips). Log entries naming the columns can stay (an API
-- without the fields skips names it doesn't know: EDIT_FIELDS in
-- lib/server/records.ts).

-- One own word: the database's structural floor (the API's parseCustomTag is
-- stricter). Escapes only (\uXXXX and \UXXXXXXXX are fixed-width), so no
-- invisible character is ever typed into this file.
create function private.organiser_custom_tag_ok(p_tag text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tag is not null
     and char_length(p_tag) between 2 and 24
     and p_tag = btrim(p_tag)
     and strpos(p_tag, '  ') = 0
     -- No backslash (written as chr(92): inside a bracket it's an escape).
     and strpos(p_tag, chr(92)) = 0
     -- What a link, handle or markup needs, in any width.
     and p_tag !~ '[@#./:<>\u3002\uFF0E\uFF61\uFF0F\uFF1A\uFF20\uFF03\uFE6B\uFE5F\u2024\uFE52]'
     -- Control and C1 characters, every Unicode format character (Cf), the
     -- line and paragraph separators, and the rest of the assigned characters
     -- that render as nothing (Default_Ignorable_Code_Point; the variation
     -- selectors are below):
     -- orders_buyer_name_check's list plus the zero-width joiners, the Hangul
     -- fillers, the Khmer inherent vowels and the Mongolian variation
     -- selectors.
     and p_tag !~ '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u115F-\u1160\u17B4-\u17B5\u180B-\u180F\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]'
     -- Emoji and their building blocks: pictographs and symbols, regional
     -- indicators, variation selectors, combining marks for symbols (the
     -- keycap U+20E3).
     and p_tag !~ '[\u20D0-\u20FF\u2190-\u21FF\u2300-\u23FF\u2460-\u24FF\u25A0-\u27BF\u2900-\u297F\u2B00-\u2BFF\u3030\u303D\u3297\u3299\uFE00-\uFE0F\U0001F000-\U0001FAFF\U000E0100-\U000E01EF]';
$$;

alter table public.organisers
  add column profile_tags text[],
  add column custom_tags text[] not null default '{}',
  add constraint organisers_profile_tags_check
    check (
      profile_tags is null
      or (coalesce(array_ndims(profile_tags), 1) = 1
          and cardinality(profile_tags) <= 5
          and array_position(profile_tags, null) is null
          and profile_tags <@ array['live-music', 'dj-club-nights', 'festivals', 'art', 'exhibitions', 'theatre',
                                    'comedy', 'dance', 'film', 'fashion', 'photography', 'design',
                                    'poetry-spoken-word', 'workshops', 'pop-ups-markets', 'food-drink',
                                    'wellness', 'community']::text[])
    ),
  add constraint organisers_custom_tags_check
    check (
      coalesce(array_ndims(custom_tags), 1) = 1
      and cardinality(custom_tags) <= 2
      and array_position(custom_tags, null) is null
      -- Own words only once the organiser has chosen (an empty choice included).
      and (profile_tags is not null or cardinality(custom_tags) = 0)
      and coalesce(cardinality(profile_tags), 0) + cardinality(custom_tags) <= 5
    );

create function private.organisers_custom_tags_valid() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only words that are new to the row: an update that leaves them alone (a
  -- takedown, an edit, a save of the list items) never re-checks them against
  -- rules tightened since.
  if exists (
    select 1 from unnest(new.custom_tags) t
     where (tg_op = 'INSERT' or t <> all(old.custom_tags))
       and not private.organiser_custom_tag_ok(t)
  ) then
    raise exception 'That own word isn''t accepted.'
      using errcode = 'check_violation', constraint = 'organisers_custom_tags_valid';
  end if;
  if cardinality(new.custom_tags) <> (select count(distinct lower(t)) from unnest(new.custom_tags) t)
     or cardinality(new.profile_tags) <> (select count(distinct t) from unnest(new.profile_tags) t) then
    raise exception 'A chip can''t be repeated.'
      using errcode = 'check_violation', constraint = 'organisers_custom_tags_valid';
  end if;
  return new;
end;
$$;

create trigger organisers_custom_tags_valid before insert or update of profile_tags, custom_tags on public.organisers
  for each row execute function private.organisers_custom_tags_valid();

-- The caller's organiser's chips: the list items (slugs) and own words, both
-- already checked and normalised by the API (the constraints and trigger
-- check again). Both are the whole new value (never null). Returns:
--   'updated'      written and logged
--   'unchanged'    both already so: nothing written
--   'not_approved' the caller's organiser isn't approved (any more): nothing written
--   'not_found'    the caller has no organiser
create function private.set_organiser_tags(p_owner_user_id uuid, p_profile_tags text[], p_custom_tags text[]) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_status public.organiser_status;
  v_old_profile text[];
  v_old_custom text[];
  v_changes jsonb := '{}'::jsonb;
begin
  if p_profile_tags is null or p_custom_tags is null then
    raise exception 'Both lists are required.' using errcode = 'null_value_not_allowed';
  end if;

  select o.id, o.status, o.profile_tags, o.custom_tags into v_id, v_status, v_old_profile, v_old_custom
    from public.organisers o where o.owner_user_id = p_owner_user_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_status <> 'approved' then
    return 'not_approved';
  end if;

  if v_old_profile is distinct from p_profile_tags then
    v_changes := v_changes || jsonb_build_object('profile_tags', jsonb_build_object(
      'old', array_to_string(v_old_profile, ', '), 'new', array_to_string(p_profile_tags, ', ')));
  end if;
  if v_old_custom is distinct from p_custom_tags then
    v_changes := v_changes || jsonb_build_object('custom_tags', jsonb_build_object(
      'old', nullif(array_to_string(v_old_custom, ', '), ''), 'new', nullif(array_to_string(p_custom_tags, ', '), '')));
  end if;
  if v_changes = '{}'::jsonb then
    return 'unchanged';
  end if;

  -- The organisers_set_updated_at trigger sets updated_at.
  update public.organisers
     set profile_tags = case when v_changes ? 'profile_tags' then p_profile_tags else profile_tags end,
         custom_tags = case when v_changes ? 'custom_tags' then p_custom_tags else custom_tags end
   where id = v_id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
  values (v_id, 'profile_edit', p_owner_user_id, v_changes);

  return 'updated';
end;
$$;

-- An admin clears an organiser's own words (any status), with a reason, logged
-- as a `profile_edit` by the admin. Returns 'removed', 'unchanged' (none:
-- nothing logged) or 'not_found'.
create function private.admin_remove_organiser_custom_tags(p_organiser_id uuid, p_admin_id uuid, p_reason text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_old text[];
begin
  select o.custom_tags into v_old from public.organisers o where o.id = p_organiser_id for no key update;
  if not found then
    return 'not_found';
  end if;
  if cardinality(v_old) = 0 then
    return 'unchanged';
  end if;

  update public.organisers set custom_tags = '{}' where id = p_organiser_id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields, reason)
  values (p_organiser_id, 'profile_edit', p_admin_id,
          jsonb_build_object('custom_tags', jsonb_build_object('old', array_to_string(v_old, ', '), 'new', null)),
          p_reason);

  return 'removed';
end;
$$;

revoke all on function private.organiser_custom_tag_ok(text) from public, anon, authenticated;
revoke all on function private.organisers_custom_tags_valid() from public, anon, authenticated;
revoke all on function private.set_organiser_tags(uuid, text[], text[]) from public, anon, authenticated;
revoke all on function private.admin_remove_organiser_custom_tags(uuid, uuid, text) from public, anon, authenticated;
