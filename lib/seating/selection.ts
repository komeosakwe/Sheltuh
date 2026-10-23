/**
 * The seat page's pure logic (docs/design/seating.md): which pattern each
 * price tier gets, the order total for chosen seats, and "Find seats" (the
 * best adjacent seats still available). Shared by the seat page, the
 * organiser's editor preview and their tests. No I/O, no React.
 */
import { calculateOrderSummary, sumOrderSummaries, type OrderSummary } from "@/lib/fees";
import { getTicketBuyerTotalCents } from "@/lib/pricing";
import type { TicketType } from "@/lib/types";
import { compareSeats } from "./format";
import { MAX_SEATED_TIERS, SEAT_PITCH, type FlatSeat, type SeatMapTemplate } from "./template";

/** Tier fills, lightest to darkest (docs/design/seating.md §2.2). Black marks on white, square only. */
export type SeatTreatment = "outline" | "dots" | "hatch" | "cross" | "solid";

const TREATMENTS: Record<number, SeatTreatment[]> = {
  1: ["outline"],
  2: ["outline", "solid"],
  3: ["outline", "hatch", "solid"],
  4: ["outline", "dots", "cross", "solid"],
  5: ["outline", "dots", "hatch", "cross", "solid"],
};

/** The ticket type ids the map's seats use, in map order (each once). */
export function seatedTierIds(template: SeatMapTemplate): string[] {
  const ids = new Set<string>();
  for (const section of template.sections) {
    for (const row of section.rows) for (const seat of row.seats) ids.add(seat.ticketTypeId);
  }
  return [...ids];
}

/**
 * The event's tiers that have seats on the map, cheapest (all-inclusive)
 * first, ties by id: the order the legend lists them and patterns are given
 * out in. A seat pointing at a ticket type the event doesn't have is left out.
 */
export function seatedTiers(ticketTypes: TicketType[], template: SeatMapTemplate): TicketType[] {
  const used = new Set(seatedTierIds(template));
  return ticketTypes
    .filter((ticket) => used.has(ticket.id))
    .sort((a, b) => getTicketBuyerTotalCents(a) - getTicketBuyerTotalCents(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** General admission tiers of a mixed event: the event's tiers with no seats on the map. */
export function generalAdmissionTiers(ticketTypes: TicketType[], template: SeatMapTemplate): TicketType[] {
  const used = new Set(seatedTierIds(template));
  return ticketTypes.filter((ticket) => !used.has(ticket.id));
}

/**
 * Each seated tier's pattern, deterministic so the same event always looks
 * the same (§2.2): tiers sorted cheapest first (as `seatedTiers`), then the
 * table for that many tiers. Maps have at most MAX_SEATED_TIERS tiers; any
 * beyond that (never stored) reuse the five in turn.
 */
export function tierTreatments(sortedTiers: TicketType[]): Map<string, SeatTreatment> {
  const list = TREATMENTS[Math.min(Math.max(sortedTiers.length, 1), MAX_SEATED_TIERS)];
  return new Map(sortedTiers.map((ticket, i) => [ticket.id, list[i % list.length]]));
}

/** A general admission line beside the seats (a mixed event). */
export interface GeneralAdmissionLine {
  ticket: TicketType;
  quantity: number;
}

/**
 * The order total for `seats` (one ticket each, at its tier's price and fee
 * policy) plus any general admission lines, from lib/fees.ts only. Seats
 * whose tier isn't in `tiers` are left out (they can't be bought).
 */
export function seatOrderSummary(
  seats: Pick<FlatSeat, "ticketTypeId">[],
  tiers: Map<string, TicketType>,
  generalAdmission: GeneralAdmissionLine[] = [],
): OrderSummary {
  const counts = new Map<string, number>();
  for (const seat of seats) {
    if (tiers.has(seat.ticketTypeId)) counts.set(seat.ticketTypeId, (counts.get(seat.ticketTypeId) ?? 0) + 1);
  }
  const lines = [...counts].map(([id, count]) => {
    const ticket = tiers.get(id) as TicketType;
    return calculateOrderSummary(ticket.priceCents, count, ticket.feePolicy);
  });
  for (const line of generalAdmission) {
    lines.push(calculateOrderSummary(line.ticket.priceCents, line.quantity, line.ticket.feePolicy));
  }
  return sumOrderSummaries(lines);
}

/** Seats sorted by section, row, then seat (numbers as numbers), as the summary and the stubs list them. */
export function sortSeats<T extends FlatSeat>(seats: T[]): T[] {
  return [...seats].sort(compareSeats);
}

/** Every seat of the map in rows: each row's seats in map order (the order "adjacent" is judged in). */
export function seatRows(seats: FlatSeat[]): FlatSeat[][] {
  const rows: FlatSeat[][] = [];
  let key = "";
  for (const seat of seats) {
    const next = `${seat.sectionId}\u0000${seat.row}`;
    if (next !== key || rows.length === 0) {
      rows.push([]);
      key = next;
    }
    rows[rows.length - 1].push(seat);
  }
  return rows;
}

/** Two seats next to each other in a row: no aisle (a gap wider than half a seat) between them. */
function sideBySide(a: FlatSeat, b: FlatSeat): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= SEAT_PITCH * 1.5;
}

export interface FindSeatsOptions {
  count: number;
  /** Only seats of this ticket type; any price when absent. */
  ticketTypeId?: string;
  /** Whether the seat at a map position can't be chosen right now. */
  isUnavailable: (position: number) => boolean;
}

/**
 * "Find seats" (§5.9): `count` seats side by side in one row, all available,
 * nearest the map's focus point (the stage centre unless the organiser moved
 * it), measured from the group's centre; ties go to the earlier seats in map
 * order. Wheelchair spaces and companion seats are never suggested (they're
 * chosen deliberately, with a confirmation). Null when there's no such group.
 */
export function findBestSeats(template: SeatMapTemplate, seats: FlatSeat[], options: FindSeatsOptions): FlatSeat[] | null {
  const { count, ticketTypeId, isUnavailable } = options;
  if (count < 1) return null;
  const usable = (seat: FlatSeat) =>
    !isUnavailable(seat.position) &&
    !seat.blocked &&
    seat.kind === "standard" &&
    (ticketTypeId === undefined || seat.ticketTypeId === ticketTypeId);
  let best: { seats: FlatSeat[]; score: number } | null = null;
  for (const row of seatRows(seats)) {
    for (let start = 0; start + count <= row.length; start += 1) {
      const group = row.slice(start, start + count);
      if (!group.every(usable)) continue;
      if (!group.every((seat, i) => i === 0 || sideBySide(group[i - 1], seat))) continue;
      const cx = group.reduce((sum, seat) => sum + seat.x, 0) / count;
      const cy = group.reduce((sum, seat) => sum + seat.y, 0) / count;
      const score = Math.hypot(cx - template.focus.x, cy - template.focus.y);
      // Strictly better only: rows are visited in map order, so ties keep the earlier group.
      if (!best || score < best.score - 1e-9) best = { seats: group, score };
    }
  }
  return best ? best.seats : null;
}

/** The map's extent around some seats (their centres), for fitting the view to them. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function seatBounds(seats: Pick<FlatSeat, "x" | "y">[], pad = 0): Bounds | null {
  if (seats.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seat of seats) {
    minX = Math.min(minX, seat.x);
    minY = Math.min(minY, seat.y);
    maxX = Math.max(maxX, seat.x);
    maxY = Math.max(maxY, seat.y);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}
