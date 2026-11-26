import type { EventRecord } from "./api/types";
import { eventZone, formatEventPageWhen, formatTimeZoneLabel } from "./format";
import { displayUrl } from "./link-qr";
import { eventPlaceName } from "./place";

/**
 * The printable QR sign's words (components/dashboard/EventQrSign.tsx;
 * docs/architecture.md, "Event QR codes"). Pure, so the sign's text is
 * testable without a browser. Everything here is plain text: the sign
 * renders it as React text nodes, never as markup.
 */

export type SignPaper = "a4" | "a5";

export const SIGN_PAPERS: readonly SignPaper[] = ["a4", "a5"];

export const SIGN_PAPER_LABEL: Readonly<Record<SignPaper, string>> = { a4: "A4", a5: "A5" };

/**
 * Each paper's print page rule, portrait with no margin (so the browser adds
 * no header or footer, and the sign's own white border is the margin).
 * Constant text, never built from anything an organiser typed.
 */
export const SIGN_PAGE_CSS: Readonly<Record<SignPaper, string>> = {
  a4: "@page { size: A4 portrait; margin: 0; }",
  a5: "@page { size: A5 portrait; margin: 0; }",
};

/** The title's size step: longer titles step down so they fit in a few lines and leave the code its room. */
export type SignTitleSize = "xl" | "lg" | "md" | "sm";

export function signTitleSize(title: string): SignTitleSize {
  const length = [...title].length;
  if (length <= 24) return "xl";
  if (length <= 48) return "lg";
  if (length <= 90) return "md";
  return "sm";
}

export const SCAN_FOR_TICKETS = "Scan for tickets";
export const SCAN_TO_SEE = "Scan to see the event";

/**
 * What scanning gets you: "Scan for tickets" for an event that sells paid
 * tickets on Sheltüh; otherwise (free tickets, or an event ticketed on
 * another site, which the page only links to) "Scan to see the event".
 */
export function signCallToAction(event: Pick<EventRecord, "ticketingMode" | "ticketTypes">): string {
  if (event.ticketingMode === "external") return SCAN_TO_SEE;
  return event.ticketTypes.some((ticket) => ticket.priceCents > 0) ? SCAN_FOR_TICKETS : SCAN_TO_SEE;
}

export interface SignText {
  /** As entered, whitespace collapsed ("Untitled event" when empty). */
  title: string;
  titleSize: SignTitleSize;
  /** The event page's date line, in the event's own zone: "Fri 25 Sep, 8:00 pm – 11:00 pm". */
  when: string;
  /** The zone it's in, as the event page names it: "Melbourne time (AEDT)". */
  zone: string;
  /** "The Tote, Collingwood, VIC": the venue's name and the suburb (either may be missing). */
  place: string;
  action: string;
  /** "sheltuh.com.au/events/neon-static": the code's address without the scheme or `?ref=`. */
  address: string;
}

/** Everything the sign says, for `event` and the URL its code opens. */
export function signText(
  event: Pick<EventRecord, "title" | "startsAt" | "endsAt" | "timeZone" | "state" | "venueName" | "suburb" | "ticketingMode" | "ticketTypes">,
  url: string,
): SignText {
  const title = event.title.replace(/\s+/g, " ").trim() || "Untitled event";
  const zone = eventZone(event.timeZone);
  return {
    title,
    titleSize: signTitleSize(title),
    when: formatEventPageWhen(event.startsAt, event.endsAt, zone),
    zone: formatTimeZoneLabel(event.startsAt, zone, event.state),
    place: [event.venueName.trim(), eventPlaceName(event)].filter(Boolean).join(", "),
    action: signCallToAction(event),
    address: displayUrl(url),
  };
}
