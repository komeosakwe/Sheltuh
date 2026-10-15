import type { AnalyticsDay, DateRange } from "@/lib/api/types";

/**
 * Small readings of the analytics responses shared by both report pages.
 */

/**
 * How much of `range` had page views counted: `all`, `partial` (counting
 * began part-way through, on `viewsTrackedSince`) or `none` (it hadn't begun).
 */
export function viewsCoverage(range: DateRange, viewsTrackedSince: string | null): "all" | "partial" | "none" {
  if (viewsTrackedSince === null || viewsTrackedSince > range.to) return "none";
  return viewsTrackedSince > range.from ? "partial" : "all";
}

/**
 * Optional flag the API may add (not in lib/api/types.ts yet): views on that
 * day (or in that range) hit the per-minute cap, so some weren't counted.
 * Read defensively, so its absence means "reliable".
 */
type MaybeUnreliable = { viewsUnreliable?: unknown };

export function isViewsUnreliable(value: object | undefined | null): boolean {
  return Boolean(value) && (value as MaybeUnreliable).viewsUnreliable === true;
}

/** The days flagged `viewsUnreliable`, oldest first. */
export function unreliableDays(days: readonly AnalyticsDay[]): string[] {
  return days.filter((day) => isViewsUnreliable(day)).map((day) => day.date);
}
