import { REFUND_POLICY_TIGHTENED_CODE, type RefundPolicy } from "@/lib/refund-policy";
import type { TicketingMode } from "@/lib/ticketing";
import type { AustralianTimeZone, StateCode } from "@/lib/time-zones";
import type { EventCategory } from "@/lib/types";
import { ApiError, apiFetch, type GetToken } from "./client";
import type {
  EventRecord,
  Paginated,
  PublishEventConflictCode,
  PublishEventResponse,
  TicketTypeInput,
  VenueLocationInput,
} from "./types";

export interface EventInput {
  title: string;
  description: string;
  category: EventCategory;
  venueName: string;
  venueAddress: string;
  /**
   * With `state` and `timeZone`: a suburb or locality in that state, as
   * lib/location.ts findLocality finds it with the state after it (the name
   * alone, or the `Locality.name` the API returned, such as "Richmond NSW").
   * It's saved as the locality's display name. Not one in the state:
   * ApiError 400 fieldErrors.suburb ("We couldn't find that suburb in WA.",
   * with "Did you mean …?" when there's a near spelling). Without them, saved
   * as typed (older clients).
   */
  suburb: string;
  /**
   * The event's state or territory (lib/time-zones.ts STATE_CODES), sent
   * together with `timeZone` or not at all; one without the other is
   * ApiError 400 (fieldErrors on the missing one). Neither: Melbourne when
   * creating (VIC, Australia/Melbourne); when editing, the stored state and
   * zone are kept, and `start` / `end` are read in the stored zone. Not one
   * of the codes: 400 fieldErrors.state.
   */
  state?: StateCode;
  /**
   * The zone `start` and `end` are local to: one of ZONES_BY_STATE[state]
   * (defaultTimeZone(state, suburb) is the likely one), else ApiError 400
   * fieldErrors.timeZone. Sent with `state` (see there).
   */
  timeZone?: AustralianTimeZone;
  /**
   * Local to the event's zone (`timeZone`, else the stored or default one).
   * A time the zone skips (the clocks go forward: 2:30 am on the first Sunday
   * of October in Sydney) is ApiError 400 fieldErrors.start / .end; a time it
   * has twice (the clocks go back) is the earlier one.
   */
  start: { date: string; time: string };
  end: { date: string; time: string };
  /** At least one for a Sheltüh-ticketed event; must be empty for an external one. */
  ticketTypes: TicketTypeInput[];
  /**
   * Where tickets are sold. Absent: `sheltuh` when creating; when editing,
   * the stored ticketing is kept (and its link and free flag, unless sent).
   * Once the event has been
   * approved (`EventRecord.ticketingLocked`), changing it or the link is
   * ApiError 409 with fieldErrors on the changed field; only an admin can.
   */
  ticketingMode?: TicketingMode;
  /**
   * `external`: required, the ticket page's https address (no IP address,
   * port, username/password, localhost or link shortener; checked with
   * lib/ticketing.ts checkExternalTicketUrl, whose messages the API returns
   * as fieldErrors.externalTicketUrl). `sheltuh`: absent, null or "".
   */
  externalTicketUrl?: string | null;
  /** `external` only: entry is free. Absent or false for `sheltuh`. */
  externalFree?: boolean;
  /**
   * The refund policy (lib/refund-policy.ts). Absent (or null):
   * `no_change_of_mind` when creating; when editing, the stored policy and
   * days are kept. Any other value: ApiError 400, fieldErrors.refundPolicy.
   * Making the policy of an event with pending or paid orders less generous
   * is ApiError 409 (isRefundPolicyTightenedError).
   */
  refundPolicy?: RefundPolicy;
  /**
   * `days_before`: required, a whole number from 1 to 30 (MIN_REFUND_DAYS,
   * MAX_REFUND_DAYS), else ApiError 400 fieldErrors.refundDays.
   * `no_change_of_mind`: absent or null (the stored days are cleared); a
   * number is a 400 fieldErrors.refundDays. Sent without `refundPolicy`: 400
   * fieldErrors.refundPolicy.
   */
  refundDays?: number | null;
  /**
   * The venue's location (VenueLocationInput: a Google place from
   * lib/api/places.ts, with the organiser's pin once they've checked it, or
   * a manual pin). Absent: kept as stored when editing, none when creating.
   * null: cleared. Publishing or submitting needs a pin (`location_required`).
   */
  location?: VenueLocationInput | null;
}

export async function createEventDraft(input: EventInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>("/events", { method: "POST", body: input, token });
}

export async function updateEventDraft(eventId: string, input: EventInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/events/${eventId}`, { method: "PATCH", body: input, token });
}

/**
 * The error body's `code` (ApiError.body.code) when an event with a paid
 * Sheltüh ticket type can't be submitted, approved or published, or get a new
 * paid ticket type while submitted or published, because the organiser's
 * payouts aren't set up (`OrganiserRecord.payoutsEnabled` false: Stripe
 * Connect at /dashboard/payouts). Always a 409. Free and external events never
 * need payouts, and drafts can always be saved.
 */
export const PAYOUTS_REQUIRED_CODE = "payouts_required";

/** Whether `err` is the 409 with `code: "payouts_required"` (PAYOUTS_REQUIRED_CODE). */
export function isPayoutsRequiredError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.body?.code === PAYOUTS_REQUIRED_CODE;
}

/**
 * Whether `err` is the 409 with `code: "refund_policy_tightened"`
 * (REFUND_POLICY_TIGHTENED_CODE; fieldErrors.refundPolicy carries the
 * message): an edit (the organiser's, of a draft that has orders, or an
 * admin's) would make the refund policy of an event with pending or paid
 * orders less generous (lib/refund-policy.ts, tightensRefundPolicy).
 */
export function isRefundPolicyTightenedError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && err.body?.code === REFUND_POLICY_TIGHTENED_CODE;
}

/**
 * Draft or rejected → pending review. ApiError 409 when it isn't a draft or
 * rejected, or (`code: "payouts_required"`, isPayoutsRequiredError) when it
 * has a paid Sheltüh ticket type and the organiser's payouts aren't set up,
 * or (`code: "location_required"`, publishConflictCode) when it has no
 * confirmed venue location (`location.pin`); 404 unknown event.
 */
export async function submitEventForReview(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/events/${eventId}/submit`, { method: "POST", token });
}

/**
 * Publishes the organiser's draft or rejected event (POST
 * /api/events/{eventId}/publish). Returns the event: `status: "published"`
 * when it went live now (their followers are emailed), or `"pending_review"`
 * when it needs a person first (it's sent to the review queue: their events
 * are reviewed, an admin rejected or unpublished it before, it has a seat
 * map, its ticket link isn't on a known ticketing site, it's their first
 * event with paid Sheltüh tickets, or too many were published in 24 hours),
 * with `reviewReason` (PublishEventReviewReason) saying which. Already
 * published: returned as it is. ApiError
 * 403 not an approved organiser, 404 unknown event, 409 with a `code`
 * (publishConflictCode): `payouts_required` (isPayoutsRequiredError),
 * `event_ended`, `in_review` (already waiting for review), `event_changed`
 * (its ticket link changed meanwhile: reload and try again),
 * `location_required` (no confirmed venue location yet: `location.pin`).
 */
export async function publishEvent(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<PublishEventResponse>(`/events/${encodeURIComponent(eventId)}/publish`, { method: "POST", token });
}

const PUBLISH_CONFLICT_CODES: readonly PublishEventConflictCode[] = [
  "payouts_required",
  "event_ended",
  "in_review",
  "event_changed",
  "location_required",
];

/** The 409's `code` when publishEvent was refused (PublishEventConflictCode), else undefined. */
export function publishConflictCode(err: unknown): PublishEventConflictCode | undefined {
  if (!(err instanceof ApiError) || err.status !== 409) return undefined;
  const code = err.body?.code;
  return PUBLISH_CONFLICT_CODES.find((c) => c === code);
}

export async function listMyEvents(getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<Paginated<EventRecord>>(`/organisers/me/events${qs}`, { token });
}

export async function getMyEvent(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/organisers/me/events/${eventId}`, { token });
}

/** Uploads (or replaces) the event's photo. Returns the updated event, whose `imageUrl` is the new version. */
export async function uploadEventImage(eventId: string, image: Blob, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/events/${eventId}/image`, { method: "PUT", body: image, token });
}

export async function deleteEventImage(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(`/events/${eventId}/image`, { method: "DELETE", token });
}

/**
 * Fetches a not-yet-published event's photo, which needs the owner's token
 * (an <img> tag can't send one), and returns an object URL to preview it.
 */
export async function fetchPrivateEventImage(imageUrl: string, getToken: GetToken): Promise<string> {
  const token = await getToken();
  const res = await fetch(imageUrl, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Couldn't load the image.");
  return URL.createObjectURL(await res.blob());
}
