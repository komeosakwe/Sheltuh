import { checkExternalTicketUrl, TICKETING_MODES, type TicketingMode } from "@/lib/ticketing";
import type { EventCategory, TicketTypeInput } from "./types";
import {
  fail,
  requireCategory,
  requireMelbourneDateTime,
  requireString,
  requireTicketTypes,
} from "./validation";

export interface EventInput {
  title: string;
  description: string;
  category: EventCategory;
  venueName: string;
  venueAddress: string;
  suburb: string;
  startsAt: string;
  endsAt: string;
  /** Always empty for an external event. */
  ticketTypes: TicketTypeInput[];
  ticketingMode: TicketingMode;
  /** The ticket link, as the URL parser writes it (external only; null otherwise). */
  externalTicketUrl: string | null;
  /** External only (false otherwise). */
  externalFree: boolean;
}

/** An event's ticketing, as stored. */
export type Ticketing = Pick<EventInput, "ticketingMode" | "externalTicketUrl" | "externalFree">;

interface RawEventBody {
  title?: unknown;
  description?: unknown;
  category?: unknown;
  venueName?: unknown;
  venueAddress?: unknown;
  suburb?: unknown;
  start?: unknown;
  end?: unknown;
  ticketTypes?: unknown;
  ticketingMode?: unknown;
  externalTicketUrl?: unknown;
  externalFree?: unknown;
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
export function parseTicketing(body: RawEventBody, errors: Record<string, string>): Ticketing {
  const rawMode = body.ticketingMode ?? "sheltuh";
  if (typeof rawMode !== "string" || !TICKETING_MODES.includes(rawMode as TicketingMode)) {
    errors.ticketingMode = "Choose where tickets are sold.";
    return { ticketingMode: "sheltuh", externalTicketUrl: null, externalFree: false };
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
    return { ticketingMode, externalTicketUrl: null, externalFree: false };
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
  return { ticketingMode, externalTicketUrl, externalFree };
}

export function parseEventInput(body: RawEventBody): EventInput {
  const errors: Record<string, string> = {};

  const title = requireString(body.title, "title", errors, 150);
  const description = requireString(body.description, "description", errors, 4000);
  const category = requireCategory(body.category, "category", errors);
  const venueName = requireString(body.venueName, "venueName", errors, 150);
  const venueAddress = requireString(body.venueAddress, "venueAddress", errors, 250);
  const suburb = requireString(body.suburb, "suburb", errors, 100);
  const startsAt = requireMelbourneDateTime(body.start, "start", errors);
  const endsAt = requireMelbourneDateTime(body.end, "end", errors);
  const ticketing = parseTicketing(body, errors);

  // An external event has no Sheltüh ticket types: none may be sent (an
  // absent, null or empty list is fine), rather than being silently dropped.
  let ticketTypes: TicketTypeInput[] = [];
  if (ticketing.ticketingMode === "external" && !errors.ticketingMode) {
    if (!(body.ticketTypes === undefined || body.ticketTypes === null) &&
        !(Array.isArray(body.ticketTypes) && body.ticketTypes.length === 0)) {
      errors.ticketTypes = "Events with tickets sold on another site don't have Sheltüh ticket types.";
    }
  } else {
    ticketTypes = requireTicketTypes(body.ticketTypes, "ticketTypes", errors);
  }

  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors.end = "End time must be after the start time.";
  }

  if (Object.keys(errors).length > 0) fail(errors);

  return {
    title,
    description,
    category,
    venueName,
    venueAddress,
    suburb,
    startsAt: startsAt as string,
    endsAt: endsAt as string,
    ticketTypes,
    ...ticketing,
  };
}
