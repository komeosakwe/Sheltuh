import type { ReactNode } from "react";
import SeatLine from "@/components/seating/SeatLine";
import TicketQr, { PLATE_SIZES } from "@/components/tickets/TicketQr";
import type { TicketGroup, TicketSeat } from "@/lib/api/types";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { eventZone, formatMessageTime } from "@/lib/format";
import { TICKET_CODE_PATTERN } from "@/lib/ticket-code";
import { ticketNameWithGroup } from "@/lib/ticket-groups";

/**
 * Where the ticket is shown, which sets its sizes (Latte's 1120 frames):
 * - `page`: the My ticket page. Compact on phones (the full content width,
 *   358 on a 390 screen: image 96 tall, a 168 QR area, no venue line and no
 *   brightness hint, handoff 2.3); from 768 the image is 128 tall and the QR
 *   198, in the 296 (tablet) or 360 (desktop) column its page gives it.
 * - `screen`: the full-screen ticket on phones, large for scanning (image 84
 *   tall, the QR at 231 / 264).
 */
export type FullTicketSize = "page" | "screen";

interface FullTicketBase {
  size?: FullTicketSize;
  eventTitle: string;
  /** The event's image, filling its box (an `<EventArt>` or an `<img>`). Left out, the ticket has no image row. */
  image?: ReactNode;
  /** "Interconnect Studio · Coburg North" (printed in capitals, as the email ticket). Hidden on the compact phone ticket. */
  venueLine?: string;
  /** DATE and TIME, already formatted in the event's zone: "Sat 14 Nov", "5–9 pm" (lib/ticket-times.ts). */
  date?: string;
  time?: string;
  /** The ticket holder's name, when there is one: its own HOLDER line. */
  holderName?: string;
  typeName: string;
  /** A group ticket's person: "Group of 4 (2 of 4)". */
  group?: TicketGroup;
  /** Its seat, for a reserved-seating event. */
  seat?: TicketSeat;
  /** The event is no longer listed: say so, with the support address, instead of its image, venue, date and time. */
  eventUnlisted?: boolean;
  /** When the ticket was checked in at the door (ISO), or null / unset if it hasn't been. */
  checkedInAt?: string | null;
  /** The event's zone, for the check-in time (the door's clock); absent means Melbourne. */
  timeZone?: string;
  /**
   * The title's heading level where the ticket sits, or null for no heading: the My ticket page, where the
   * tickets come before the page's h1, which names the same event. (Still an h2 underneath, with `role="none"`,
   * so it keeps the headings' type exactly; only the heading semantics go.)
   */
  headingLevel?: 2 | 3 | null;
  className?: string;
}

/** A ticket its holder can use: the QR and backup code. */
interface LiveTicketProps extends FullTicketBase {
  locked?: false;
  /** The ticket's code: the QR carries it, and it's printed under the QR as the backup code. */
  code: string;
  /**
   * Its place in the order, numbered as in the ticket email: "ticket 1 of 2". Left out (a ticket someone was
   * sent: the order's size is the buyer's business), the line is "Show this at the door" alone.
   */
  ticketNumber?: number;
  ticketCount?: number;
}

/**
 * A ticket on offer that hasn't been accepted (the Accept page; the offer email's locked QR): a faint
 * placeholder where the QR goes, which encodes nothing, and "Accept the ticket to get your QR code". No code
 * of any kind is given to it, so none can be shown.
 */
interface LockedTicketProps extends FullTicketBase {
  locked: true;
  code?: never;
  ticketNumber?: never;
  ticketCount?: never;
}

export type FullTicketProps = LiveTicketProps | LockedTicketProps;

/**
 * A QR-like pattern that encodes nothing (three finder squares and a fixed scatter of modules), for a ticket
 * that isn't the viewer's yet. Drawn faint, so it reads as "a QR goes here", never as one to scan.
 */
const LOCKED_SIDE = 25;
/** Inside a finder square or the blank row and column round it. */
const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x > LOCKED_SIDE - 9 && y < 8) || (x < 8 && y > LOCKED_SIDE - 9);
/** A fixed scatter (MurmurHash3's finaliser of the cell's index): the same placeholder every time. */
function scatter(n: number): number {
  let h = Math.imul(n + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const LOCKED_MODULES: readonly (readonly [number, number])[] = Array.from({ length: LOCKED_SIDE * LOCKED_SIDE }, (_, i) => [i % LOCKED_SIDE, Math.floor(i / LOCKED_SIDE)] as const).filter(
  ([x, y]) => !inFinder(x, y) && (scatter(y * LOCKED_SIDE + x) & 1) === 1,
);

function LockedQr({ size }: { size: FullTicketSize }) {
  const finder = (x: number, y: number) => (
    <g key={`${x},${y}`}>
      <path d={`M${x} ${y}h7v7h-7z M${x + 1} ${y + 1}v5h5v-5z`} fillRule="evenodd" />
      <rect x={x + 2} y={y + 2} width={3} height={3} />
    </g>
  );
  return (
    <div className={`${PLATE_SIZES[size]} shrink-0 opacity-15`}>
      <svg aria-hidden="true" data-qr-locked="" viewBox="-4 -4 33 33" shapeRendering="crispEdges" className="block size-full fill-ink">
        {finder(0, 0)}
        {finder(18, 0)}
        {finder(0, 18)}
        {LOCKED_MODULES.map(([x, y]) => (
          <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} />
        ))}
      </svg>
    </div>
  );
}

const labelClass = "font-mono text-xs leading-4 tracking-wider text-muted uppercase";

/** The corner stripes of the email ticket (public/email/ticket/stripes-72.png, redrawn as a vector: four 45° bars). */
function Stripes() {
  return (
    <svg aria-hidden="true" viewBox="0 0 72 14" className="h-3.5 w-18 shrink-0 fill-signal">
      {[0, 18, 36, 54].map((x) => (
        <polygon key={x} points={`${x + 8},0 ${x + 17.5},0 ${x + 3.5},14 ${x - 6},14`} />
      ))}
    </svg>
  );
}

function StubCell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`.trim()}>
      <dt className={labelClass}>{label}</dt>
      <dd className="text-sm leading-5 font-medium break-words text-ink md:text-base md:leading-6">{children}</dd>
    </div>
  );
}

/**
 * One full ticket: the site's version of the email ticket (`ticketCard` in
 * lib/server/ticket-email.ts), which the owner keeps as the one ticket design
 * wherever a full ticket appears (owner rule, 21 Nov 2026; Latte's frames set
 * the sizes and everything around it). A 12px Signal Orange frame, a white
 * inside with the corner stripes and "ADMIT ONE · SHELTÜH", the event's
 * image, the title and venue line, a dashed perforation with a notch each
 * side, DATE / TIME / TICKET (then HOLDER and SEAT), the QR on white with the
 * centre ü, the backup code and "Show this at the door · ticket n of N".
 *
 * It's the same in both themes (a ticket is an object, not a surface:
 * `data-surface="paper"` pins the Light tokens), and the QR is always black on
 * white (TicketQr).
 *
 * A checked-in ticket says so in words on an orange stamp over the QR, with
 * the time on the door's clock; the QR is dimmed behind it (Latte's
 * full-screen Checked in frame). Two differences from that frame, both for
 * WCAG AA contrast: the stamp's text is black, not white (white on Signal
 * Orange is 3.4:1), and the backup code stays at full strength (the frame
 * dims it to 30%, which is 2.1:1; it's still the text the door can type).
 *
 * A code that isn't a real ticket code gets no QR (TicketQr renders nothing):
 * the code alone, as the "Entry code".
 */
export default function FullTicket(props: FullTicketProps) {
  const {
    size = "page",
    eventTitle,
    image,
    venueLine,
    date,
    time,
    holderName,
    typeName,
    group,
    seat,
    eventUnlisted = false,
    checkedInAt,
    timeZone,
    headingLevel = 2,
    className = "",
  } = props;
  const locked = props.locked === true;
  const code = props.locked ? "" : props.code;
  const numbered = !props.locked && props.ticketNumber !== undefined && props.ticketCount !== undefined;
  const hasQr = !locked && TICKET_CODE_PATTERN.test(code);
  const page = size === "page";
  const Heading = `h${headingLevel ?? 2}` as const;
  const side = page ? "px-4 lg:px-6" : "px-4";
  const showEvent = !eventUnlisted;
  const checkedIn = Boolean(checkedInAt);
  return (
    <article
      data-ticket-size={size}
      className={`w-full rounded-card bg-signal p-3 print:break-inside-avoid ${className}`.trim()}
    >
      {/* The Light tokens, pinned (data-surface="paper" also paints its own white, so it's on the inside, not the frame). */}
      <div data-surface="paper" className="relative flex flex-col overflow-hidden rounded-control bg-paper pt-4 pb-5 text-ink">
        <div className={`flex items-center justify-between gap-3 ${side}`}>
          <Stripes />
          <p className="font-mono text-xs leading-4 font-medium tracking-wider whitespace-nowrap">ADMIT ONE · SHELTÜH</p>
        </div>
        {showEvent && image && (
          <div className={`mt-4 ${side}`}>
            <div className={`overflow-hidden rounded bg-surface *:size-full ${page ? "h-24 md:h-32" : "h-21"}`}>{image}</div>
          </div>
        )}
        <Heading role={headingLevel === null ? "none" : undefined} className={`${page ? "mt-6" : "mt-4"} text-center text-2xl leading-8 font-bold break-words ${side}`}>{eventTitle}</Heading>
        {showEvent && venueLine && (
          <p
            className={`mt-2 text-center font-mono text-xs leading-4 font-medium tracking-widest break-words text-signal-text uppercase ${side} ${page ? "max-md:hidden" : ""}`.trim()}
          >
            {venueLine}
          </p>
        )}
        {eventUnlisted && (
          <p className={`mt-2 text-center text-sm leading-5 break-words ${side}`}>
            This event is no longer listed. Contact{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold underline underline-offset-2">
              {SUPPORT_EMAIL}
            </a>{" "}
            if you have questions.
          </p>
        )}
        {/* The perforation: a notch of the frame's orange each side (a disc centred on the edge, clipped to a half). */}
        <div aria-hidden="true" className={`relative flex h-6 items-center px-6 ${page ? "mt-6" : "mt-4"}`}>
          <span className="absolute top-0 -left-3 size-6 rounded-full bg-signal" />
          <span className="absolute top-0 -right-3 size-6 rounded-full bg-signal" />
          <span className="w-full border-t border-dashed border-ink" />
        </div>
        {/* One level of groups (dl > div > dt + dd): DATE, TIME and TICKET share a row; HOLDER and SEAT take their own. */}
        <dl className={`flex flex-wrap gap-4 ${page ? "mt-5" : "mt-4"} ${side}`}>
          {showEvent && date && <StubCell label="Date" className="shrink-0">{date}</StubCell>}
          {showEvent && time && <StubCell label="Time" className="shrink-0">{time}</StubCell>}
          <StubCell label="Ticket" className="flex-1">
            {ticketNameWithGroup(typeName, group)}
          </StubCell>
          {holderName && <StubCell label="Holder" className="basis-full">{holderName}</StubCell>}
          {seat && (
            <StubCell label="Seat" className="basis-full">
              <SeatLine seat={seat} />
            </StubCell>
          )}
        </dl>
        <div className="relative mt-3 flex flex-col items-center">
          {locked ? (
            <>
              <div className={page ? "max-md:pt-px max-md:pb-0.5" : undefined}>
                <LockedQr size={size} />
              </div>
              <p className="mt-2 px-4 text-center text-sm leading-5 font-semibold">Accept the ticket to get your QR code</p>
            </>
          ) : hasQr ? (
            <>
              {/*
                The white around the QR is its quiet zone (it's in the plate), so nothing sits closer than that.
                The box is the plate's own width; on the compact phone ticket it keeps the 168-tall QR area with
                1px above and 2px below, so the 165 plate's top lands on a whole pixel (centred, it sat 1.5px down).
              */}
              <div className={`${page ? "max-md:pt-px max-md:pb-0.5" : ""} ${checkedIn ? "opacity-15" : ""}`.trim() || undefined}>
                <TicketQr code={code} size={size} />
              </div>
              <p className="sr-only">Backup code</p>
            </>
          ) : (
            <p className={`mt-4 ${labelClass}`}>Entry code</p>
          )}
          {!locked && (
            <p className="max-w-full px-4 text-center font-mono text-lg leading-6 font-semibold tracking-widest break-all select-all">{code}</p>
          )}
          {!locked && checkedInAt && (
            <div
              data-ticket-stamp=""
              className={`flex w-fit flex-col items-center rounded-control bg-signal px-6 py-4 text-center text-ink ${hasQr ? "absolute inset-x-4 top-1/2 mx-auto -translate-y-1/2" : "mx-4 mt-3"}`}
            >
              <p className="text-xl leading-7 font-semibold">
                <span aria-hidden="true">✓ </span>Checked in
              </p>
              <p className="text-sm leading-5 font-semibold">{formatMessageTime(checkedInAt, new Date(), eventZone(timeZone))} · Enjoy the night</p>
            </div>
          )}
        </div>
        {!locked && (
          <p className={`mt-2 text-center text-sm leading-5 text-muted ${side}`}>
            Show this at the door{numbered && ` · ticket ${props.ticketNumber} of ${props.ticketCount}`}
          </p>
        )}
        {page && hasQr && !checkedIn && (
          <p className={`mt-3 text-center text-sm leading-5 text-muted max-md:hidden print:hidden ${side}`}>
            Turn your brightness up. If the QR code won’t scan, door staff can type in the backup code.
          </p>
        )}
      </div>
    </article>
  );
}
