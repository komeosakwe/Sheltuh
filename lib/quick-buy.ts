import { isSoldOut, pricedTicketTypes } from "./pricing";
import type { SheltuhEvent } from "./types";

export type QuickBuyLabel = "Buy tickets" | "Get free tickets" | "Join waitlist";

/**
 * The visible label of a card's quick-buy link to `/events/{slug}#tickets`
 * (docs/design/brand-direction-one.md §6.6; wording per the owner, 21 Oct
 * 2026), or null for no link: no ticket types yet (the price line says
 * "Tickets coming soon"), or the event has ended by `now`.
 *
 * "Get free tickets" when every tier is free, otherwise "Buy tickets", in
 * demo mode too (its event page explains nothing is bookable). An external
 * event says "Buy tickets" and still goes to the event page, whose ticket
 * section (like its phone buy bar) is the "Get tickets on {provider}" link
 * out, with its click beacon; the card itself never links out. Sold out
 * (every tier, from the server's `soldOut`): "Join waitlist", to the same
 * section, where the waitlist block is (§6.5, §6.11). Still orange (owner
 * decision 6).
 */
export function quickBuyLabel(event: SheltuhEvent, now?: Date): QuickBuyLabel | null {
  if (now && Date.parse(event.endsAt ?? event.startsAt) <= now.getTime()) return null;
  const external = event.ticketingMode === "external";
  if (!external && event.ticketTypes.length === 0) return null;
  if (isSoldOut(event)) return "Join waitlist";
  // The tiers still on sale decide: a sold-out paid tier leaves free tickets only.
  if (!external && pricedTicketTypes(event).every((ticket) => ticket.priceCents === 0)) return "Get free tickets";
  return "Buy tickets";
}
