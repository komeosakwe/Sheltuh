-- Pins search_path on the last three functions that didn't set it (Supabase's
-- Security Advisor: "Function Search Path Mutable"). Every function added
-- since 20260925000000_init.sql already sets `search_path = ''`.
--
-- Sorts after 20261111000400_submit_event_location_in_app.sql. Needs only
-- 20260925000000_init.sql (the three functions).
--
-- None of the three is security definer or executable by a client, and their
-- bodies already name everything by schema (public.events,
-- public.event_moderation_log, private.replace_ticket_types; now() is in
-- pg_catalog, which is always searched), so pinning changes no behaviour:
-- it only stops a caller's search_path from ever deciding what they resolve.
-- private.update_event_draft is unused since 20261022000000_external_ticketing.sql
-- (kept for that deploy window); it's pinned rather than dropped, as
-- migrations here are additive.

alter function public.set_updated_at() set search_path = '';
alter function private.update_event_draft(uuid, uuid, jsonb, jsonb) set search_path = '';
alter function private.transition_event(
  uuid, public.event_status[], public.event_status, public.moderation_action, uuid, text, uuid
) set search_path = '';
