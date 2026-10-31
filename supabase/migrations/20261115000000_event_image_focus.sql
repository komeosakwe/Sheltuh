-- Photo focus point: an organiser (or an admin) says where the subject of an
-- event's photo is, and every cropped rendering (map pins, cards, rails, the
-- event page's strip) centres its crop on it instead of the middle.
--
--   * public.event_images.focus_x / focus_y: smallint, 0..100 (percent from
--     the left / top), both null (no focus: the crop centres) or both set
--     (check constraint event_images_focus_check). They live on the image row,
--     not on public.events, on purpose: a focus point only means something for
--     the photo it was set on, so replacing the photo without a focus resets it
--     and removing the photo drops it, with no extra code (the row goes); and
--     the photo is written by its own routes (PUT/DELETE /events/{id}/image,
--     /admin/events/{id}/image), not by the draft write functions, so none of
--     create_event_draft / edit_event_draft / admin_create_event /
--     admin_edit_event needs redefining. Every change of the row already
--     bumps the event's updated_at (event_images_touch_event), so a focus change
--     is a new version of the event, as a photo change is.
--   * private.admin_put_event_image: redefined with two trailing parameters
--     that default to null (the old four-argument call still works and means
--     "no focus"): the focus is written with the photo, atomically. The log's
--     `edited` entry gets an `imageFocus` change ({old, new}, each {x, y} or
--     null) only when the focus changed.
--   * private.admin_set_event_image_focus: an admin changes (or clears) the
--     focus of an existing photo, any event status, logged `edited`.
--   * The organiser's writes are inline SQL in lib/server/handlers/event-
--     images.ts, as for the photo itself (event row locked first, then the
--     image row).
--   * No new table, trigger, grant or index (nothing filters or sorts on it).
--     Both functions pin search_path and have execute revoked from PUBLIC,
--     anon and authenticated.
--
-- Not destructive: existing photos keep a null focus (centred, as now).
-- Reversible: drop admin_set_event_image_focus, drop the six-argument
-- admin_put_event_image and recreate the four-argument one from
-- 20261023000100_review_hardening.sql, then drop constraint
-- event_images_focus_check and the two columns (the focus points are lost).

alter table public.event_images
  add column focus_x smallint,
  add column focus_y smallint,
  add constraint event_images_focus_check check (
    (focus_x is null and focus_y is null)
    or (focus_x is not null and focus_y is not null and focus_x between 0 and 100 and focus_y between 0 and 100)
  );

drop function private.admin_put_event_image(uuid, uuid, text, bytea);

create function private.admin_put_event_image(
  p_event_id uuid, p_admin_id uuid, p_content_type text, p_data bytea,
  p_focus_x smallint default null, p_focus_y smallint default null
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_had boolean;
  v_old_x smallint;
  v_old_y smallint;
  v_details jsonb;
begin
  perform 1 from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  select true, i.focus_x, i.focus_y into v_had, v_old_x, v_old_y
    from public.event_images i where i.event_id = p_event_id;
  v_had := coalesce(v_had, false);

  insert into public.event_images (event_id, content_type, data, focus_x, focus_y)
  values (p_event_id, p_content_type, p_data, p_focus_x, p_focus_y)
  on conflict (event_id) do update set content_type = excluded.content_type, data = excluded.data,
    focus_x = excluded.focus_x, focus_y = excluded.focus_y, updated_at = now();

  v_details := jsonb_build_object('image', jsonb_build_object('old', case when v_had then 'set' end, 'new', 'set'));
  if v_old_x is distinct from p_focus_x or v_old_y is distinct from p_focus_y then
    v_details := v_details || jsonb_build_object('imageFocus', jsonb_build_object(
      'old', case when v_old_x is not null then jsonb_build_object('x', v_old_x, 'y', v_old_y) end,
      'new', case when p_focus_x is not null then jsonb_build_object('x', p_focus_x, 'y', p_focus_y) end));
  end if;
  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_admin_id, v_details);
  return 'updated';
end;
$$;

-- 'not_found' (no such event), 'no_image' (it has no photo), 'unchanged'
-- (same focus: nothing written or logged), 'updated'.
create function private.admin_set_event_image_focus(
  p_event_id uuid, p_admin_id uuid, p_focus_x smallint, p_focus_y smallint
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_old_x smallint;
  v_old_y smallint;
begin
  perform 1 from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  select i.focus_x, i.focus_y into v_old_x, v_old_y
    from public.event_images i where i.event_id = p_event_id for update;
  if not found then
    return 'no_image';
  end if;
  if v_old_x is not distinct from p_focus_x and v_old_y is not distinct from p_focus_y then
    return 'unchanged';
  end if;
  -- The photo's own version (updated_at) is left alone: its bytes are unchanged and stay cached.
  update public.event_images set focus_x = p_focus_x, focus_y = p_focus_y where event_id = p_event_id;
  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_admin_id, jsonb_build_object('imageFocus', jsonb_build_object(
    'old', case when v_old_x is not null then jsonb_build_object('x', v_old_x, 'y', v_old_y) end,
    'new', case when p_focus_x is not null then jsonb_build_object('x', p_focus_x, 'y', p_focus_y) end)));
  return 'updated';
end;
$$;

revoke all on function private.admin_put_event_image(uuid, uuid, text, bytea, smallint, smallint) from public, anon, authenticated;
revoke all on function private.admin_set_event_image_focus(uuid, uuid, smallint, smallint) from public, anon, authenticated;
