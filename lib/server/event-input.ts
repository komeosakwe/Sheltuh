import {
  isValidRefundDays,
  MAX_REFUND_DAYS,
  MIN_REFUND_DAYS,
  REFUND_POLICIES,
  type RefundPolicy,
} from "@/lib/refund-policy";
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
  /**
   * Absent when the body didn't send one (parseRefundPolicy): the database
   * then uses the default on create and keeps the stored policy on edit.
   */
  refundPolicy?: RefundPolicy;
  /** With `refundPolicy` only: the days for `days_before`, null for `no_change_of_mind`. */
  refundDays?: number | null;
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
  refundPolicy?: unknown;
  refundDays?: unknown;
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

/** The event's refund policy as parseRefundPolicy returns it: nothing sent, or both fields. */
export type RefundInput = Pick<EventInput, "refundPolicy" | "refundDays">;

/**
 * `refundPolicy` and `refundDays` (lib/refund-policy.ts), with errors under
 * those field names:
 * - neither sent (absent or null): `{}`, so the stored policy is kept on edit
 *   and the default (`no_change_of_mind`) used on create;
 * - `days_before`: `refundDays` must be a whole number from 1 to 30;
 * - `no_change_of_mind`: `refundDays` must be absent or null (it's stored as
 *   null, clearing any days the event had), rather than being silently dropped;
 * - anything else as the policy, or days without a policy, is an error.
 */
export function parseRefundPolicy(body: RawEventBody, errors: Record<string, string>): RefundInput {
  const daysSent = body.refundDays !== undefined && body.refundDays !== null;
  if (body.refundPolicy === undefined || body.refundPolicy === null) {
    if (daysSent) errors.refundPolicy = "Choose a refund policy.";
    return {};
  }
  if (typeof body.refundPolicy !== "string" || !REFUND_POLICIES.includes(body.refundPolicy as RefundPolicy)) {
    errors.refundPolicy = "Choose a refund policy.";
    return {};
  }
  const refundPolicy = body.refundPolicy as RefundPolicy;
  if (refundPolicy === "no_change_of_mind") {
    if (daysSent) errors.refundDays = "Only for refunds up to a number of days before the event.";
    return { refundPolicy, refundDays: null };
  }
  if (!isValidRefundDays(body.refundDays)) {
    errors.refundDays = `Enter a whole number of days from ${MIN_REFUND_DAYS} to ${MAX_REFUND_DAYS}.`;
    return { refundPolicy, refundDays: null };
  }
  return { refundPolicy, refundDays: body.refundDays };
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
  const refund = parseRefundPolicy(body, errors);

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
    ...refund,
  };
}
