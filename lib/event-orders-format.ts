import { formatAud, formatDayWithYear, formatEventTime, zoneSuffix } from "@/lib/format";
import type { EventOrderRow } from "@/lib/api/types";

/** "Paid", "Refunded" or "Part refunded A$10.00": words, never a colour alone. */
export function orderStatusText(order: Pick<EventOrderRow, "status" | "paidCents" | "refundedCents">): string {
  if (order.refundedCents <= 0) return order.status === "refunded" ? "Refunded" : "Paid";
  if (order.refundedCents >= order.paidCents) return "Refunded";
  return `Part refunded ${formatAud(order.refundedCents)}`;
}

/** "2 × General, 1 × VIP". */
export function orderTicketsText(order: Pick<EventOrderRow, "tickets">): string {
  return order.tickets.map((t) => `${t.quantity} × ${t.ticketTypeName}`).join(", ");
}

/** What the buyer paid for the tickets: "Free" for a free order. */
export function orderPaidText(order: Pick<EventOrderRow, "paidCents">): string {
  return order.paidCents > 0 ? formatAud(order.paidCents) : "Free";
}

/** "Fri 25 Sep, 8:05 pm" in the event's zone (the year when it isn't this year; the zone's city when it isn't Melbourne). */
export function orderPlacedText(placedAt: string, timeZone: string, now: Date = new Date()): string {
  return `${formatDayWithYear(placedAt, now, timeZone)}, ${formatEventTime(placedAt, timeZone)}${zoneSuffix(timeZone)}`;
}
