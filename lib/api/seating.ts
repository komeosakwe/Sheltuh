/**
 * Reserved seating's API client (docs/architecture.md, "Reserved seating").
 * The map's shape and validator: lib/seating/template.ts; the availability
 * bitmap: lib/seating/availability.ts; seat wording: lib/seating/format.ts.
 */
import { runCheckoutAttempt } from "./checkout-attempt";
import { ApiError, apiFetch, type GetToken } from "./client";
import type {
  CancelOrderResult,
  CheckoutResult,
  CheckoutSeatsInput,
  SeatAvailability,
  SeatErrorDetails,
  SeatMapRecord,
  SeatMapTemplate,
} from "./types";
import type { CheckoutLineItemInput } from "./orders";

async function optionalToken(getToken?: GetToken): Promise<string | undefined> {
  if (!getToken) return undefined;
  try {
    return await getToken();
  } catch {
    return undefined;
  }
}

/**
 * The event's seat map. Public once the event is published: pass `version`
 * (PublicEvent.seating.version) so the CDN and browser can keep it. Before
 * that only the owning organiser or an admin can read it (pass `getToken`).
 * ApiError 404: no map, or not visible to the caller.
 */
export async function getSeatMap(eventId: string, version?: number, getToken?: GetToken) {
  const token = await optionalToken(getToken);
  const qs = version !== undefined ? `?v=${encodeURIComponent(String(version))}` : "";
  return apiFetch<SeatMapRecord>(`/events/${eventId}/seat-map${qs}`, { token });
}

/**
 * Which seats can't be chosen right now (sold, held or blocked, one state):
 * decode `unavailable` with lib/seating/availability.ts against `seatCount`.
 * If `version` isn't the map's you have, reload the map. Poll every 10
 * seconds while the page is visible (the CDN keeps it 5 seconds).
 */
export async function getSeatAvailability(eventId: string, options: { getToken?: GetToken; signal?: AbortSignal } = {}) {
  const token = await optionalToken(options.getToken);
  return apiFetch<SeatAvailability>(`/events/${eventId}/seat-availability`, {
    token,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/**
 * The organiser saves their event's map (draft or rejected, never approved).
 * ApiError 400 fieldErrors `template.…` (the validator's paths), 404, 409
 * locked (approved before), not editable or external.
 */
export async function saveSeatMap(eventId: string, template: SeatMapTemplate, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<SeatMapRecord>(`/events/${eventId}/seat-map`, { method: "PUT", body: { template }, token });
}

/** The organiser removes their event's map (same rules as saving). */
export async function deleteSeatMap(eventId: string, getToken: GetToken) {
  const token = await getToken();
  await apiFetch<void>(`/events/${eventId}/seat-map`, { method: "DELETE", token });
}

/**
 * An admin replaces (`template`) or removes (null) an event's map, any
 * status, while it has no orders; logged with `reason` (1–500 characters).
 * Resolves to the new map, or null after a removal. ApiError 400, 404, 409
 * has orders (fieldErrors.template) or external.
 */
export async function adminSaveSeatMap(
  eventId: string,
  template: SeatMapTemplate | null,
  reason: string,
  getToken: GetToken,
): Promise<SeatMapRecord | null> {
  const token = await getToken();
  if (template === null) {
    await apiFetch<void>(`/admin/events/${eventId}/seat-map`, { method: "DELETE", body: { reason }, token });
    return null;
  }
  return apiFetch<SeatMapRecord>(`/admin/events/${eventId}/seat-map`, { method: "PUT", body: { template, reason }, token });
}

export interface SeatedCheckoutInput {
  seats: CheckoutSeatsInput;
  /** General admission tiers of a mixed event (not seated tiers; they don't count towards the 10 seats). */
  lineItems?: CheckoutLineItemInput[];
  /** Required when the order is free. */
  buyerEmail?: string;
  trackingCode?: string;
}

/**
 * Checkout with seats. Resolves like createCheckoutSession: `{url,
 * holdExpiresAt}` for a paid order (go to Stripe; the seats are held),
 * `{url}` for a free order issued at once (a signed-in member's own verified
 * email: pass `getToken`), or `{status: "confirmation_sent"}` for a guest's
 * free booking (nothing is held until the emailed link is confirmed).
 * ApiError: 400; 404; 409 seats taken (seatErrorDetails(err).seatIds) or the
 * map changed (fieldErrors.seatMapVersion: reload it); 429 too many people
 * checking out (try again in a minute); 503 free bookings busy. Sent with
 * an `Idempotency-Key` like createCheckoutSession (lib/api/checkout-attempt.ts):
 * a double click or a retry never holds the seats twice; the attempt's own
 * codes are in seatErrorDetails(err).code.
 */
export async function createSeatedCheckout(eventId: string, input: SeatedCheckoutInput, getToken?: GetToken) {
  const body = {
    seats: input.seats,
    ...(input.lineItems && input.lineItems.length > 0 ? { lineItems: input.lineItems } : {}),
    ...(input.buyerEmail ? { buyerEmail: input.buyerEmail } : {}),
    ...(input.trackingCode ? { trackingCode: input.trackingCode } : {}),
  };
  return runCheckoutAttempt(eventId, body, async (key) =>
    apiFetch<CheckoutResult>(`/events/${eventId}/checkout`, {
      method: "POST",
      body,
      token: await optionalToken(getToken),
      headers: { "idempotency-key": key },
    }),
  );
}

/**
 * The buyer left Stripe's page (/checkout/cancelled?order={orderId}):
 * cancels the order and releases its seats. Safe to call again. ApiError 404
 * unknown order, 409 still being set up (try again in a moment).
 */
export async function cancelPendingOrder(orderId: string) {
  return apiFetch<CancelOrderResult>(`/orders/by-session/${encodeURIComponent(orderId)}/cancel`, { method: "POST" });
}

/** The seat details of a seated checkout's or confirmation's error (taken seats, the hold cap), if any. */
export function seatErrorDetails(err: unknown): SeatErrorDetails | undefined {
  if (!(err instanceof ApiError) || !err.body) return undefined;
  const { code, seatIds, seats, eventSlug } = err.body as SeatErrorDetails;
  if (code === undefined && seatIds === undefined && seats === undefined) return undefined;
  return {
    ...(code ? { code } : {}),
    ...(Array.isArray(seatIds) ? { seatIds } : {}),
    ...(Array.isArray(seats) ? { seats } : {}),
    ...(typeof eventSlug === "string" ? { eventSlug } : {}),
  };
}
