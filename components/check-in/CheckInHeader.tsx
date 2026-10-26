"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { backLinkClass } from "@/components/analytics/shared";
import { formatCount } from "@/lib/analytics-format";
import type { CheckInSummary } from "@/lib/api/types";
import { checkedInPercent } from "@/lib/check-in/door-copy";
import { DOOR_TIMING } from "@/lib/check-in/timing";
import { formatEventDateTimeRange, formatEventTime } from "@/lib/format";
import type { DoorWayBack } from "./way-back";

/**
 * The way back ("← Your events", or "← Admin door list" for an admin) and
 * the eyebrow, then the event title (§5.A2). The eyebrow
 * carries the date: under "Door check-in" on phones (inside the 44px row, so
 * it costs no height above the scanner), after it from md.
 */
export function CheckInTitle({ summary, wayBack }: { summary: CheckInSummary | null; wayBack: DoorWayBack }) {
  return (
    <header>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Link href={wayBack.href} className={backLinkClass}>
          &larr; {wayBack.label}
        </Link>
        <p className="eyebrow text-right text-muted">
          Door check-in
          {summary && (
            <>
              <span className="block md:hidden">{formatEventDateTimeRange(summary.event.startsAt)}</span>
              <span className="hidden md:inline"> · {formatEventDateTimeRange(summary.event.startsAt)}</span>
            </>
          )}
        </p>
      </div>
      <h1
        className={`mt-1 line-clamp-1 font-heading text-xl leading-5 md:line-clamp-2 md:text-4xl md:leading-[2.125rem] ${
          summary ? "" : "text-muted"
        }`.trim()}
      >
        {summary ? summary.event.title || "Untitled event" : "Loading check-in…"}
      </h1>
    </header>
  );
}

function Bar({ value, total }: { value: number; total: number }) {
  const percent = checkedInPercent(value, total);
  return (
    <div aria-hidden="true" className="h-1 w-full bg-surface-border">
      <div className="h-full bg-foreground" style={{ width: `${percent}%` }} />
    </div>
  );
}

export { Bar as CountBar };

/**
 * The live count (§5.A2), with its own polite announcement: said only when
 * the checked-in number changes (after it settles for 1.5s), never on load.
 */
export function CheckInCounters({
  summary,
  updatedAt,
  refreshFailed,
}: {
  summary: CheckInSummary | null;
  updatedAt: string | null;
  refreshFailed: boolean;
}) {
  const [announcement, setAnnouncement] = useState("");
  const checkedIn = summary?.checkedIn;
  const ticketsSold = summary?.ticketsSold ?? 0;
  const previous = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (checkedIn === undefined) return;
    const before = previous.current;
    previous.current = checkedIn;
    if (before === undefined || before === checkedIn) return;
    const timer = setTimeout(
      () => setAnnouncement(`${formatCount(checkedIn)} of ${formatCount(ticketsSold)} checked in.`),
      DOOR_TIMING.countAnnounceDebounceMs,
    );
    return () => clearTimeout(timer);
  }, [checkedIn, ticketsSold]);

  return (
    <section aria-labelledby="door-count-title">
      <h2 id="door-count-title" className="sr-only">
        Count
      </h2>
      {summary ? (
        <>
          {/* Under sm, capacity joins the muted line so the row stays one line at 320. From sm it's the eyebrow on
              the right, which wraps onto its own line where the column is narrow, as at 768. */}
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <p className="font-heading text-[2.5rem] leading-10 font-extrabold tabular-nums md:text-6xl md:leading-none">
              {formatCount(summary.checkedIn)}
            </p>
            <div className="flex min-w-0 flex-col pb-0.5">
              <p className="text-sm">of {formatCount(summary.ticketsSold)} checked in</p>
              {summary.ticketsSold > 0 ? (
                <p className="text-sm text-muted">
                  {formatCount(Math.max(0, summary.ticketsSold - summary.checkedIn))} to come
                  <span className="sm:hidden"> · capacity {formatCount(summary.capacity)}</span>
                </p>
              ) : (
                <p className="text-sm text-muted sm:hidden">Capacity {formatCount(summary.capacity)}</p>
              )}
            </div>
            <p className="eyebrow ml-auto hidden pb-1 text-muted sm:block">Capacity {formatCount(summary.capacity)}</p>
          </div>
          <div className="mt-2">
            <Bar value={summary.checkedIn} total={summary.ticketsSold} />
          </div>
          {summary.ticketsSold === 0 && (
            <p className="mt-2 text-sm text-muted">No tickets have been sold for this event yet.</p>
          )}
          {refreshFailed && updatedAt && (
            <p className="mt-2 text-xs text-muted">Counts last updated {formatEventTime(updatedAt)}. Retrying…</p>
          )}
        </>
      ) : (
        <div className="flex items-end gap-3">
          <p className="font-heading text-[2.5rem] leading-10 font-extrabold text-muted md:text-6xl md:leading-none">—</p>
          <p className="pb-0.5 text-sm text-muted">checked in</p>
        </div>
      )}
      <p aria-live="polite" aria-atomic="true" className="sr-only" data-testid="count-announcer">
        {announcement}
      </p>
    </section>
  );
}
