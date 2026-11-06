-- More social links for organisers: Spotify, SoundCloud, YouTube and LinkedIn
-- (owner request: a "Host" card on the event page with the organiser's logo
-- and socials; the organiser's profile page shows them too).
--
-- Same rule as the existing networks: nothing is stored as a free-form URL.
-- Each column holds a small validated value and the server builds the https
-- URL from it (lib/server/organiser-input.ts), so a stored value can only
-- ever point at the network it names. The CHECKs mirror the API's validation
-- (lib/api/social-profiles.ts), which also reads a pasted link into the
-- stored form, so a bad value can't get in by any other path. Every column is
-- nullable: unset means the organiser hasn't given one.
--
--   spotify_path       artist/<22 letters or digits>, show/<22 letters or
--                      digits> (a podcast) or user/<1-64 of letters, digits,
--                      . _ -, the first a letter or digit>
--                      -> https://open.spotify.com/<spotify_path>
--   soundcloud_handle  the profile name, 1-40 of letters, digits, _ and -
--                      -> https://soundcloud.com/<soundcloud_handle>
--   youtube_channel    @<3-30 of letters, digits, . _ -, the first a letter or
--                      digit>  or  channel/UC<22 of letters, digits, _ and ->
--                      -> https://www.youtube.com/<youtube_channel>
--   linkedin_path      in/<3-100 of letters, digits, -, the first a letter or
--                      digit>  or  company/<same>
--                      -> https://www.linkedin.com/<linkedin_path>
--
-- The name or id part of each starts with a letter or digit (SoundCloud's
-- must contain one, like the other handles), so it can't be just "." or ".."
-- (which a URL would resolve away) or only punctuation.
--
-- The two functions that write organisers' social columns are replaced so
-- the new columns are written too (everything else in them is unchanged):
--   * private.edit_organiser_profile (an approved organiser's profile edit):
--     the new fields are written and logged, old and new, in
--     private.organiser_profile_edits like the other handles;
--   * private.accept_account_invite: an organiser invite's profile (jsonb) may
--     carry the four new keys.
-- Both stay `set search_path = ''`, and their revokes (from public, anon and
-- authenticated) are untouched by `create or replace`.
--
-- No new table, policy or grant: public.organisers keeps RLS on with no
-- policies, and anon/authenticated still have no grants (init migration).
-- New columns get no column grants either.
--
-- Indexes: none. Nothing filters or sorts by these columns; they're read with
-- the organiser's row (primary key) and the event's join to it.
--
-- Reversible, not destructive of existing data: drop the four columns
-- (discards any links entered since) and restore the two functions from
-- 20261024000200_organiser_follows.sql and 20261108000000_account_invites.sql.

alter table public.organisers
  add column spotify_path text
    constraint organisers_spotify_path_check
    check (spotify_path ~ '^((artist|show)/[A-Za-z0-9]{22}|user/[A-Za-z0-9][A-Za-z0-9._-]{0,63})$'),
  add column soundcloud_handle text
    constraint organisers_soundcloud_handle_check
    check (soundcloud_handle ~ '^[A-Za-z0-9_-]{1,40}$' and soundcloud_handle ~ '[A-Za-z0-9]'),
  add column youtube_channel text
    constraint organisers_youtube_channel_check
    check (youtube_channel ~ '^(@[A-Za-z0-9][A-Za-z0-9._-]{2,29}|channel/UC[A-Za-z0-9_-]{22})$'),
  add column linkedin_path text
    constraint organisers_linkedin_path_check
    check (linkedin_path ~ '^(in|company)/[A-Za-z0-9][A-Za-z0-9-]{2,99}$');

-- As in 20261024000200_organiser_follows.sql, plus the four columns above
-- ("spotify_path", "soundcloud_handle", "youtube_channel", "linkedin_path";
-- JSON null clears one).
create or replace function private.edit_organiser_profile(p_owner_user_id uuid, p_changes jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_old public.organisers;
  v_changed jsonb;
  v_video text;
begin
  select * into v_old from public.organisers where owner_user_id = p_owner_user_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_old.status <> 'approved' then
    return 'not_approved';
  end if;

  v_video := case when v_old.featured_video_provider is null then null
                  else v_old.featured_video_provider || ':' || v_old.featured_video_id end;

  select coalesce(jsonb_object_agg(c.field, jsonb_build_object('old', c.old_value, 'new', p_changes -> c.field)), '{}'::jsonb)
    into v_changed
    from (values ('description', v_old.description),
                 ('website_url', v_old.website_url),
                 ('instagram_handle', v_old.instagram_handle),
                 ('tiktok_handle', v_old.tiktok_handle),
                 ('facebook_page', v_old.facebook_page),
                 ('x_handle', v_old.x_handle),
                 ('spotify_path', v_old.spotify_path),
                 ('soundcloud_handle', v_old.soundcloud_handle),
                 ('youtube_channel', v_old.youtube_channel),
                 ('linkedin_path', v_old.linkedin_path),
                 ('featured_video', v_video)) as c (field, old_value)
   where p_changes ? c.field
     and (p_changes ->> c.field) is distinct from c.old_value;

  if v_changed = '{}'::jsonb then
    return 'unchanged';
  end if;

  update public.organisers set
    description = case when v_changed ? 'description' then p_changes ->> 'description' else description end,
    website_url = case when v_changed ? 'website_url' then p_changes ->> 'website_url' else website_url end,
    instagram_handle = case when v_changed ? 'instagram_handle' then p_changes ->> 'instagram_handle' else instagram_handle end,
    tiktok_handle = case when v_changed ? 'tiktok_handle' then p_changes ->> 'tiktok_handle' else tiktok_handle end,
    facebook_page = case when v_changed ? 'facebook_page' then p_changes ->> 'facebook_page' else facebook_page end,
    x_handle = case when v_changed ? 'x_handle' then p_changes ->> 'x_handle' else x_handle end,
    spotify_path = case when v_changed ? 'spotify_path' then p_changes ->> 'spotify_path' else spotify_path end,
    soundcloud_handle = case when v_changed ? 'soundcloud_handle' then p_changes ->> 'soundcloud_handle' else soundcloud_handle end,
    youtube_channel = case when v_changed ? 'youtube_channel' then p_changes ->> 'youtube_channel' else youtube_channel end,
    linkedin_path = case when v_changed ? 'linkedin_path' then p_changes ->> 'linkedin_path' else linkedin_path end,
    featured_video_provider = case when v_changed ? 'featured_video'
                                   then nullif(split_part(p_changes ->> 'featured_video', ':', 1), '')
                                   else featured_video_provider end,
    featured_video_id = case when v_changed ? 'featured_video'
                             then nullif(split_part(p_changes ->> 'featured_video', ':', 2), '')
                             else featured_video_id end
  where id = v_old.id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
  values (v_old.id, 'profile_edit', p_owner_user_id, v_changed);

  return 'updated';
end;
$$;

-- As in 20261108000000_account_invites.sql, plus the four columns above, read
-- from the invite's organiser_profile jsonb (absent or null: unset).
create or replace function private.accept_account_invite(
  p_invite_id uuid, p_user_id uuid, p_email text,
  out result text, out kind text, out organiser_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_invite private.account_invites;
  v_profile jsonb;
begin
  select * into v_invite from private.account_invites i where i.id = p_invite_id for update;
  if not found or lower(v_invite.email) <> lower(p_email) then
    result := 'not_found';
    return;
  end if;
  kind := v_invite.kind;
  if v_invite.status = 'accepted' then
    if v_invite.accepted_by = p_user_id then
      result := 'already_accepted';
      organiser_id := v_invite.accepted_organiser_id;
    else
      result := 'used';
      kind := null;
    end if;
    return;
  end if;
  if v_invite.status = 'revoked' then
    result := 'revoked';
    kind := null;
    return;
  end if;
  if v_invite.status = 'expired' or v_invite.expires_at <= now() then
    result := 'expired';
    kind := null;
    return;
  end if;
  -- The organiser is approved on the inviter's say-so: only while they're an admin.
  if not private.account_invite_inviter_is_admin(v_invite.invited_by) then
    update private.account_invites i set status = 'revoked', revoked_at = now() where i.id = v_invite.id;
    result := 'revoked';
    kind := null;
    return;
  end if;

  if v_invite.kind = 'organiser' then
    v_profile := v_invite.organiser_profile;
    -- One organiser per account (owner_user_id is unique): an existing one, or
    -- an application committed while this ran, wins.
    insert into public.organisers (owner_user_id, display_name, contact_email, description, categories, website_url,
                                   instagram_handle, tiktok_handle, facebook_page, x_handle,
                                   spotify_path, soundcloud_handle, youtube_channel, linkedin_path,
                                   featured_video_provider, featured_video_id,
                                   status, reviewed_by, reviewed_at)
    values (p_user_id, v_profile ->> 'display_name', v_profile ->> 'contact_email', v_profile ->> 'description',
            array(select jsonb_array_elements_text(v_profile -> 'categories'))::public.event_category[],
            v_profile ->> 'website_url', v_profile ->> 'instagram_handle', v_profile ->> 'tiktok_handle',
            v_profile ->> 'facebook_page', v_profile ->> 'x_handle',
            v_profile ->> 'spotify_path', v_profile ->> 'soundcloud_handle',
            v_profile ->> 'youtube_channel', v_profile ->> 'linkedin_path',
            v_profile ->> 'featured_video_provider', v_profile ->> 'featured_video_id',
            'approved', v_invite.invited_by, now())
    on conflict (owner_user_id) do nothing
    returning id into organiser_id;
    if organiser_id is null then
      result := 'has_organiser';
      kind := null;
      return;
    end if;
    insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
    values (organiser_id, 'invite_accepted', p_user_id,
            jsonb_build_object('status', jsonb_build_object('old', null, 'new', 'approved')));
  end if;

  update private.account_invites i
     set status = 'accepted', accepted_at = now(), accepted_by = p_user_id, accepted_organiser_id = organiser_id
   where i.id = v_invite.id;
  result := 'accepted';
end;
$$;
