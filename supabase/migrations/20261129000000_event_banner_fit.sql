-- Banner fit: how the home page's featured banner shows an event's photo.
-- 'crop' (the default, every existing photo) fills the 5:2 banner and crops,
-- centred on the focus point; 'whole' shows the whole photo, centred, on the
-- blurred backdrop (a poster with text near its edges, say).
--
--   * public.event_images.banner_fit: text, not null, default 'crop', check
--     constraint event_images_banner_fit_check ('crop' or 'whole'). On the
--     image row next to focus_x / focus_y, for the same reasons
--     (20261115000000_event_image_focus.sql): it only means something for a
--     photo, deleting the photo drops it, and none of the draft write
--     functions needs redefining. Unlike the focus, replacing the photo keeps
--     it: neither the organiser's upsert (lib/server/handlers/event-images.ts)
--     nor private.admin_put_event_image names the column, so their
--     `on conflict do update` leaves it alone. Every change of the row already
--     bumps the event's updated_at (event_images_touch_event).
--   * private.admin_set_event_image_display: an admin changes the focus, the
--     banner fit or both of an existing photo, any event status, in one step.
--     p_set_focus false keeps the focus (p_focus_x / p_focus_y are then
--     ignored); a null p_banner_fit keeps the fit. Locks the event row (for
--     no key update), then the image row (for update), the order every image
--     writer uses. Logged `edited` with `imageFocus` and/or `bannerFit`
--     ({old, new}) for what changed; nothing written or logged when nothing
--     does. Returns 'not_found', 'no_image', 'unchanged' or 'updated'.
--   * private.admin_set_event_image_focus and admin_put_event_image are left
--     as they are: the app deployed before this file keeps calling them.
--   * The organiser's writes stay inline SQL in the handler (draft or
--     rejected events only, as the photo and its focus).
--   * No new table, trigger, grant or index (nothing filters or sorts on it).
--     The function pins search_path and has execute revoked from PUBLIC, anon
--     and authenticated.
--
-- Apply before deploying the app that reads it: every event read selects
-- banner_fit, so the new app on the old schema fails on every event. The
-- previous app keeps working against this file (it never reads or writes
-- the column; its photos get 'crop', as now).
--
-- Not destructive. Reversible: drop function
-- private.admin_set_event_image_display(uuid, uuid, boolean, smallint,
-- smallint, text), then drop constraint event_images_banner_fit_check and
-- column banner_fit (every 'whole' setting is lost), after deploying an app
-- that doesn't select it.

alter table public.event_images
  add column banner_fit text not null default 'crop',
  add constraint event_images_banner_fit_check check (banner_fit in ('crop', 'whole'));

create function private.admin_set_event_image_display(
  p_event_id uuid, p_admin_id uuid, p_set_focus boolean,
  p_focus_x smallint, p_focus_y smallint, p_banner_fit text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_old_x smallint;
  v_old_y smallint;
  v_old_fit text;
  v_new_x smallint;
  v_new_y smallint;
  v_new_fit text;
  v_details jsonb := '{}'::jsonb;
begin
  perform 1 from public.events e where e.id = p_event_id for no key update;
  if not found then
    return 'not_found';
  end if;
  select i.focus_x, i.focus_y, i.banner_fit into v_old_x, v_old_y, v_old_fit
    from public.event_images i where i.event_id = p_event_id for update;
  if not found then
    return 'no_image';
  end if;

  if coalesce(p_set_focus, false) then
    v_new_x := p_focus_x;
    v_new_y := p_focus_y;
  else
    v_new_x := v_old_x;
    v_new_y := v_old_y;
  end if;
  v_new_fit := coalesce(p_banner_fit, v_old_fit);

  if v_old_x is distinct from v_new_x or v_old_y is distinct from v_new_y then
    v_details := v_details || jsonb_build_object('imageFocus', jsonb_build_object(
      'old', case when v_old_x is not null then jsonb_build_object('x', v_old_x, 'y', v_old_y) end,
      'new', case when v_new_x is not null then jsonb_build_object('x', v_new_x, 'y', v_new_y) end));
  end if;
  if v_old_fit is distinct from v_new_fit then
    v_details := v_details || jsonb_build_object('bannerFit', jsonb_build_object('old', v_old_fit, 'new', v_new_fit));
  end if;
  if v_details = '{}'::jsonb then
    return 'unchanged';
  end if;

  -- The photo's own version (updated_at) is left alone: its bytes are unchanged and stay cached.
  -- The check constraints refuse a bad focus or fit (23514), rolling the whole call back.
  update public.event_images set focus_x = v_new_x, focus_y = v_new_y, banner_fit = v_new_fit
   where event_id = p_event_id;
  insert into public.event_moderation_log (event_id, action, actor_id, details)
  values (p_event_id, 'edited', p_admin_id, v_details);
  return 'updated';
end;
$$;

revoke all on function private.admin_set_event_image_display(uuid, uuid, boolean, smallint, smallint, text)
  from public, anon, authenticated;
