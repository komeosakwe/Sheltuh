import { getMinBuyerTotalCents } from "@/lib/pricing";
import type { SheltuhEvent } from "@/lib/types";

/** Rails need at least this many cards to be worth showing. */
const MIN_RAIL = 2;
const RAIL_MAX = 6;
/** "Free & low-cost": the cheapest all-inclusive ticket is at most this (A$20). */
export const LOW_COST_MAX_CENTS = 2000;

export interface LowCostItem {
  event: SheltuhEvent;
  badge: "free" | "low-cost";
}

export interface HomeSections {
  /** "Up next": the soonest event that hasn't ended. */
  featured?: SheltuhEvent;
  comingUp: SheltuhEvent[];
  month: { title: string; items: SheltuhEvent[] };
  lowCost: LowCostItem[];
}

const MELBOURNE_TZ = "Australia/Melbourne";
const monthKeyFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: MELBOURNE_TZ, year: "numeric", month: "2-digit" });
const monthNameFormatter = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "long" });

/** "2026-10" in Melbourne local time. */
const monthKey = (date: Date) => monthKeyFormatter.format(date).slice(0, 7);

function nextMonthKey(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function monthName(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return monthNameFormatter.format(new Date(Date.UTC(year, month - 1, 15)));
}

function atLeast<T>(items: T[]): T[] {
  return items.length >= MIN_RAIL ? items : [];
}

/**
 * Splits the home page's events into the phone home's sections (see
 * docs/design/mobile-home.md §6). Events that have already ended are dropped
 * first. A rail that would have fewer than two cards comes back empty, which
 * hides it.
 */
export function selectHomeSections(events: SheltuhEvent[], now: Date): HomeSections {
  const nowMs = now.getTime();
  const upcoming = events
    .filter((event) => Date.parse(event.endsAt ?? event.startsAt) >= nowMs)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const featured = upcoming[0];
  const comingUp = atLeast(upcoming.slice(1, 1 + RAIL_MAX));

  const taken = new Set(comingUp.map((event) => event.id));
  if (featured) taken.add(featured.id);
  const rest = upcoming.filter((event) => !taken.has(event.id));
  const inMonth = (key: string) => rest.filter((event) => monthKey(new Date(event.startsAt)) === key).slice(0, RAIL_MAX);

  const thisMonth = monthKey(now);
  let month = { title: "What’s on this month", items: inMonth(thisMonth) };
  if (month.items.length < MIN_RAIL) {
    const next = nextMonthKey(thisMonth);
    month = { title: `What’s on in ${monthName(next)}`, items: atLeast(inMonth(next)) };
  }

  const lowCost = atLeast(
    upcoming
      .filter((event) => event !== featured)
      .map((event) => ({ event, cents: getMinBuyerTotalCents(event) }))
      .filter(({ cents }) => cents <= LOW_COST_MAX_CENTS)
      .slice(0, RAIL_MAX)
      .map(({ event, cents }): LowCostItem => ({ event, badge: cents === 0 ? "free" : "low-cost" })),
  );

  return { featured, comingUp, month, lowCost };
}

/** The wide card's one-line description: up to the first sentence break. */
export function firstSentence(description: string): string {
  const end = description.indexOf(". ");
  return end === -1 ? description : description.slice(0, end + 1);
}
