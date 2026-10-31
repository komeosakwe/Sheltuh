/**
 * An event's ticketing fields, validated: for the event body
 * (lib/server/event-input.ts) and the admin's ticketing change
 * (handlers/admin.ts, adminSetEventTicketing).
 *
 * Keep this module light: it must never import lib/location.ts (the suburb
 * table, about 290 kB), which event-input.ts does. Handlers that only need
 * ticketing (the admin routes, and through them seating, clips and
 * trending) would otherwise load the table too.
 */
import {
  checkExternalTicketUrl,
  MAX_EXTERNAL_PRICE_FROM_CENTS,
  TICKETING_MODES,
  type TicketingMode,
} from "@/lib/ticketing";

/** Longest reason for an admin's ticketing change (shown in the event's moderation log); also used for seat-map and clip reasons. */
export const MAX_TICKETING_REASON_LENGTH = 500;

/** An event's ticketing, as stored. */
export interface Ticketing {
  ticketingMode: TicketingMode;
  /** The ticket link, as the URL parser writes it (external only; null otherwise). */
  externalTicketUrl: string | null;
  /** External only (false otherwise). */
  externalFree: boolean;
  /**
   * External only: the organiser's "price from", in whole AUD cents (1 to
   * MAX_EXTERNAL_PRICE_FROM_CENTS). Null when none is given, and always for a
   * free or Sheltüh-ticketed event.
   */
  externalPriceFromCents: number | null;
}

/** The body fields parseTicketing reads. */
export interface RawTicketingBody {
  ticketingMode?: unknown;
  externalTicketUrl?: unknown;
  externalFree?: unknown;
  externalPriceFromCents?: unknown;
}

const absent = (value: unknown) => value === undefined || value === null || value === "";

/**
 * `ticketingMode` (absent means `sheltuh`, so clients that predate external
 * ticketing keep working), `externalTicketUrl` and `externalFree`, with
 * errors under those field names. External: a link that passes
 * checkExternalTicketUrl is required, and the stored form is the parser's.
 * Sheltüh: no link and no free flag may be sent (absent, null, "" or false),
 * rather than being silently dropped.
 */
export function parseTicketing(body: RawTicketingBody, errors: Record<string, string>): Ticketing {
  const rawMode = body.ticketingMode ?? "sheltuh";
  if (typeof rawMode !== "string" || !TICKETING_MODES.includes(rawMode as TicketingMode)) {
    errors.ticketingMode = "Choose where tickets are sold.";
    return { ticketingMode: "sheltuh", externalTicketUrl: null, externalFree: false, externalPriceFromCents: null };
  }
  const ticketingMode = rawMode as TicketingMode;

  if (body.externalFree !== undefined && body.externalFree !== null && typeof body.externalFree !== "boolean") {
    errors.externalFree = "Must be true or false.";
  }
  const externalFree = body.externalFree === true;

  if (ticketingMode === "sheltuh") {
    if (!absent(body.externalTicketUrl)) {
      errors.externalTicketUrl = "Only for events whose tickets are sold on another site.";
    }
    if (externalFree) errors.externalFree = "Only for events whose tickets are sold on another site.";
    if (!absent(body.externalPriceFromCents)) {
      errors.externalPriceFromCents = "Only for events whose tickets are sold on another site.";
    }
    return { ticketingMode, externalTicketUrl: null, externalFree: false, externalPriceFromCents: null };
  }

  let externalTicketUrl: string | null = null;
  if (absent(body.externalTicketUrl)) {
    errors.externalTicketUrl = "Enter the address of the page where tickets are sold.";
  } else if (typeof body.externalTicketUrl !== "string") {
    errors.externalTicketUrl = "Enter the ticket page's full address, starting with https://";
  } else {
    const checked = checkExternalTicketUrl(body.externalTicketUrl);
    if (checked.ok) externalTicketUrl = checked.url;
    else errors.externalTicketUrl = checked.message;
  }

  let externalPriceFromCents: number | null = null;
  if (!absent(body.externalPriceFromCents)) {
    const price = body.externalPriceFromCents;
    if (externalFree) {
      errors.externalPriceFromCents = "A free event doesn't have a price.";
    } else if (typeof price !== "number" || !Number.isSafeInteger(price)) {
      errors.externalPriceFromCents = "Enter the price in dollars and cents.";
    } else if (price < 1 || price > MAX_EXTERNAL_PRICE_FROM_CENTS) {
      errors.externalPriceFromCents = "Enter a price between $0.01 and $10,000, or leave it blank.";
    } else {
      externalPriceFromCents = price;
    }
  }
  return { ticketingMode, externalTicketUrl, externalFree, externalPriceFromCents };
}
