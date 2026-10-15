import type { AnalyticsQuery } from "@/lib/api/types";
import { addDays, formatDateRange, isIsoDay } from "./analytics-format";

/**
 * The analytics date range, as kept in the URL
 * (`?range=7d|30d|90d|12m|all|custom&from=&to=&compare=1`,
 * docs/design/favourites-analytics.md §5.9). Anything invalid falls back to
 * the page's default. Dates are inclusive Melbourne days.
 */

export type RangePreset = "7d" | "30d" | "90d" | "12m" | "all" | "custom";

export interface RangeState {
  preset: RangePreset;
  /** Custom only. */
  from?: string;
  to?: string;
  compare: boolean;
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
  all: "All time",
  custom: "Custom dates",
};

const PRESET_DAYS: Record<"7d" | "30d" | "90d" | "12m", number> = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 };

/** The API refuses ranges longer than this (inclusive days). */
export const MAX_RANGE_DAYS = 731;

export interface RangeOptions {
  allowAllTime: boolean;
  defaultPreset: RangePreset;
}

function isPreset(value: string | null): value is RangePreset {
  return value !== null && value in PRESET_LABELS;
}

export function parseRange(params: URLSearchParams, options: RangeOptions, today: string): RangeState {
  const fallback: RangeState = { preset: options.defaultPreset, compare: false };
  const raw = params.get("range");
  const preset = isPreset(raw) ? raw : options.defaultPreset;
  if (preset === "all" && !options.allowAllTime) return fallback;

  // No earlier period to compare All time with.
  const compare = params.get("compare") === "1" && preset !== "all";

  if (preset !== "custom") return { preset, compare };
  const from = params.get("from");
  const to = params.get("to");
  if (!isIsoDay(from) || !isIsoDay(to) || from > to || to > today) return fallback;
  return { preset, from, to, compare };
}

/** The query string for `range` (no leading "?"). */
export function rangeSearch(range: RangeState): string {
  const qs = new URLSearchParams({ range: range.preset });
  if (range.preset === "custom" && range.from && range.to) {
    qs.set("from", range.from);
    qs.set("to", range.to);
  }
  if (range.compare && range.preset !== "all") qs.set("compare", "1");
  return qs.toString();
}

/** The dates to ask for. All time asks for none (the API's default: the event's whole life). */
export function resolveRange(range: RangeState, today: string): { from?: string; to?: string } {
  if (range.preset === "all") return {};
  if (range.preset === "custom") return { from: range.from, to: range.to };
  return { from: addDays(today, -(PRESET_DAYS[range.preset] - 1)), to: today };
}

export function toQuery(range: RangeState, today: string): AnalyticsQuery {
  const query: AnalyticsQuery = resolveRange(range, today);
  if (range.compare && range.preset !== "all") query.compare = "prevPeriod";
  return query;
}

/** "Last 30 days", "All time", or the custom dates ("1–30 Oct 2026"). */
export function rangeLabel(range: RangeState): string {
  if (range.preset === "custom" && range.from && range.to) return formatDateRange(range.from, range.to);
  return PRESET_LABELS[range.preset];
}
