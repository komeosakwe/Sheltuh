import type { EventOrderRow } from "@/lib/api/types";
import type { CsvCell } from "./csv";

/**
 * The organiser's CSV of an event's orders (GET .../orders.csv). Built by
 * toCsv/csvResponse (./csv.ts), which quotes every cell and puts a single
 * quote before any text a spreadsheet would read as a formula: a buyer's name
 * or email is typed by the buyer, so "=HYPERLINK(...)", "+61 ...", "-1" and
 * "@x" all arrive as plain text. Money is written as decimal dollars.
 *
 * Names and emails are blank for an order whose details aren't shown
 * (EventOrderRow.buyerName). The short reference is the only order id.
 */

const HEADER: CsvCell[] = ["Reference", "Placed", "Name", "Email", "Tickets", "Paid (A$)", "Refunded (A$)", "Status"];

/** "2026-12-05 19:30" in the event's own zone (what the organiser sees on the page). */
export function placedInZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** "Paid", "Refunded" or "Part refunded", as the page's Status column says it. */
export function orderStatusLabel(row: Pick<EventOrderRow, "status" | "refundedCents">): string {
  if (row.status === "refunded") return "Refunded";
  return row.refundedCents > 0 ? "Part refunded" : "Paid";
}

/** The CSV rows (header first) for `rows`, with times in `timeZone`. */
export function eventOrdersCsv(rows: EventOrderRow[], timeZone: string): CsvCell[][] {
  return [
    HEADER,
    ...rows.map((row): CsvCell[] => [
      row.reference,
      placedInZone(row.placedAt, timeZone),
      row.buyerName,
      row.buyerEmail,
      row.tickets.map((t) => `${t.quantity} × ${t.ticketTypeName}`).join("; "),
      { cents: row.paidCents },
      { cents: row.refundedCents },
      orderStatusLabel(row),
    ]),
  ];
}
