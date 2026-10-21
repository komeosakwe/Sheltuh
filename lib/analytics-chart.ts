import { formatDay, formatDayLong, formatMonth, formatMonthLong, weekStart } from "./analytics-format";

/**
 * Turns the API's daily numbers into chart buckets
 * (docs/design/favourites-analytics.md §5.11): daily up to 62 days, weekly up
 * to 400, monthly beyond. On phones more than 31 days also go weekly.
 */

export type ChartBucket = "day" | "week" | "month";

export interface ChartPoint {
  key: string;
  /** Axis label: "3 Oct", "Week of 6 Oct", "Oct 2026". */
  label: string;
  /** Spoken label: "3 October 2026", "week of 6 October 2026", "October 2026". */
  longLabel: string;
  /** Sum of the counted days; null when none of its days were counted. */
  value: number | null;
  /** The previous period's value at the same position, if comparing. */
  previous?: number | null;
}

export function chooseBucket(days: number, phone: boolean): ChartBucket {
  if (days <= 62) return phone && days > 31 ? "week" : "day";
  if (days <= 400) return "week";
  return "month";
}

function sum(values: (number | null)[]): number | null {
  const counted = values.filter((v): v is number => v !== null);
  return counted.length === 0 ? null : counted.reduce((a, b) => a + b, 0);
}

/**
 * Groups `values` (one per date in `dates`, oldest first) into buckets.
 * `previous` is the previous period's daily values, grouped by the same
 * positions (the nth day of this period lines up with the nth day of that one).
 */
export function bucketSeries(
  dates: readonly string[],
  values: readonly (number | null)[],
  bucket: ChartBucket,
  previous?: readonly (number | null)[],
): ChartPoint[] {
  const groups: { key: string; first: string; indexes: number[] }[] = [];
  dates.forEach((date, index) => {
    const key = bucket === "day" ? date : bucket === "week" ? weekStart(date) : date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.indexes.push(index);
    else groups.push({ key, first: date, indexes: [index] });
  });

  return groups.map(({ key, first, indexes }) => {
    const point: ChartPoint = {
      key,
      label: bucket === "day" ? formatDay(first) : bucket === "week" ? `Week of ${formatDay(key)}` : formatMonth(first),
      longLabel:
        bucket === "day"
          ? formatDayLong(first)
          : bucket === "week"
            ? `week of ${formatDayLong(key)}`
            : formatMonthLong(first),
      value: sum(indexes.map((i) => values[i] ?? null)),
    };
    if (previous) point.previous = sum(indexes.map((i) => previous[i] ?? null));
    return point;
  });
}

/** The axis top: `max` rounded up to 1, 2 or 5 × 10ⁿ (at least 1). */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= max) return step * magnitude;
  }
  return 10 * magnitude;
}
