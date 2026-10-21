import type { SheltuhEvent } from "./types";

export type QuickBuyLabel = "Get tickets" | "Get free tickets" | "See tickets";

/**
 * The visible label of a card's quick-buy link to `/events/{slug}#tickets`
 * (docs/design/brand-direction-one.md §6.6), or null for no link: no ticket
 * types yet (the price line says "Tickets coming soon"), or the event has
 * ended by `now`. Demo mode says "See tickets", since nothing is bookable. An
 * external event still goes to the event page, whose ticket section links
 * out. (Sold out, "Join waitlist", needs availability data the list API
 * doesn't send yet.)
 */
export function quickBuyLabel(event: SheltuhEvent, mode: "demo" | "live", now?: Date): QuickBuyLabel | null {
  if (now && Date.parse(event.endsAt ?? event.startsAt) <= now.getTime()) return null;
  const external = event.ticketingMode === "external";
  if (!external && event.ticketTypes.length === 0) return null;
  if (mode === "demo") return "See tickets";
  if (!external && event.ticketTypes.every((ticket) => ticket.priceCents === 0)) return "Get free tickets";
  return "Get tickets";
}
