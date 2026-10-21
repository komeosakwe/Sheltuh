/**
 * The seat map at the API boundary: bodies of up to 1 MB (a 10,000-seat map
 * is about 0.7 MB as the editor sends it), checked with the same validator the
 * editor runs (lib/seating/template.ts) against the event's own ticket types.
 */
import { MAX_SEATS_PER_ORDER, SEAT_MAP_ID_PATTERN, validateSeatMapTemplate, type SeatMapTemplate } from "@/lib/seating/template";
import { HttpError } from "./http";
import type { TicketTypeInput } from "./types";
import { fail } from "./validation";

/** Seat map bodies only; every other JSON route keeps MAX_JSON_BODY_BYTES (256 KB). */
export const MAX_SEAT_MAP_BODY_BYTES = 1024 * 1024;

/**
 * `raw` as a stored template, or a 400 with the validator's field errors
 * (each prefixed `template.`). Seats may only use `ticketTypes`' ids.
 */
export function parseSeatMapTemplate(
  raw: unknown,
  ticketTypes: TicketTypeInput[],
): { template: SeatMapTemplate; seatCount: number } {
  const checked = validateSeatMapTemplate(raw, { ticketTypeIds: ticketTypes.map((t) => t.id) });
  if (!checked.ok) {
    const fieldErrors: Record<string, string> = {};
    for (const [path, message] of Object.entries(checked.errors)) {
      fieldErrors[path === "template" ? "template" : `template.${path}`] = message;
    }
    throw new HttpError(400, "Please fix the seat map.", fieldErrors);
  }
  return { template: checked.template, seatCount: checked.seatCount };
}

/** A checkout's `seats` ({mapVersion, seatIds}): 1–10 distinct well-formed ids. 400 otherwise. */
export function parseCheckoutSeats(raw: unknown): { mapVersion: number; seatIds: string[] } {
  const errors: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail({ seats: "Choose your seats." });
  const { mapVersion, seatIds } = raw as { mapVersion?: unknown; seatIds?: unknown };
  if (typeof mapVersion !== "number" || !Number.isInteger(mapVersion) || mapVersion < 1) {
    errors.seatMapVersion = "Reload the seat map and choose again.";
  }
  if (!Array.isArray(seatIds) || seatIds.length === 0) {
    errors.seats = "Choose at least one seat.";
  } else if (seatIds.length > MAX_SEATS_PER_ORDER) {
    errors.seats = `You can choose up to ${MAX_SEATS_PER_ORDER} seats in one order.`;
  } else if (!seatIds.every((id) => typeof id === "string" && SEAT_MAP_ID_PATTERN.test(id))) {
    errors.seats = "Unknown seat. Reload the seat map and choose again.";
  } else if (new Set(seatIds).size !== seatIds.length) {
    errors.seats = "Each seat can only be chosen once.";
  }
  if (Object.keys(errors).length > 0) fail(errors);
  return { mapVersion: mapVersion as number, seatIds: [...(seatIds as string[])].sort() };
}
