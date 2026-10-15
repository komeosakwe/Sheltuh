"use client";

import { useEffect, useState } from "react";
import { formatAudExact, formatChange, formatConversion, formatCount } from "@/lib/analytics-format";
import { ApiError } from "@/lib/api/client";
import type { AnalyticsTotals, EventStatus } from "@/lib/api/types";
import type { Stat } from "./StatGrid";

export const STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  published: "Published",
  rejected: "Rejected",
};

export const backLinkClass = "eyebrow inline-flex min-h-11 w-fit items-center underline underline-offset-4";

type Settled<T> = { key: string; ok: true; data: T } | { key: string; ok: false; error: unknown };

/**
 * Loads `load()` for `key`. While a new key loads, the last good data stays
 * available (`stale` = it belongs to an earlier key), so a range change dims
 * the numbers instead of blanking the page.
 */
export function useKeyedLoad<T>(key: string, load: () => Promise<T>) {
  const [latest, setLatest] = useState<Settled<T> | null>(null);
  const [good, setGood] = useState<{ key: string; data: T } | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (cancelled) return;
        setLatest({ key, ok: true, data });
        setGood({ key, data });
      },
      (error: unknown) => {
        if (!cancelled) setLatest({ key, ok: false, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, load]);

  const settled = latest?.key === key ? latest : null;
  return {
    loading: settled === null,
    error: settled && !settled.ok ? settled.error : null,
    data: good?.data ?? null,
    stale: good !== null && good.key !== key,
  };
}

export type LoadFailure = "forbidden" | "not-found" | "range" | "other";

export function failureKind(error: unknown): LoadFailure {
  if (error instanceof ApiError) {
    if (error.status === 403) return "forbidden";
    if (error.status === 404) return "not-found";
    if (error.status === 400) return "range";
  }
  return "other";
}

/** The API's message for a bad range (400), preferring its field errors. */
export function rangeErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null;
  return error.fieldErrors?.to ?? error.fieldErrors?.from ?? error.message;
}

/**
 * The headline numbers in report order. Views are null (shown as "—") when
 * none of the period was counted; conversion is the API's (null when there
 * were no views or part of the period wasn't counted).
 */
export function buildStats({
  totals,
  previous,
  viewsCounted,
  previousViewsCounted,
  days,
  withFees,
}: {
  totals: AnalyticsTotals;
  previous?: AnalyticsTotals;
  viewsCounted: boolean;
  previousViewsCounted: boolean;
  days: number;
  withFees: boolean;
}): Stat[] {
  const change = (current: number | null, prev: number | null | undefined) => formatChange(current, prev, days);
  const views = viewsCounted ? totals.views : null;
  const prevViews = previous ? (previousViewsCounted ? previous.views : null) : undefined;
  const conversion = viewsCounted ? totals.conversionRate : null;
  const stats: Stat[] = [
    { label: "Views", value: views === null ? null : formatCount(views), change: change(views, prevViews) },
    { label: "Orders", value: formatCount(totals.orders), change: change(totals.orders, previous?.orders) },
    { label: "Conversion", value: formatConversion(conversion) },
    { label: "Tickets sold", value: formatCount(totals.ticketsSold), change: change(totals.ticketsSold, previous?.ticketsSold) },
    { label: "Gross", value: formatAudExact(totals.grossCents), change: change(totals.grossCents, previous?.grossCents) },
  ];
  if (withFees) {
    stats.push({ label: "Fees", value: formatAudExact(totals.feesCents), change: change(totals.feesCents, previous?.feesCents) });
  }
  stats.push({
    label: "Net",
    value: formatAudExact(totals.netCents),
    change: change(totals.netCents, previous?.netCents),
    emphasis: true,
  });
  return stats;
}

/** A row's conversion: the API's rate (null when it would mislead), and none when views weren't counted. */
export function rowConversion(totals: AnalyticsTotals, viewsCounted: boolean): string | null {
  return viewsCounted ? formatConversion(totals.conversionRate) : null;
}
