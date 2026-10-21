"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice, Panel } from "@/components/ui/Section";
import { isViewsUnreliable, unreliableDays, viewsCoverage } from "@/lib/analytics-data";
import { daysInRange, formatAudExact, formatCount, formatDay } from "@/lib/analytics-format";
import { rangeLabel, rangeSearch, toQuery, type RangeState } from "@/lib/analytics-range";
import { downloadEventAnalyticsCsv, getEventAnalytics } from "@/lib/api/analytics";
import type { GetToken } from "@/lib/api/client";
import type { EventAnalytics as Report } from "@/lib/api/types";
import { formatEventDateShort } from "@/lib/format";
import AnalyticsGate, { NotApprovedOrganiser } from "./AnalyticsGate";
import Attendance from "./Attendance";
import DataTable from "./DataTable";
import ExportCsvButton from "./ExportCsvButton";
import { ValueOrNoData } from "./NoData";
import { AnalyticsPrivacyNote, LaterStagesNote, ViewsFootnote } from "./Notes";
import RangeControls from "./RangeControls";
import { STATUS_LABEL, backLinkClass, buildStats, failureKind, rangeErrorMessage, useKeyedLoad } from "./shared";
import StatGrid from "./StatGrid";
import TicketTypeTable from "./TicketTypeTable";
import TimeSeriesChart, { previousLabelFor } from "./TimeSeriesChart";
import TrackingLinks from "./TrackingLinks";
import TrackingLinkStatsTable from "./TrackingLinkStatsTable";
import TrafficSources from "./TrafficSources";
import { useAnalyticsRange } from "./useAnalyticsRange";

/** /dashboard/events/[id]/analytics (docs/design/favourites-analytics.md §5.19). */
export default function EventAnalytics({ eventId }: { eventId: string }) {
  const path = `/dashboard/events/${encodeURIComponent(eventId)}/analytics`;
  return (
    <AnalyticsGate returnTo={path}>{(getToken) => <EventReport eventId={eventId} getToken={getToken} />}</AnalyticsGate>
  );
}

function BackLinks({ eventId }: { eventId: string }) {
  return (
    <nav aria-label="Event" className="mb-6 flex flex-wrap gap-x-6">
      <Link href="/dashboard/analytics" className={backLinkClass}>
        &larr; Analytics
      </Link>
      <Link href={`/dashboard/${encodeURIComponent(eventId)}`} className={backLinkClass}>
        Edit event
      </Link>
    </nav>
  );
}

function EventReport({ eventId, getToken }: { eventId: string; getToken: GetToken }) {
  const { range, setRange, today } = useAnalyticsRange({ allowAllTime: true, defaultPreset: "all" });
  const [attempt, setAttempt] = useState(0);
  const query = useMemo(() => toQuery(range, today), [range, today]);
  const key = `${eventId}|${rangeSearch(range)}|${attempt}`;
  const load = useCallback(() => getEventAnalytics(eventId, getToken, query), [eventId, getToken, query]);
  const { loading, error, data, stale } = useKeyedLoad<Report>(key, load);
  const failure = error ? failureKind(error) : null;
  const label = rangeLabel(range);

  if (failure === "not-found") {
    return (
      <EmptyState
        headingLevel={1}
        title="Event not found"
        action={
          <ButtonLink size="lg" variant="outline" href="/dashboard/analytics">
            Back to analytics
          </ButtonLink>
        }
      >
        It may have been deleted, or it belongs to another organiser account.
      </EmptyState>
    );
  }
  if (failure === "forbidden") {
    return (
      <>
        <h1 className="display-md mb-8">Event analytics</h1>
        <NotApprovedOrganiser />
      </>
    );
  }

  const event = data?.event;
  const showExtras = data !== null || error !== null;
  const controls = (
    <RangeControls
      value={range}
      onChange={setRange}
      allowAllTime
      busy={loading}
      today={today}
      rangeError={rangeErrorMessage(error)}
    />
  );

  return (
    <>
      <BackLinks eventId={eventId} />
      <header className="mb-10 flex flex-col gap-6 sm:mb-14 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex max-w-3xl flex-col gap-3">
          <p className="eyebrow text-muted">Event analytics</p>
          <h1 className="display-md">{event ? event.title || "Untitled event" : "Event analytics"}</h1>
          {event && (
            <p className="text-sm text-muted">
              {[formatEventDateShort(event.startsAt), event.venueName, STATUS_LABEL[event.status]].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {event && data && !error && (
          <div className="flex shrink-0 flex-wrap items-start gap-3">
            {event.status === "published" && (
              <ButtonLink variant="outline" className="min-h-11" href={`/events/${event.slug}`}>
                View event page
              </ButtonLink>
            )}
            {event.everPublished && (
              <ExportCsvButton
                rangeLabel={label}
                filename={`sheltuh-${event.slug}_${data.range.from}_${data.range.to}.csv`}
                fetchCsv={() => downloadEventAnalyticsCsv(eventId, getToken, query)}
              />
            )}
          </div>
        )}
      </header>

      <div className="flex flex-col gap-12 sm:gap-16">
        {error ? (
          <>
            {controls}
            <div>
              <Notice tone="danger" role="alert">
                Couldn&rsquo;t load analytics.
              </Notice>
              <Button variant="outline" size="lg" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            </div>
          </>
        ) : !data ? (
          <div aria-busy="true" className="min-h-96">
            <p className="text-sm text-muted">Loading analytics…</p>
          </div>
        ) : !data.event.everPublished ? (
          <Notice>Analytics start when this event is published. Nothing has been counted yet.</Notice>
        ) : (
          <>
            {controls}
            <ReportBody data={data} range={range} busy={loading || stale} />
          </>
        )}

        {/* Links can be made before launch, so they show whatever the report's state. */}
        {showExtras && <TrackingLinks eventId={eventId} getToken={getToken} />}
        {showExtras && <AnalyticsPrivacyNote />}
        {showExtras && <LaterStagesNote />}
      </div>

      <p role="status" className="sr-only">
        {data && !loading && !error && data.event.everPublished ? `Showing ${label}.` : ""}
      </p>
    </>
  );
}

function ReportBody({ data, range, busy }: { data: Report; range: RangeState; busy: boolean }) {
  const coverage = viewsCoverage(data.range, data.viewsTrackedSince);
  const counted = coverage !== "none";
  const previous = data.previous;
  const previousCounted = previous ? viewsCoverage(previous.range, data.viewsTrackedSince) !== "none" : false;
  const days = daysInRange(data.range.from, data.range.to);
  const stats = buildStats({
    totals: data.totals,
    previous: previous?.totals,
    viewsCounted: counted,
    previousViewsCounted: previousCounted,
    days,
    withFees: true,
  });

  const dates = data.byDay.map((d) => d.date);
  const previousLabel = previous ? previousLabelFor(data.range) : undefined;
  // The same date as the stats footnote: when counting began (platform-wide).
  const viewsNote =
    coverage === "partial" && data.viewsTrackedSince
      ? `Views before ${formatDay(data.viewsTrackedSince)} weren't counted.`
      : undefined;
  const unreliable = unreliableDays(data.byDay);

  const dailyColumns = [
    { key: "date", label: "Date" },
    { key: "views", label: "Views", numeric: true },
    { key: "orders", label: "Orders", numeric: true },
    { key: "tickets", label: "Tickets sold", numeric: true },
    { key: "gross", label: "Gross", numeric: true },
    { key: "fees", label: "Fees", numeric: true },
    { key: "net", label: "Net", numeric: true },
    ...(previous
      ? [
          { key: "prev-views", label: "Previous views", numeric: true },
          { key: "prev-tickets", label: "Previous tickets", numeric: true },
        ]
      : []),
  ];

  return (
    <div aria-busy={busy || undefined} className={`flex flex-col gap-12 sm:gap-16 ${busy ? "opacity-60" : ""}`.trim()}>
      <StatGrid
        stats={stats}
        footnote={
          <ViewsFootnote
            coverage={coverage}
            viewsTrackedSince={data.viewsTrackedSince}
            unreliable={unreliable}
            unreliableRange={isViewsUnreliable(data) || isViewsUnreliable(data.totals)}
          />
        }
      />

      <Attendance attendance={data.attendance} event={data.event} />

      <Panel title="Over time" titleId="over-time">
        <div className="flex flex-col gap-8">
          <TimeSeriesChart
            title="Page views"
            unit="views"
            range={data.range}
            dates={dates}
            values={data.byDay.map((d) => d.views)}
            previous={previous?.byDay.map((d) => d.views)}
            previousLabel={previousLabel}
            emptyText={counted ? "No views in this period." : "Views weren't counted in this period."}
            footnote={viewsNote}
          />
          <TimeSeriesChart
            title="Tickets sold"
            unit="tickets"
            range={data.range}
            dates={dates}
            values={data.byDay.map((d) => d.ticketsSold)}
            previous={previous?.byDay.map((d) => d.ticketsSold)}
            previousLabel={previousLabel}
            emptyText="No sales in this period."
          />
        </div>
        <details className="mt-8">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">
            Show the numbers as a table
          </summary>
          <div className="mt-4">
            <DataTable
              caption="Views and sales per day"
              columns={dailyColumns}
              rows={data.byDay.map((day, i) => {
                const prev = previous?.byDay[i];
                return {
                  key: day.date,
                  header: formatDay(day.date),
                  cells: [
                    <ValueOrNoData key="v" value={day.views === null ? null : formatCount(day.views)} />,
                    formatCount(day.orders),
                    formatCount(day.ticketsSold),
                    formatAudExact(day.grossCents),
                    formatAudExact(day.feesCents),
                    formatAudExact(day.netCents),
                    ...(previous
                      ? [
                          <ValueOrNoData key="pv" value={prev && prev.views !== null ? formatCount(prev.views) : null} />,
                          <ValueOrNoData key="pt" value={prev ? formatCount(prev.ticketsSold) : null} />,
                        ]
                      : []),
                  ],
                };
              })}
              totals={[
                <ValueOrNoData key="v" value={counted ? formatCount(data.totals.views) : null} />,
                formatCount(data.totals.orders),
                formatCount(data.totals.ticketsSold),
                formatAudExact(data.totals.grossCents),
                formatAudExact(data.totals.feesCents),
                formatAudExact(data.totals.netCents),
                ...(previous
                  ? [
                      <ValueOrNoData key="pv" value={previousCounted ? formatCount(previous.totals.views) : null} />,
                      formatCount(previous.totals.ticketsSold),
                    ]
                  : []),
              ]}
            />
          </div>
        </details>
      </Panel>

      <div className="flex flex-col gap-12 sm:gap-16 lg:grid lg:grid-cols-12 lg:gap-14">
        <div className="lg:col-span-7">
          <TicketTypeTable
            types={data.byTicketType}
            totals={data.totals}
            ticketsSold={data.totals.ticketsSold}
            wholeLife={range.preset === "all"}
          />
        </div>
        <div className="lg:col-span-5">
          <TrafficSources sources={data.bySource} counted={counted} />
        </div>
      </div>

      <TrackingLinkStatsTable links={data.trackingLinks} />
    </div>
  );
}
