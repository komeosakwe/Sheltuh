/**
 * Per-booking ticket limits for general admission tiers, shared by the
 * ticket selector and the seat page's general admission steppers (a mixed
 * event). The checkout API enforces the same numbers.
 */
import { admitsOf, groupsIn } from "./ticket-groups";
import type { TicketType } from "./types";

/** At most this many of one ticket type per booking. */
export const MAX_QUANTITY_PER_TYPE = 8;

/**
 * At most this many PEOPLE of one ticket type per order (groups count as the
 * people they admit): the API's rule (lib/server/order-input.ts). The
 * selector's own limit, MAX_QUANTITY_PER_TYPE, is lower for singles.
 */
export const MAX_PEOPLE_PER_TYPE = 20;

export type Quantities = Record<string, number>;

/** How many free tickets `quantities` holds across `ticketTypes`. */
export function freeTicketsIn(ticketTypes: TicketType[], quantities: Quantities): number {
  return ticketTypes.reduce((n, t) => n + (t.priceCents === 0 ? (quantities[t.id] ?? 0) : 0), 0);
}

/**
 * What's left of a ticket type in tickets as a buyer orders them: people for
 * a single ticket, whole groups for a group ticket (`remaining` counts people).
 * Undefined when the server didn't say (more than 10 people are left, or for a
 * group ticket more than MAX_PEOPLE_PER_TYPE).
 */
export function remainingUnits(ticket: TicketType): number | undefined {
  return ticket.remaining === undefined ? undefined : groupsIn(ticket, ticket.remaining);
}

/**
 * A ticket type's own limit per booking, in tickets (groups, for a group
 * ticket): its capacity, what's left when the server says (`remaining`, only
 * sent at 10 or fewer people, or 20 for a group ticket), and at most MAX_QUANTITY_PER_TYPE, or for a
 * group MAX_PEOPLE_PER_TYPE people. `quantityAvailable` is the capacity, not
 * what's still unsold, so "Only N left" comes from `remaining` alone.
 */
export function ownLimit(ticket: TicketType): number {
  const cap = Math.min(MAX_QUANTITY_PER_TYPE, groupsIn({ admits: admitsOf(ticket) }, MAX_PEOPLE_PER_TYPE));
  return Math.min(groupsIn(ticket, ticket.quantityAvailable), remainingUnits(ticket) ?? Infinity, cap);
}

export function ownLimitHint(ticket: TicketType): string {
  const group = admitsOf(ticket) > 1;
  const perBooking = `Up to ${ownLimit(ticket)} per booking.`;
  const left = remainingUnits(ticket);
  if (left === undefined || left <= 0) return perBooking;
  // "Only 3 left." says the limit on its own; "Only 9 left. Up to 8 per booking." when both bite.
  const noun = group ? (left === 1 ? " group" : " groups") : "";
  const only = `Only ${left}${noun} left.`;
  return ownLimit(ticket) < left ? `${only} ${perBooking}` : only;
}

/** The server said 10 or fewer people are left (and some whole tickets are). */
export const isLow = (ticket: TicketType) => (remainingUnits(ticket) ?? 0) > 0;

/** A tier that can't be bought yet (sequential release: it opens when the tier above sells out): the words that stand in for its stepper. */
export function opensWhenText(ticket: TicketType): string | null {
  return ticket.opensAfter ? `Opens after ${ticket.opensAfter.name}` : null;
}
