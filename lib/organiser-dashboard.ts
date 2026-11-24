import { formatCount } from "./analytics-format";
import type { OrganiserEventSummary } from "./api/types";
import { eventZone, formatDayWithYear, formatEventDateKey, formatEventDateShort } from "./format";
import { cachedDateTimeFormat } from "./time-zones";

/**
 * The words on the organiser dashboard's Overview and Events tab (Latte's dashboard frames 430:7340
 * and 433:7341), from the summaries the API sends (lib/api/organiser-summary.ts; docs/architecture.md,
 * "Organiser dashboard summaries"). Nothing here makes a number up: what the API can't say is left
 * out by the caller, never shown as a stand-in.
 */

/**
 * Money on the dashboard's cards: whole dollars as drawn ("A$2,230", "A$0"), with the cents when
 * there are some ("A$2,230.45"), so a total is never rounded into something buyers didn't pay.
 */
export function formatDashMoney(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  const sign = cents < 0 ? "−" : "";
  const dollars = formatCount(Math.abs(whole));
  return rest === 0 ? `${sign}A$${dollars}` : `${sign}A$${dollars}.${String(rest).padStart(2, "0")}`;
}

/** A week's figure on a stat card: "+86" when there's any, "0" when there's none (nothing was added). */
export function formatWeekCount(n: number): string {
  return n > 0 ? `+${formatCount(n)}` : formatCount(Math.max(0, n));
}

type SalesFields = Pick<OrganiserEventSummary, "ticketingMode" | "ticketsSold" | "capacity" | "grossCents" | "free">;

/**
 * An event card's foot: "86 / 120 sold · A$2,230", "12 / 40 sold · Free", "0 / 80 sold · —" (nothing
 * taken yet). An event sold on another site has no Sheltüh sales to count: "Tickets sold elsewhere"
 * ("Free entry" when the organiser marked it free).
 */
export function salesLine(event: SalesFields): string {
  if (event.ticketingMode === "external") return event.free ? "Free entry" : "Tickets sold elsewhere";
  const money = event.free ? "Free" : event.grossCents > 0 ? formatDashMoney(event.grossCents) : "—";
  return `${soldLine(event)} · ${money}`;
}

/** "86 / 120 sold": tickets sold of those on sale, in people. */
export function soldLine(event: Pick<OrganiserEventSummary, "ticketsSold" | "capacity">): string {
  return `${formatCount(event.ticketsSold)} / ${formatCount(event.capacity)} sold`;
}

/** The Performance card's amount: "A$2,230", or "A$0 · free" for a free event. */
export function performanceAmount(event: Pick<OrganiserEventSummary, "free" | "grossCents">): string {
  return event.free ? "A$0 · free" : formatDashMoney(event.grossCents);
}

/**
 * An event card's date and place: "Sat 14 Nov · Interconnect Studio" (with the year when it isn't
 * this year), in the event's own zone. The venue's name, else its suburb.
 */
export function eventMeta(
  event: Pick<OrganiserEventSummary, "startsAt" | "timeZone" | "venueName" | "suburb">,
  now: Date,
): string {
  const parts: string[] = [];
  if (event.startsAt && !Number.isNaN(Date.parse(event.startsAt))) {
    parts.push(formatDayWithYear(event.startsAt, now, eventZone(event.timeZone)));
  }
  const place = event.venueName.trim() || event.suburb.trim();
  if (place) parts.push(place);
  return parts.join(" · ");
}

/** Whole days from `now`'s calendar day to the event's, both in the event's zone. */
function daysUntil(startsAt: string, timeZone: string, now: Date): number {
  const day = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
  return Math.round((day(formatEventDateKey(startsAt, timeZone)) - day(formatEventDateKey(now.toISOString(), timeZone))) / 86_400_000);
}

/**
 * The banner's line (Latte: "Here & Now is 72% sold — 34 tickets left before Saturday."), for the
 * soonest live event that has sold at least one ticket and has some left (the Overview's
 * `highlight`). The percentage is rounded, as drawn (86 of 120: 72%), but never 100% with tickets
 * left or 0% with some sold;
 * the day is "today", "tomorrow", the weekday within the week, else the date ("Sat 12 Dec").
 */
export function highlightLine(
  event: Pick<OrganiserEventSummary, "title" | "ticketsSold" | "capacity" | "startsAt" | "timeZone">,
  now: Date,
): string {
  const capacity = Math.max(event.capacity, 1);
  const sold = Math.min(Math.max(event.ticketsSold, 0), capacity);
  const percent = Math.min(99, Math.max(1, Math.round((sold * 100) / capacity)));
  const left = Math.max(event.capacity - sold, 0);
  const zone = eventZone(event.timeZone);
  const days = daysUntil(event.startsAt, zone, now);
  const when =
    days <= 0
      ? "it starts today"
      : days === 1
        ? "tomorrow"
        : days < 7
          ? cachedDateTimeFormat("en-AU", { timeZone: zone, weekday: "long" }).format(new Date(event.startsAt))
          : formatEventDateShort(event.startsAt, zone);
  return `${event.title} is ${percent}% sold — ${formatCount(left)} ${left === 1 ? "ticket" : "tickets"} left before ${when}.`;
}

/** A week-on-week change pill (Latte: "↑ 15%" green, "↓ 10%" red), with the words a screen reader says. */
export interface DeltaPill {
  direction: "up" | "down" | "flat";
  text: string;
  srText: string;
}

/**
 * The Performance card's pill from the API's `deltaPct` (this week's tickets against the 7 days
 * before, rounded). Null when the week before sold nothing (no percentage means anything then):
 * no pill.
 */
export function deltaPill(deltaPct: number | null): DeltaPill | null {
  if (deltaPct === null || !Number.isFinite(deltaPct)) return null;
  const size = formatCount(Math.abs(Math.round(deltaPct)));
  if (deltaPct > 0) return { direction: "up", text: `↑ ${size}%`, srText: `Up ${size}% on the week before` };
  if (deltaPct < 0) return { direction: "down", text: `↓ ${size}%`, srText: `Down ${size}% on the week before` };
  return { direction: "flat", text: "0%", srText: "No change on the week before" };
}

/** "2 events", "1 event". */
export function eventCount(n: number): string {
  return `${formatCount(n)} ${n === 1 ? "event" : "events"}`;
}
