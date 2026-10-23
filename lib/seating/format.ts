/**
 * Saying a seat the same way everywhere (docs/design/seating.md §1.5 and
 * §5.15): the seat page, the summary, the ticket stub, the email and the
 * door. Pure, shared by the browser and the server (ticket and confirmation
 * emails).
 */
import type { SeatKind } from "./template";

export interface SeatLineInput {
  section: string;
  /** Empty when the row has no name. */
  row: string;
  seat: string;
  kind?: SeatKind;
}

function seatWord(kind: SeatKind | undefined): string {
  return kind === "wheelchair" ? "Wheelchair space" : "Seat";
}

/** "Stalls · Row F · Seat 12"; "Box A · Seat 3" with no row name; "Stalls · Row F · Wheelchair space 3". */
export function formatSeatLine(seat: SeatLineInput): string {
  return [seat.section, ...(seat.row ? [`Row ${seat.row}`] : []), `${seatWord(seat.kind)} ${seat.seat}`].join(" · ");
}

/** "Stalls, Row F, Seat 12": the words screen readers and the door announcer say. */
export function speakSeatLine(seat: SeatLineInput): string {
  return [seat.section, ...(seat.row ? [`Row ${seat.row}`] : []), `${seatWord(seat.kind)} ${seat.seat}`].join(", ");
}

/** Sorts seats by section, row, then seat, comparing numbers as numbers ("Seat 2" before "Seat 10"). */
export function compareSeats(a: SeatLineInput, b: SeatLineInput): number {
  const collator = new Intl.Collator("en-AU", { numeric: true, sensitivity: "base" });
  return collator.compare(a.section, b.section) || collator.compare(a.row, b.row) || collator.compare(a.seat, b.seat);
}
