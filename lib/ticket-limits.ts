/**
 * Per-booking ticket limits for general admission tiers, shared by the
 * ticket selector and the seat page's general admission steppers (a mixed
 * event). The checkout API enforces the same numbers.
 */
import type { TicketType } from "./types";

/** At most this many of one ticket type per booking. */
export const MAX_QUANTITY_PER_TYPE = 8;

export type Quantities = Record<string, number>;

/** How many free tickets `quantities` holds across `ticketTypes`. */
export function freeTicketsIn(ticketTypes: TicketType[], quantities: Quantities): number {
  return ticketTypes.reduce((n, t) => n + (t.priceCents === 0 ? (quantities[t.id] ?? 0) : 0), 0);
}

/**
 * A ticket type's own limit per booking: its capacity, what's left when the
 * server says (`remaining`, only sent at 10 or fewer), and at most
 * MAX_QUANTITY_PER_TYPE. `quantityAvailable` is the capacity, not what's
 * still unsold, so "Only N left" comes from `remaining` alone.
 */
export function ownLimit(ticket: TicketType): number {
  return Math.min(ticket.quantityAvailable, ticket.remaining ?? Infinity, MAX_QUANTITY_PER_TYPE);
}

export function ownLimitHint(ticket: TicketType): string {
  const perBooking = `Up to ${ownLimit(ticket)} per booking.`;
  if (ticket.remaining === undefined || ticket.remaining <= 0) return perBooking;
  // "Only 3 left." says the limit on its own; "Only 9 left. Up to 8 per booking." when both bite.
  const left = `Only ${ticket.remaining} left.`;
  return ownLimit(ticket) < ticket.remaining ? `${left} ${perBooking}` : left;
}

/** The server said 10 or fewer are left (and some are). */
export const isLow = (ticket: TicketType) => ticket.remaining !== undefined && ticket.remaining > 0;
