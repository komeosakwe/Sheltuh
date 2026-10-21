"use client";

import { useState, type PointerEvent } from "react";
import { useIsPhone } from "@/components/ui/useIsPhone";
import { bucketSeries, chooseBucket, niceMax, type ChartPoint } from "@/lib/analytics-chart";
import { daysInRange, formatCount, formatDateRangeLong } from "@/lib/analytics-format";
import type { DateRange } from "@/lib/api/types";

const SLOT = 10;
const BAR = 7; // 70% of the slot
const HEIGHT = 100;

function totalOf(points: ChartPoint[]): number | null {
  const counted = points.map((p) => p.value).filter((v): v is number => v !== null);
  return counted.length === 0 ? null : counted.reduce((a, b) => a + b, 0);
}

/** The previous period as polyline segments (a gap wherever it wasn't counted). */
function previousSegments(points: ChartPoint[], max: number): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, i) => {
    if (point.previous === null || point.previous === undefined) {
      if (current.length) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${i * SLOT + SLOT / 2},${HEIGHT - (point.previous / max) * HEIGHT}`);
  });
  if (current.length) segments.push(current.join(" "));
  return segments;
}

/**
 * One measure over time as ink bars (docs/design/favourites-analytics.md
 * §5.11), with the previous period as a dashed line when comparing. Small
 * multiples, never a dual axis. Axis text is HTML so it doesn't stretch with
 * the plot. The bars aren't tab stops: the numbers table after the charts is
 * the keyboard and screen-reader path, and the SVG has a summary label.
 */
export default function TimeSeriesChart({
  title,
  unit,
  range,
  dates,
  values,
  previous,
  previousLabel,
  emptyText,
  footnote,
}: {
  /** "Page views". */
  title: string;
  /** Plural unit for the readout: "views", "tickets". */
  unit: string;
  range: DateRange;
  dates: readonly string[];
  values: readonly (number | null)[];
  previous?: readonly (number | null)[];
  /** "Previous 30 days". */
  previousLabel?: string;
  emptyText: string;
  footnote?: string;
}) {
  const phone = useIsPhone();
  const [hover, setHover] = useState<number | null>(null);
  const bucket = chooseBucket(dates.length, phone);
  const points = bucketSeries(dates, values, bucket, previous);
  const n = Math.max(points.length, 1);
  const total = totalOf(points);
  const peak = points.reduce<ChartPoint | null>(
    (best, p) => (p.value !== null && p.value > 0 && (best === null || p.value > (best.value ?? 0)) ? p : best),
    null,
  );
  const highestValue = Math.max(0, ...points.map((p) => Math.max(p.value ?? 0, p.previous ?? 0)));
  const max = niceMax(highestValue);
  const empty = points.every((p) => !p.value);
  const caption = `${title} per ${bucket}`;
  const comparing = Boolean(previous && previousLabel);

  const summary = [
    `${caption}, ${formatDateRangeLong(range.from, range.to)}.`,
    total === null ? "Not counted." : `Total ${formatCount(total)}.`,
    peak ? `Highest ${formatCount(peak.value ?? 0)} on ${peak.longLabel}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const middle = n >= 14 ? Math.floor((n - 1) / 2) : null;
  const hovered = hover !== null ? points[hover] : undefined;

  function onPointer(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const index = Math.floor(((event.clientX - box.left) / box.width) * n);
    setHover(Math.min(n - 1, Math.max(0, index)));
  }

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-4">
          <h3 className="font-sans text-sm font-semibold normal-case tracking-normal">{caption}</h3>
          <span className="text-sm tabular-nums">{total === null ? "—" : formatCount(total)}</span>
        </span>
        {peak && (
          <span className="text-xs text-muted">
            Highest: {formatCount(peak.value ?? 0)} on {peak.label}
          </span>
        )}
        {comparing && (
          <span aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted sm:hidden">
            <span className="inline-flex items-center gap-2">
              <span className="size-3 bg-foreground" />
              This period
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="w-4 border-t-[1.5px] border-dashed border-muted" />
              {previousLabel}
            </span>
          </span>
        )}
      </figcaption>

      {/* Readout for the bar under the pointer (the table carries the same numbers). */}
      <p aria-hidden="true" className="min-h-4 text-xs text-muted tabular-nums">
        {hovered
          ? `${hovered.label}: ${hovered.value === null ? "not counted" : `${formatCount(hovered.value)} ${unit}`}${
              comparing && hovered.previous !== undefined
                ? ` (previous ${hovered.previous === null ? "not counted" : formatCount(hovered.previous)})`
                : ""
            }`
          : ""}
      </p>

      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-right text-xs text-muted tabular-nums" aria-hidden="true">
          <span>{formatCount(max)}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            className="relative"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setHover(null)}
          >
            <svg
              role="img"
              aria-label={summary}
              viewBox={`0 0 ${n * SLOT} ${HEIGHT}`}
              preserveAspectRatio="none"
              className="block h-[120px] w-full overflow-visible sm:h-[160px]"
            >
              {[0, HEIGHT / 2, HEIGHT].map((y) => (
                <line
                  key={y}
                  x1={0}
                  x2={n * SLOT}
                  y1={y}
                  y2={y}
                  vectorEffect="non-scaling-stroke"
                  className="stroke-surface-border"
                  strokeWidth={1}
                />
              ))}
              {points.map((point, i) => {
                if (!point.value) return null;
                const h = Math.max((point.value / max) * HEIGHT, 1);
                return (
                  <rect
                    key={point.key}
                    x={i * SLOT + (SLOT - BAR) / 2}
                    y={HEIGHT - h}
                    width={BAR}
                    height={h}
                    className="fill-foreground"
                  />
                );
              })}
              {comparing &&
                previousSegments(points, max).map((segment) => (
                  <polyline
                    key={segment}
                    points={segment}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    className="stroke-muted"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                ))}
            </svg>
            {hover !== null && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
                style={{ left: `${((hover + 0.5) / n) * 100}%` }}
              />
            )}
            {empty && (
              <p className="absolute inset-0 flex items-center justify-center text-center text-sm text-muted">
                {emptyText}
              </p>
            )}
          </div>
          {comparing && (
            <span aria-hidden="true" className="absolute -top-5 right-0 hidden text-xs text-muted sm:block">
              {previousLabel}
            </span>
          )}
          <div aria-hidden="true" className="relative mt-1 h-4 text-xs text-muted tabular-nums">
            <span className="absolute left-0">{points[0]?.label}</span>
            {middle !== null && (
              <span className="absolute -translate-x-1/2" style={{ left: `${((middle + 0.5) / n) * 100}%` }}>
                {points[middle]?.label}
              </span>
            )}
            {points.length > 1 && <span className="absolute right-0">{points[points.length - 1]?.label}</span>}
          </div>
        </div>
      </div>
      {footnote && <p className="text-xs text-muted">{footnote}</p>}
    </figure>
  );
}

/** Days in a range, for "Previous {n} days" labels. */
export function previousLabelFor(range: DateRange): string {
  const days = daysInRange(range.from, range.to);
  return days === 1 ? "Previous day" : `Previous ${formatCount(days)} days`;
}
