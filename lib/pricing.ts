import { calculateBookingFeeCents, calculateOrderSummary } from "./fees";
import { formatAud } from "./format";
import type { SheltuhEvent, TicketType } from "./types";

/** What a buyer actually pays for one ticket of this type, fee included. */
export function getTicketBuyerTotalCents(ticket: TicketType): number {
  return calculateOrderSummary(ticket.priceCents, 1, ticket.feePolicy).totalCents;
}

/**
 * Cheapest buyer-payable total across an event's ticket types. `null` when
 * the event has no ticket types: there's no price yet (not a free event, and
 * never `Math.min()`'s `Infinity`).
 */
export function getMinBuyerTotalCents(event: SheltuhEvent): number | null {
  if (event.ticketTypes.length === 0) return null;
  return Math.min(...event.ticketTypes.map(getTicketBuyerTotalCents));
}

/** Feed label for an event with no ticket types yet. */
export const NO_TICKETS_LABEL = "Tickets coming soon";

/**
 * Feed-card price label, e.g. "Free", "A$32 incl. booking fee", or
 * "From A$32 incl. booking fee" when ticket types vary in price;
 * NO_TICKETS_LABEL when there are no ticket types.
 */
export function formatFeedPrice(event: SheltuhEvent): string {
  const minTotalCents = getMinBuyerTotalCents(event);
  if (minTotalCents === null) return NO_TICKETS_LABEL;
  if (minTotalCents === 0) return "Free";
  const prefix = event.ticketTypes.length > 1 ? "From " : "";
  return `${prefix}${formatAud(minTotalCents)} incl. booking fee`;
}

export interface FeedPriceParts {
  /** The all-inclusive headline, e.g. "Free", "A$55" or "From A$31.70". */
  amount: string;
  /** What the amount includes, e.g. "incl. booking fee" or "No booking fee". */
  note: string;
}

/**
 * The feed price split into a headline amount and a note, for layouts that set
 * them on separate lines (the event page's buy bar). Same minimum buyer total
 * as `formatFeedPrice`, so the number is all-inclusive by construction. `null`
 * when the event has no ticket types, since there's no price to show.
 */
export function formatFeedPriceParts(event: SheltuhEvent): FeedPriceParts | null {
  const minTotalCents = getMinBuyerTotalCents(event);
  if (minTotalCents === null) return null;
  if (minTotalCents === 0) {
    const hasPaid = event.ticketTypes.some((ticket) => ticket.priceCents > 0);
    return { amount: "Free", note: hasPaid ? "Paid tickets incl. booking fee" : "No booking fee" };
  }
  const prefix = event.ticketTypes.length > 1 ? "From " : "";
  return { amount: `${prefix}${formatAud(minTotalCents)}`, note: "incl. booking fee" };
}

/** Per-ticket headline price shown on the event details page. */
export function formatTicketHeadline(ticket: TicketType): string {
  if (ticket.priceCents === 0) return "Free";
  return `${formatAud(getTicketBuyerTotalCents(ticket))} incl. booking fee`;
}

/**
 * Breakdown text explaining the headline price, shown once a ticket is
 * selected. `null` for free tickets, which have no fee to explain.
 */
export function formatTicketBreakdown(ticket: TicketType): string | null {
  if (ticket.priceCents === 0) return null;
  if (ticket.feePolicy === "organiser-absorbs") {
    return `${formatAud(ticket.priceCents)} ticket (booking fee included by organiser)`;
  }
  const feeCents = calculateBookingFeeCents(ticket.priceCents);
  return `${formatAud(ticket.priceCents)} ticket + ${formatAud(feeCents)} booking fee`;
}
