/**
 * The 409 for an event without a confirmed venue location
 * (supabase/migrations/20261111000100_event_venue_location.sql; owner
 * decisions A-D1 and A-D3): publishing it, or submitting it for review, needs
 * the organiser's pin (a Google place with its pin checked, or a manual pin).
 *
 * Keep this module light: handlers/event-publish.ts imports it, and must not
 * load handlers/events.ts or ../event-input (the suburb table, lib/location.ts).
 */
import type { PublishEventConflictCode } from "@/lib/api/types";
import { HttpError } from "./http";

/** The error body's `code` (lib/api/types.ts PublishEventConflictCode). */
export const LOCATION_REQUIRED_CODE = "location_required" satisfies PublishEventConflictCode;

export const LOCATION_REQUIRED =
  "Add the venue's location first: find it on Google Maps and check the pin, or drop a pin on the map.";

/** A 409 with `code: "location_required"` and fieldErrors.location. */
export function locationRequired(): HttpError {
  return new HttpError(409, LOCATION_REQUIRED, { location: LOCATION_REQUIRED }, { code: LOCATION_REQUIRED_CODE });
}
