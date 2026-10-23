import { isSoldOut, pricedTicketTypes } from "./pricing";
import type { SheltuhEvent } from "./types";

export type QuickBuyLabel = "Buy tickets" | "Get tickets" | "Get free tickets" | "Join waitlist" | "Choose seats";

/**
 * The visible label of a card's quick-buy link to `/events/{slug}#tickets`
 * (docs/design/brand-direction-one.md §6.6; wording per the owner, 21 Oct
 * 2026), or null for no link: no ticket types yet (the price line says
 * "Tickets coming soon"), or the event has ended by `now`.
 *
 * "Get free tickets" when every tier is free, otherwise "Buy tickets", in
 * demo mode too (its event page explains nothing is bookable). An external
 * event says "Get tickets" (nothing is bought on Sheltüh; "Get free tickets"
 * when its organiser says entry is free: docs/design/mobile-redesign.md
 * §6.2.3) and still goes to the event page, whose ticket section (like its phone buy bar) is the "Get
 * tickets on {provider}" link out, with its click beacon; the card itself
 * never links out. Sold out (every tier, from the server's `soldOut`): "Join
 * waitlist", to the same section, where the waitlist block is (§6.5, §6.11).
 * A seated event (reserved seating) still on sale: "Choose seats", straight
 * to its seat page (quickBuyHref).
 */
export function quickBuyLabel(event: SheltuhEvent, now?: Date): QuickBuyLabel | null {
  if (now && Date.parse(event.endsAt ?? event.startsAt) <= now.getTime()) return null;
  if (event.ticketingMode === "external") return event.externalFree ? "Get free tickets" : "Get tickets";
  if (event.ticketTypes.length === 0) return null;
  if (isSoldOut(event)) return "Join waitlist";
  if (event.seating) return "Choose seats";
  // The tiers still on sale decide: a sold-out paid tier leaves free tickets only.
  if (pricedTicketTypes(event).every((ticket) => ticket.priceCents === 0)) return "Get free tickets";
  return "Buy tickets";
}

/** Whether a quick buy (or the buy bar) for `event` goes to its seat page: seated and not sold out. */
export function goesToSeatPage(event: SheltuhEvent): boolean {
  return event.ticketingMode !== "external" && Boolean(event.seating) && !isSoldOut(event);
}

/**
 * Where a quick buy (or the event page's buy bar) goes: a seated event still
 * on sale goes straight to `/events/{slug}/seats` (manager decision,
 * docs/design/seating.md §8); everything else to the event page's ticket
 * section (a sold-out seated event's waitlist is there).
 */
export function quickBuyHref(event: SheltuhEvent): string {
  return goesToSeatPage(event) ? `/events/${event.slug}/seats` : `/events/${event.slug}#tickets`;
}
