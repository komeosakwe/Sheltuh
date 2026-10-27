-- The organiser's submit for review stops refusing an event without a pin in
-- the database: the app checks it instead (docs/architecture.md, "Venue
-- location"; docs/DEPLOYMENT.md, "Migrations").
--
-- Sorts after 20261111000300_refund_no_inference.sql. Needs
-- 20261111000100_event_venue_location.sql (whose private.submit_event it
-- redefines).
--
-- 20261111000100 made private.submit_event return 'location_required' for an
-- event without the organiser's pin (events.venue_lat null). The previous app
-- version doesn't know that result: against it, its POST /events/{id}/submit
-- answered 200 while the event stayed a draft, and nothing reached the review
-- queue. So the migrations couldn't be applied ahead of the deploy without
-- breaking the live app's submit.
--
-- Now private.submit_event is exactly as in
-- 20261109000000_paid_events_need_payouts.sql again (draft or rejected →
-- pending_review, refusing 'not_found', 'not_submittable' and
-- 'payouts_required'), so the previous app's submit works whichever of the
-- migrations are applied. This app's handler (lib/server/handlers/events.ts,
-- submitEventForReview) refuses an event without the organiser's pin itself,
-- with the same 409 `code: "location_required"` as publishing, before it calls
-- the function, and after the checks the function would answer first (not
-- draft or rejected, then payouts), so the order of refusals is unchanged.
-- That check and the submit aren't one transaction: an edit that clears the
-- pin between them (only the organiser's own, in another tab) lets the event
-- reach the review queue without a pin, where an admin decides (an admin's
-- approval never needed a pin). private.publish_event keeps its own
-- 'location_required' check: only this app calls it.
--
-- Same signature and results (create or replace). Pins search_path = '',
-- isn't security definer, and has execute revoked from PUBLIC, anon and
-- authenticated again. Locks as before: the organiser (share), then the event
-- (no key update).
--
-- No new table, column or index; no data is changed.
--
-- Reversible: recreate private.submit_event from
-- 20261111000100_event_venue_location.sql with its revoke (the previous app's
-- submit then answers 200 for an event without a pin and leaves it a draft
-- again).

-- As in 20261109000000_paid_events_need_payouts.sql (the 'location_required'
-- refusal of 20261111000100 removed: the app checks the pin).
create or replace function private.submit_event(p_event_id uuid, p_organiser_id uuid, p_actor_id uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_payouts boolean;
  v_status text;
  v_event record;
begin
  -- submit_location_in_app (20261111000400): no pin check here; the app refuses an event without one.
  select o.payouts_enabled, o.status::text into v_payouts, v_status
    from public.organisers o where o.id = p_organiser_id for share;
  -- Re-checked under the lock: a takedown that committed after the handler's
  -- own (unlocked) check must win.
  if not found or v_status <> 'approved' then
    return 'not_found';
  end if;
  select e.status, e.ticketing_mode into v_event
    from public.events e
   where e.id = p_event_id and e.organiser_id = p_organiser_id
     for no key update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    return 'not_submittable';
  end if;
  if not v_payouts and v_event.ticketing_mode = 'sheltuh'
     and exists (select 1 from public.ticket_types t where t.event_id = p_event_id and t.price_cents > 0) then
    return 'payouts_required';
  end if;

  if not private.transition_event(p_event_id, array['draft', 'rejected']::public.event_status[], 'pending_review',
                                  'submitted', p_actor_id, null, p_organiser_id) then
    raise exception 'submit_event: the locked event could not be submitted';
  end if;
  return 'submitted';
end;
$$;

revoke all on function private.submit_event(uuid, uuid, uuid) from public, anon, authenticated;
