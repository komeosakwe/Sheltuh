/**
 * Group tickets: one ticket type that admits several people ("Group of 4").
 * Shared by the server (records, emails, passes) and the UI, so a group reads
 * the same everywhere (docs/architecture.md, "Group tickets").
 *
 * Capacity is counted in PEOPLE (`quantityAvailable`, `remaining`, door
 * counts); a booking's `quantity` counts groups. One ticket code is issued per
 * person.
 */
import type { TicketGroup } from "./api/types";
import { calculateOrderSummary } from "./fees";
import { formatAud } from "./format";
import type { TicketType } from "./types";

/** The smallest group (one ticket admitting 2 people) and the largest. */
export const MIN_GROUP_SIZE = 2;
export const MAX_GROUP_SIZE = 10;

/** How many people one ticket of this type admits: 1 unless it's a group ticket. */
export function admitsOf(ticket: { admits?: number }): number {
  return typeof ticket.admits === "number" && ticket.admits > 1 ? ticket.admits : 1;
}

export const isGroupTicket = (ticket: { admits?: number }) => admitsOf(ticket) > 1;

/** People admitted by `units` tickets of this type (units are groups for a group ticket). */
export function peopleFor(ticket: { admits?: number }, units: number): number {
  return units * admitsOf(ticket);
}

/** Whole groups in a count of people (`remaining`, `quantityAvailable`): never a part of one. */
export function groupsIn(ticket: { admits?: number }, people: number): number {
  return Math.floor(people / admitsOf(ticket));
}

/** "Group of 4". */
export function groupOfLabel(admits: number): string {
  return `Group of ${admits}`;
}

/** "4 tickets": what one group of 4 gets the buyer. */
export function groupTicketsLabel(admits: number): string {
  return `${admits} ticket${admits === 1 ? "" : "s"}`;
}

/** "2 of 4": a person's place in their group (CustomerTicket.group). */
export function groupPositionLabel(group: TicketGroup): string {
  return `${group.position} of ${group.size}`;
}

/** "Group of 4 (2 of 4)": the ticket type's name, then the person's place in their group; just the name for a single ticket. */
export function ticketNameWithGroup(typeName: string, group?: TicketGroup): string {
  return group ? `${typeName} (${groupPositionLabel(group)})` : typeName;
}

/**
 * Numbers the people of each group: `tickets` in their order in the order's
 * response (by ticket type, then code), the first `size` tickets of a type are
 * one group, the next `size` another. A ticket without a `groupSize` isn't
 * part of one. The server, the door list, the email and the wallet pass all
 * read it, so keep that order.
 */
export function withGroupPositions<T extends { ticketTypeId: string; groupSize?: number | null }>(
  tickets: readonly T[],
): (T & { group?: TicketGroup })[] {
  const seen = new Map<string, number>();
  return tickets.map((ticket) => {
    const index = seen.get(ticket.ticketTypeId) ?? 0;
    seen.set(ticket.ticketTypeId, index + 1);
    const size = ticket.groupSize;
    if (typeof size !== "number" || size < 2) return ticket;
    return { ...ticket, group: { position: (index % size) + 1, size } };
  });
}

export interface GroupSaving {
  /** What the group saves against buying the same number of the cheapest single, all-inclusive. Always above 0. */
  savingCents: number;
  /** The single ticket it's compared with. */
  single: TicketType;
}

/** What a buyer pays for one ticket of this type, fee included (a group ticket: the whole group; as lib/pricing.ts getTicketBuyerTotalCents). */
const buyerTotal = (ticket: TicketType) => calculateOrderSummary(ticket.priceCents, 1, ticket.feePolicy).totalCents;

/** A tier a buyer can order now: not sold out, not waiting for another, no seat. */
const onSale = (ticket: TicketType) => !ticket.soldOut && !ticket.opensAfter && !ticket.seated;

/**
 * What a group ticket saves: its size times the cheapest general admission
 * single on sale that has at least that many left, less the group's own buyer
 * total (getTicketBuyerTotalCents, booking fees as the buyer pays them). `null`
 * when it isn't a group, when there is no such single, or when it saves
 * nothing: a saving is only ever shown when it's real.
 */
export function groupSaving(group: TicketType, ticketTypes: readonly TicketType[]): GroupSaving | null {
  const size = admitsOf(group);
  if (size < 2) return null;
  let best: TicketType | undefined;
  for (const ticket of ticketTypes) {
    if (ticket.id === group.id || admitsOf(ticket) !== 1 || !onSale(ticket)) continue;
    // `remaining` is only sent at 10 or fewer: absent means more than that are left.
    if (ticket.remaining !== undefined && ticket.remaining < size) continue;
    if (best === undefined || buyerTotal(ticket) < buyerTotal(best)) best = ticket;
  }
  if (best === undefined) return null;
  const savingCents = size * buyerTotal(best) - buyerTotal(group);
  return savingCents > 0 ? { savingCents, single: best } : null;
}

/** "save A$22.70", or null when it saves nothing. */
export function groupSavingLabel(group: TicketType, ticketTypes: readonly TicketType[]): string | null {
  const saving = groupSaving(group, ticketTypes);
  return saving ? `save ${formatAud(saving.savingCents)}` : null;
}
