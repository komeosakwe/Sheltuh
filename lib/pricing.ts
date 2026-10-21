import { calculateBookingFeeCents, calculateOrderSummary } from "./fees";
import { formatAud } from "./format";
import { ticketProviderName } from "./ticketing";
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

const isExternal = (event: SheltuhEvent) => event.ticketingMode === "external";

/** An external event's ticketing site for "Tickets on {provider}": a known site's name, else "the organiser's site". */
export function externalProviderLabel(event: SheltuhEvent): string {
  const known =
    event.externalProvider ?? (event.externalTicketUrl ? ticketProviderName(event.externalTicketUrl) : null);
  return known ?? "the organiser's site";
}

/**
 * Feed-card price label, e.g. "Free", "A$32 incl. booking fee", or
 * "From A$32 incl. booking fee" when ticket types vary in price;
 * NO_TICKETS_LABEL when there are no ticket types. An event ticketed on
 * another site shows where tickets are sold, never a price we can't vouch
 * for (docs/design/home.md §5.7): "Tickets on Humanitix", or "Free · Tickets
 * on the organiser's site" when its organiser says entry is free.
 */
export function formatFeedPrice(event: SheltuhEvent): string {
  if (isExternal(event)) {
    const where = `Tickets on ${externalProviderLabel(event)}`;
    return event.externalFree ? `Free · ${where}` : where;
  }
  const minTotalCents = getMinBuyerTotalCents(event);
  if (minTotalCents === null) return NO_TICKETS_LABEL;
  if (minTotalCents === 0) return "Free";
  const prefix = event.ticketTypes.length > 1 ? "From " : "";
  return `${prefix}${formatAud(minTotalCents)} incl. booking fee`;
}

export interface FeedPriceParts {
  /** The all-inclusive headline, e.g. "Free", "A$55" or "From A$31.70"; or, for an external event, "Tickets on {provider}" when it isn't free. */
  amount: string;
  /** What the amount includes, e.g. "incl. booking fee" or "No booking fee"; where a free external event's tickets are; empty for a paid external event (no price, so nothing to qualify). */
  note: string;
}

/**
 * The feed price split into a headline amount and a note, for layouts that set
 * them apart (the event page's buy bar, cards). Same minimum buyer total as
 * `formatFeedPrice`, so the number is all-inclusive by construction. `null`
 * when a Sheltüh-ticketed event has no ticket types, since there's no price
 * to show. An external event: `Free` + "Tickets on {provider}", or
 * "Tickets on {provider}" alone, never a price.
 */
export function formatFeedPriceParts(event: SheltuhEvent): FeedPriceParts | null {
  if (isExternal(event)) {
    const where = `Tickets on ${externalProviderLabel(event)}`;
    return event.externalFree ? { amount: "Free", note: where } : { amount: where, note: "" };
  }
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
