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

/**
 * The order's tickets sent on (EventOrderRow.holders), one line per holder,
 * as its parts: ["1 ticket sent to Sam Lee", "sam@example.com", "Sent Thu 5
 * Dec"]; the same holder's tickets together (dated by the latest). Holders
 * whose details aren't shown share one line: ["1 ticket sent to someone else
 * (details not shared)", "Sent Thu 5 Dec"]. Empty when none was sent. Dates in
 * the event's zone. The page puts a dot between the parts for the eye and a
 * comma for a screen reader (holderLineText joins them for plain text).
 */
export function orderHolderLines(order: Pick<EventOrderRow, "holders">, timeZone: string, now: Date = new Date()): string[][] {
  const groups = new Map<string, { name: string | null; email: string | null; count: number; latest: string }>();
  for (const h of order.holders ?? []) {
    const key = h.holderName === null ? "" : JSON.stringify([h.holderName, h.holderEmail]);
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      if (Date.parse(h.transferredAt) > Date.parse(group.latest)) group.latest = h.transferredAt;
    } else {
      groups.set(key, { name: h.holderName, email: h.holderEmail, count: 1, latest: h.transferredAt });
    }
  }
  return [...groups.values()].map(({ name, email, count, latest }) => {
    const tickets = `${count} ${count === 1 ? "ticket" : "tickets"}`;
    const sent = `Sent ${formatDayWithYear(latest, now, timeZone)}`;
    if (name === null) return [`${tickets} sent to ${count === 1 ? "someone else" : "other people"} (details not shared)`, sent];
    return [`${tickets} sent to ${name}`, ...(email ? [email] : []), sent];
  });
}

/** One line of orderHolderLines as plain text: its parts joined by " · ". */
export function holderLineText(parts: string[]): string {
  return parts.join(" · ");
}
