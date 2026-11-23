interface TicketPagerButtonProps {
  direction: "previous" | "next";
  /** At the first (previous) or last (next) ticket: greyed and does nothing, but keeps its focus. */
  atEnd: boolean;
  onMove: () => void;
  /** Its size and colour where it sits (the page's card or the full-screen ticket's black). */
  className: string;
}

/**
 * Previous / Next for a set of tickets, one shown at a time: the My ticket
 * page and the full-screen ticket (docs/design/my-ticket.md §5.12). An arrow
 * on screen, "Previous ticket" / "Next ticket" to screen readers.
 *
 * At either end it's `aria-disabled`, not `disabled`: a disabled button drops
 * the keyboard focus it has, so someone pressing Next to the last ticket would
 * be thrown back to the top of the page. Greyed with text/secondary.
 */
export default function TicketPagerButton({ direction, atEnd, onMove, className }: TicketPagerButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!atEnd) onMove();
      }}
      aria-disabled={atEnd}
      className={`${className} aria-disabled:text-muted`}
    >
      <span aria-hidden="true">{direction === "previous" ? "←" : "→"}</span>
      <span className="sr-only">{direction === "previous" ? "Previous ticket" : "Next ticket"}</span>
    </button>
  );
}
