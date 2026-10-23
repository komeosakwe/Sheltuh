import { formatSeatLine, speakSeatLine, type SeatLineInput } from "@/lib/seating/format";

/**
 * A seat said the same way everywhere (docs/design/seating.md §5.15):
 * "Stalls · Row F · Seat 12" on screen, "Stalls, Row F, Seat 12" to screen
 * readers. Styling comes from `className`.
 */
export default function SeatLine({ seat, className = "" }: { seat: SeatLineInput; className?: string }) {
  return (
    <span className={className} data-seat-line="">
      <span aria-hidden="true">{formatSeatLine(seat)}</span>
      <span className="sr-only">{speakSeatLine(seat)}</span>
    </span>
  );
}
