import { eventZone, formatEventDateKey, formatEventDateShort, formatEventTime, zoneSuffix } from "./format";
import type { TrendingSignal } from "./home-sections";
import { isSoldOut, pricedTicketTypes } from "./pricing";
import { quickBuyHref, quickBuyLabel, type QuickBuyLabel } from "./quick-buy";
import { eventPlaceName, placeNameParts } from "./place";
import { getSampleGoing } from "./sample-going";
import type { StateCode } from "./time-zones";
import { EVENT_CATEGORIES, type SheltuhEvent } from "./types";

/**
 * The pure parts of every event card (docs/design/mobile-redesign.md §2.3,
 * §6.2): EventCard, the map card and the map list row read their labels
 * here, so none keeps its own copy.
 */

/** The category's display label ("Live music"), or its raw value if it's unknown. */
export function categoryLabel(event: SheltuhEvent): string {
  return EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ?? event.category;
}

/**
 * "The Depot Theatre · Coburg, VIC": the parts that exist, never a dangling
 * separator, the suburb with its state (owner decision D4, lib/place.ts).
 * Empty when neither exists.
 */
export function placeLabel(event: SheltuhEvent): string {
  return [event.venueName, eventPlaceName(event)].filter(Boolean).join(" · ");
}

/**
 * placeLabel's parts, for a narrow card that shows the venue and the place
 * on a line each, so the venue never pushes the state out of view, and cuts
 * the suburb's name short but never its state: `{ venue: "The Depot
 * Theatre", place: { suburb: "Coburg", state: "VIC" } }` (venue "" or place
 * null when there's none). Read together, with a hidden " · " between them,
 * they're placeLabel, which stays the accessible text.
 */
export function placeParts(event: SheltuhEvent): { venue: string; place: { suburb: string; state: StateCode } | null } {
  return { venue: event.venueName.trim(), place: placeNameParts(event.suburb, event.state) };
}

/**
 * A start's date and time in the event's own zone. `zone` names any zone but
 * the platform's ("Perth time", zoneSuffix), "" for Melbourne's: kept apart
 * from `time` so a narrow line can wrap before it rather than overflow.
 */
export interface StartLabel {
  date: string;
  time: string;
  zone: string;
}

export type CardDateLabel = StartLabel | { running: string };

/** What a start label needs from an event (a SheltuhEvent, or anything with its start and place). */
export type EventStartFields = Pick<SheltuhEvent, "startsAt" | "timeZone" | "state">;

/**
 * The start's date and time in the event's own zone, with any zone but the
 * platform's named (zoneSuffix): `{ date: "Sat 21 Nov", time: "8:00 pm",
 * zone: "Perth time" }`, and for a Melbourne event exactly as before
 * (`zone: ""`). Every compact event line (cards, map, list rows) uses it.
 */
export function startLabel(event: EventStartFields): StartLabel {
  const zone = eventZone(event.timeZone);
  return {
    date: formatEventDateShort(event.startsAt, zone),
    time: formatEventTime(event.startsAt, zone),
    zone: zoneSuffix(event.timeZone, event.state).trim(),
  };
}

/**
 * startLabel as one line: "Sat 21 Nov, 8:00 pm Perth time". `zone: false`
 * leaves the zone off, for a list whose events are all at one place (the
 * map's spot list).
 */
export function startDateTimeLine(event: EventStartFields, { zone = true }: { zone?: boolean } = {}): string {
  const start = startLabel(event);
  return `${start.date}, ${start.time}${zone && start.zone ? ` ${start.zone}` : ""}`;
}

/**
 * The card's date line, in the event's own zone. An event already under way
 * that ends after `now` says so ("Now on · until Sun 1 Nov", or "Now on ·
 * until 11:00 pm" when it ends today there), since its start date has
 * passed; anything else is the start's date and time. Never "Today!" or a
 * countdown. A time outside the platform's zone names its zone ("8:00 pm
 * Perth time", zoneSuffix); a Melbourne event's line is unchanged.
 */
export function cardDateLabel(event: SheltuhEvent, now: Date): CardDateLabel {
  const zone = eventZone(event.timeZone);
  const suffix = zoneSuffix(event.timeZone, event.state);
  const start = Date.parse(event.startsAt);
  const end = event.endsAt ? Date.parse(event.endsAt) : Number.NaN;
  const nowMs = now.getTime();
  if (event.endsAt && start <= nowMs && end > nowMs) {
    const endsToday = formatEventDateKey(event.endsAt, zone) === formatEventDateKey(now.toISOString(), zone);
    return {
      running: `Now on · until ${endsToday ? `${formatEventTime(event.endsAt, zone)}${suffix}` : formatEventDateShort(event.endsAt, zone)}`,
    };
  }
  return startLabel(event);
}

/** Whether `event` has ended by `now` (an event with no end time ends when it starts). */
export function hasEnded(event: SheltuhEvent, now: Date): boolean {
  return Date.parse(event.endsAt ?? event.startsAt) <= now.getTime();
}

export interface CardCta {
  label: QuickBuyLabel;
  href: string;
  /** `outline` for Join waitlist: a waitlist isn't a purchase, so it doesn't share the orange. */
  tone: "signal" | "outline";
}

/**
 * A card's ticket action from real data only (§6.2.3), or null for none:
 * ended, or no ticket types yet. External events go to the event page's
 * ticket section (which holds the outbound link and its beacon); a seated
 * event on sale goes to its seat page; sold out (and not ended) is Join
 * waitlist. Never a remaining count or any urgency.
 */
export function cardCta(event: SheltuhEvent, now: Date): CardCta | null {
  const label = quickBuyLabel(event, now);
  if (!label) return null;
  return { label, href: quickBuyHref(event), tone: label === "Join waitlist" ? "outline" : "signal" };
}

/**
 * Below this many people no number is shown anywhere (the API withholds it:
 * lib/server/handlers/going.ts). Cards apply it too, so a demo sample or a
 * trending count can never show "1 going".
 */
export const GOING_COUNT_MIN = 3;

/** Demo "N going": the fictional sample list's count (always labelled as a sample where it shows). */
export function demoGoing(eventId: string): { count: number } {
  return { count: getSampleGoing(eventId).count };
}

export interface CardGoing {
  count: number;
  /** A demo sample, never real attendance: the card says so. */
  sample: boolean;
}

/**
 * The attendance on a card (§6.2.5 and its Refinement, 22 Oct 2026): a
 * count only, or null for none (no reserved space). Never faces: list
 * payloads carry no names or profile photos, so a card has nothing real to
 * draw them from. An external event has no Who's Going. Demo cards show the
 * fictional sample's count, flagged `sample`. Live cards show only the
 * server's thresholded trending count. Below GOING_COUNT_MIN, nothing.
 */
export function cardGoing(event: SheltuhEvent, mode: "demo" | "live", signal?: TrendingSignal): CardGoing | null {
  if (event.ticketingMode === "external") return null;
  const going =
    mode === "demo"
      ? { count: demoGoing(event.id).count, sample: true }
      : signal?.kind === "going"
        ? { count: signal.count, sample: false }
        : null;
  return going && going.count >= GOING_COUNT_MIN ? going : null;
}

/**
 * The card's ticket state, from real data only, so each one looks and reads
 * differently: ended, external (sold on another site), coming soon (no
 * tiers yet), sold out (waitlist), seated, free, or paid.
 */
export type CardState = "ended" | "external" | "coming-soon" | "sold-out" | "seated" | "free" | "paid";

export function cardState(event: SheltuhEvent, now: Date): CardState {
  if (hasEnded(event, now)) return "ended";
  if (event.ticketingMode === "external") return "external";
  if (event.ticketTypes.length === 0) return "coming-soon";
  if (isSoldOut(event)) return "sold-out";
  if (event.seating) return "seated";
  return pricedTicketTypes(event).every((ticket) => ticket.priceCents === 0) ? "free" : "paid";
}

/**
 * The trending qualifier on a card's category line: "Just announced", or
 * "Popular" for a "popular" label or an external event's going
 * signal (it has no Who's Going to count). A going signal on a Sheltüh event
 * returns null: its count shows in the going row instead.
 */
export function signalLabel(signal: TrendingSignal, external: boolean): string | null {
  if (signal.kind === "going") return external ? "Popular" : null;
  return signal.kind === "just-announced" ? "Just announced" : "Popular";
}
