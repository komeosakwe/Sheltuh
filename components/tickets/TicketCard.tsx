import Link from "next/link";
import type { ReactNode } from "react";

/** The eight states of UI / Ticket card · 1120. The first four are current tickets; the last four are past. */
export type TicketCardState =
  | "active"
  | "transfer_pending"
  | "checked_in"
  | "changed"
  | "transferred"
  | "cancelled"
  | "refunded"
  | "ended";

const PAST_STATES: readonly TicketCardState[] = ["transferred", "cancelled", "refunded", "ended"];

/** What each state says when the caller gives no words of its own (the frames' copy, without their sample names and amounts). */
const DEFAULT_STATUS: Record<Exclude<TicketCardState, "active">, string> = {
  transfer_pending: "Waiting for them to accept",
  checked_in: "✓ Checked in",
  changed: "This event has changed. Your ticket still works.",
  transferred: "This QR code no longer works",
  cancelled: "Event cancelled",
  refunded: "Refunded",
  ended: "Event ended",
};

/** A link (it navigates) or a button (it acts): the status bar's right-hand action and the Show ticket button. */
export type TicketCardAction = { href: string; onClick?: undefined } | { onClick: () => void; href?: undefined };

interface TicketCardProps {
  state: TicketCardState;
  /** "Sat 14 Nov · 5–9 pm", already formatted in the event's zone. */
  when: string;
  eventTitle: string;
  /** The venue's name, one line. */
  venue?: string;
  /** The event's image, filling the 88px square (an `<EventArt>` or an `<img>`); a muted square without one. */
  image?: ReactNode;
  /** "Alex Chen · Second release", or for a ticket that was sent on, "Sent to Sam Lee · accepted 13 Nov". */
  holder: string;
  /** "1 of 1". */
  count?: string;
  /**
   * The status bar's words: "Waiting for Sam to accept", "✓ Checked in at 7:42 pm", "New time: 6–10 pm. Your ticket
   * still works.", "Refunded A$25.94 on 15 Nov". Every state but Active has a bar; without words it says the
   * state's own (DEFAULT_STATUS). The state is always in words, never colour alone.
   */
  status?: string;
  /** The bar's right-hand action, underlined: "Cancel" (transfer pending), "Details" (changed), "View receipt" (ended). */
  statusAction?: TicketCardAction & { label: string };
  /** "Show ticket →": current tickets only (never drawn on a past card). Left out, the card has no button (the Accept page). */
  showTicket?: TicketCardAction;
  /**
   * The title's heading level where the card sits (the list's sections are h2, so h3 by default), or null for no
   * heading: the My ticket page, where the tickets come before the page's h1, which names the same event.
   */
  headingLevel?: 2 | 3 | 4 | null;
  className?: string;
}

const showTicketClass =
  "label-button flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-signal p-4 text-ink motion-safe:transition-colors motion-safe:duration-200 hover:bg-ink hover:text-signal focus-visible:bg-ink focus-visible:text-signal active:bg-ink active:text-signal";

const statusActionClass = "body-s -my-2 inline-flex min-h-9 shrink-0 items-center font-semibold underline underline-offset-2";

function Action({ action, className, children }: { action: TicketCardAction; className: string; children: ReactNode }) {
  return action.href !== undefined ? (
    <Link href={action.href} className={className}>
      {children}
    </Link>
  ) : (
    <button type="button" onClick={action.onClick} className={className}>
      {children}
    </button>
  );
}

/**
 * The compact ticket card (Latte's UI / Ticket card · 1120; My tickets,
 * Profile, the Accept page). Driven by props alone: it knows nothing about
 * orders or transfers, so each page gives it the words for its state.
 *
 * - **Current tickets** (Active, Transfer pending, Checked in, Changed):
 *   white with a 1px `border/subtle`, black text, and "Show ticket →" (56
 *   tall, orange with a black label; black with an orange label on hover).
 * - **Past tickets** (Transferred, Cancelled, Refunded, Ended):
 *   `surface/muted` with no border, the image at 70% and in greyscale, the
 *   date, venue and holder in `text/secondary`, and no button.
 * - **The status bar** (every state but Active): `surface/muted` on a
 *   current card and white on a past one; black with white text for Checked
 *   in (as the frames, not the handoff's table).
 *
 * The title wraps to two lines, then "…"; the date, venue and holder stay on
 * one line and truncate, so they never push the count out of its row
 * (handoff 1.4). `data-state` carries the state for tests and styling hooks.
 */
export default function TicketCard({
  state,
  when,
  eventTitle,
  venue,
  image,
  holder,
  count,
  status,
  statusAction,
  showTicket,
  headingLevel = 3,
  className = "",
}: TicketCardProps) {
  const past = PAST_STATES.includes(state);
  const Heading = `h${headingLevel ?? 3}` as const;
  const statusText = state === "active" ? null : (status ?? DEFAULT_STATUS[state]);
  const soft = past ? "text-muted" : "text-foreground";
  const statusLook =
    state === "checked_in" ? "bg-ink text-paper" : past ? "bg-card text-foreground" : "bg-surface text-foreground";
  return (
    <article
      data-state={state}
      className={`flex flex-col gap-4 rounded-card p-4 ${past ? "bg-surface" : "border border-surface-border bg-card"} ${className}`.trim()}
    >
      <div className="flex items-center gap-4">
        <div
          className={`size-22 shrink-0 overflow-hidden rounded-control bg-surface-border *:size-full ${past ? "opacity-70 grayscale" : ""}`.trim()}
        >
          {image}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className={`truncate font-mono text-xs leading-4 ${soft}`}>{when}</p>
          <Heading role={headingLevel === null ? "none" : undefined} className="line-clamp-2 text-xl leading-7 font-semibold break-words text-foreground">{eventTitle}</Heading>
          {venue && <p className={`body-s truncate ${soft}`}>{venue}</p>}
        </div>
      </div>
      <div className={`flex items-start justify-between gap-4 ${soft}`}>
        <p className="body-s min-w-0 flex-1 truncate font-semibold">{holder}</p>
        {count && <p className="shrink-0 font-mono text-xs leading-5">{count}</p>}
      </div>
      {statusText && (
        <div data-ticket-status="" className={`flex items-center justify-between gap-3 rounded-control px-3 py-2 ${statusLook}`}>
          <p className="body-s min-w-0 font-semibold break-words">{statusText}</p>
          {statusAction && (
            <Action action={statusAction} className={statusActionClass}>
              {statusAction.label}
            </Action>
          )}
        </div>
      )}
      {showTicket && !past && (
        <Action action={showTicket} className={showTicketClass}>
          Show ticket <span aria-hidden="true">→</span>
        </Action>
      )}
    </article>
  );
}
