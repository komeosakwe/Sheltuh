-- Organiser profile moderation (security review of organiser profiles, MEDIUM-1).
--
-- An approved organiser edits their public profile (bio, website, social
-- handles) without a new review. The compensating controls:
--
--   * private.organiser_profile_edits: an append-only log of every profile
--     change (old and new value of each changed field) and every admin
--     takedown (with its reason), shown to admins on the organiser queue.
--     Written in the same transaction as the change it records.
--   * private.edit_organiser_profile: the approved organiser's PATCH, as one
--     step: lock the row, check it's still approved, work out which fields
--     really change, update only those and log them.
--   * private.suspend_organiser: an admin takedown of an approved organiser,
--     as one step: status 'rejected' with the reason and reviewer recorded;
--     every published event unpublished (back to draft) and every event
--     waiting for review rejected, each through private.transition_event so
--     event_moderation_log records it with the same reason; and the
--     takedown logged. Nothing is deleted: orders, tickets, drafts and
--     earlier rejected events are left alone. A payment already under way
--     for an unpublished event is refused and refunded by fulfil_order (it
--     only fulfils published events), as for any unpublished event.
--
-- Locks: the organiser row first (for update), then its events in id order
-- (for update). Event approval (lib/server/handlers/admin.ts) share-locks
-- the organiser row before it touches the event, the same order, so an
-- approval and a takedown can't deadlock or interleave: whichever is second
-- sees the other's result.
--
-- Access model as everywhere else: RLS on, no policies, no grants to anon or
-- authenticated, every new function's execute revoked from PUBLIC and its
-- search_path pinned.
--
-- Index: organiser_profile_edits (organiser_id, id desc) serves the only
-- read, the admin queue's newest 20 entries per organiser (a top-N per
-- organiser in a lateral subquery), and the cascade when an organiser is
-- deleted.
--
-- Reversible, not destructive: drop functions private.suspend_organiser,
-- private.edit_organiser_profile and private.organiser_profile_edits_append_only,
-- then table private.organiser_profile_edits (discarding the log). No
-- existing table, column or row is changed.

create table private.organiser_profile_edits (
  id bigint generated always as identity primary key,
  organiser_id uuid not null references public.organisers (id) on delete cascade,
  -- profile_edit: the organiser changed their profile. suspended: an admin took them down.
  kind text not null check (kind in ('profile_edit', 'suspended')),
  -- The organiser's owner for a profile edit, the admin for a takedown.
  actor_id uuid references auth.users (id) on delete set null,
  -- {"<column>": {"old": <text or null>, "new": <text or null>}, ...}: only
  -- the columns that changed (for a takedown, "status").
  changed_fields jsonb not null check (jsonb_typeof(changed_fields) = 'object' and changed_fields <> '{}'::jsonb),
  reason text check (char_length(reason) between 1 and 500),
  edited_at timestamptz not null default now(),
  constraint organiser_profile_edits_reason check ((kind = 'suspended') = (reason is not null))
);

create index organiser_profile_edits_organiser_idx on private.organiser_profile_edits (organiser_id, id desc);

alter table private.organiser_profile_edits enable row level security;
revoke all on private.organiser_profile_edits from public, anon, authenticated;

-- Append-only: an entry can't be rewritten. The one update allowed is the
-- foreign key's own `on delete set null` of actor_id when that account is
-- deleted. Deletes are allowed only so the log goes with its organiser.
create function private.organiser_profile_edits_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.actor_id is null
     and old.actor_id is not null
     and (new.id, new.organiser_id, new.kind, new.changed_fields, new.edited_at)
         = (old.id, old.organiser_id, old.kind, old.changed_fields, old.edited_at)
     and new.reason is not distinct from old.reason then
    return new;
  end if;
  raise exception 'private.organiser_profile_edits is append-only';
end;
$$;

create trigger organiser_profile_edits_append_only
  before update on private.organiser_profile_edits
  for each row execute function private.organiser_profile_edits_append_only();

-- An approved organiser's profile edit. p_changes holds only the columns
-- being set ("description", "website_url", "instagram_handle",
-- "tiktok_handle", "facebook_page", "x_handle"; JSON null clears one),
-- already validated by the API (the check constraints re-check them). Other
-- keys are ignored. Returns:
--   'updated'      something changed; the change is logged
--   'unchanged'    every value sent equals the stored one: nothing written
--   'not_approved' the caller's organiser isn't approved (any more)
--   'not_found'    the caller has no organiser
create function private.edit_organiser_profile(p_owner_user_id uuid, p_changes jsonb) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_old public.organisers;
  v_changed jsonb;
begin
  select * into v_old from public.organisers where owner_user_id = p_owner_user_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_old.status <> 'approved' then
    return 'not_approved';
  end if;

  select coalesce(jsonb_object_agg(c.field, jsonb_build_object('old', c.old_value, 'new', p_changes -> c.field)), '{}'::jsonb)
    into v_changed
    from (values ('description', v_old.description),
                 ('website_url', v_old.website_url),
                 ('instagram_handle', v_old.instagram_handle),
                 ('tiktok_handle', v_old.tiktok_handle),
                 ('facebook_page', v_old.facebook_page),
                 ('x_handle', v_old.x_handle)) as c (field, old_value)
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
    x_handle = case when v_changed ? 'x_handle' then p_changes ->> 'x_handle' else x_handle end
  where id = v_old.id;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields)
  values (v_old.id, 'profile_edit', p_owner_user_id, v_changed);

  return 'updated';
end;
$$;

-- Takes an approved organiser down (see the header). Only from 'approved', so
-- two admins acting at once can't both succeed. result:
--   'suspended'    done; events_unpublished / submissions_rejected say how many events moved
--   'not_approved' the organiser isn't approved (pending, rejected, or already taken down)
--   'not_found'    no such organiser
create function private.suspend_organiser(p_organiser_id uuid, p_admin_id uuid, p_reason text)
returns table (result text, events_unpublished integer, submissions_rejected integer)
language plpgsql
set search_path = ''
as $$
declare
  v_status public.organiser_status;
  v_event record;
  v_unpublished integer := 0;
  v_rejected integer := 0;
begin
  select o.status into v_status from public.organisers o where o.id = p_organiser_id for update;
  if not found then
    return query select 'not_found'::text, 0, 0;
    return;
  end if;
  if v_status <> 'approved' then
    return query select 'not_approved'::text, 0, 0;
    return;
  end if;

  update public.organisers
     set status = 'rejected', rejection_reason = p_reason, reviewed_by = p_admin_id, reviewed_at = now()
   where id = p_organiser_id;

  for v_event in
    select e.id, e.status from public.events e
     where e.organiser_id = p_organiser_id and e.status in ('published', 'pending_review')
     order by e.id
       for update
  loop
    if v_event.status = 'published' then
      perform private.transition_event(v_event.id, array['published']::public.event_status[], 'draft',
                                       'unpublished', p_admin_id, p_reason);
      v_unpublished := v_unpublished + 1;
    else
      perform private.transition_event(v_event.id, array['pending_review']::public.event_status[], 'rejected',
                                       'rejected', p_admin_id, p_reason);
      v_rejected := v_rejected + 1;
    end if;
  end loop;

  insert into private.organiser_profile_edits (organiser_id, kind, actor_id, changed_fields, reason)
  values (p_organiser_id, 'suspended', p_admin_id,
          jsonb_build_object('status', jsonb_build_object('old', 'approved', 'new', 'rejected')), p_reason);

  return query select 'suspended'::text, v_unpublished, v_rejected;
end;
$$;

revoke all on function private.organiser_profile_edits_append_only() from public, anon, authenticated;
revoke all on function private.edit_organiser_profile(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.suspend_organiser(uuid, uuid, text) from public, anon, authenticated;
