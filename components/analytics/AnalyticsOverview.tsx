"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice, PageHeader, Panel } from "@/components/ui/Section";
import { viewsCoverage, isViewsUnreliable, unreliableDays } from "@/lib/analytics-data";
import { daysInRange, formatAudExact, formatCount } from "@/lib/analytics-format";
import { rangeLabel, rangeSearch, toQuery } from "@/lib/analytics-range";
import { downloadAnalyticsOverviewCsv, getAnalyticsOverview } from "@/lib/api/analytics";
import type { GetToken } from "@/lib/api/client";
import type { AnalyticsOverview as Overview } from "@/lib/api/types";
import { formatEventDateShort } from "@/lib/format";
import AnalyticsGate, { NotApprovedOrganiser } from "./AnalyticsGate";
import DataTable from "./DataTable";
import ExportCsvButton from "./ExportCsvButton";
import { ValueOrNoData } from "./NoData";
import OutboundClicks from "./OutboundClicks";
import { AnalyticsPrivacyNote, LaterStagesNote, ViewsFootnote } from "./Notes";
import RangeControls from "./RangeControls";
import { STATUS_LABEL, backLinkClass, buildStats, failureKind, rangeErrorMessage, rowConversion, useKeyedLoad } from "./shared";
import StatGrid from "./StatGrid";
import { previousLabelFor } from "./TimeSeriesChart";
import { useAnalyticsRange } from "./useAnalyticsRange";
import { LoadingState } from "@/components/ui/ProgressLoader";

const PATH = "/dashboard/analytics";

/** /dashboard/analytics (docs/design/favourites-analytics.md §5.18): every one of the organiser's events. */
export default function AnalyticsOverview() {
  return (
    <>
      <Link href="/dashboard" className={`${backLinkClass} mb-6`}>
        &larr; Your events
      </Link>
      <AnalyticsGate returnTo={PATH}>{(getToken) => <OverviewReport getToken={getToken} />}</AnalyticsGate>
    </>
  );
}

function header(action?: ReactNode) {
  return (
    <PageHeader
      size="md"
      eyebrow="Organiser"
      title="Analytics"
      intro="Ticket sales and page views across your events. Free for every organiser."
      action={action}
    />
  );
}

function OverviewReport({ getToken }: { getToken: GetToken }) {
  const { range, setRange, today } = useAnalyticsRange({ allowAllTime: false, defaultPreset: "30d" });
  const [attempt, setAttempt] = useState(0);
  const query = useMemo(() => toQuery(range, today), [range, today]);
  const key = `${rangeSearch(range)}|${attempt}`;
  // `attempt` is part of the key, so Try again reloads.
  const load = useCallback(() => getAnalyticsOverview(getToken, query), [getToken, query]);
  const { loading, error, data, stale } = useKeyedLoad<Overview>(key, load);
  const label = rangeLabel(range);
  const failure = error ? failureKind(error) : null;

  if (failure === "forbidden") {
    return (
      <>
        {header()}
        <NotApprovedOrganiser />
      </>
    );
  }

  const controls = (
    <RangeControls
      value={range}
      onChange={setRange}
      allowAllTime={false}
      busy={loading}
      today={today}
      rangeError={rangeErrorMessage(error)}
    />
  );

  const exportButton = data && !error && (
    <ExportCsvButton
      rangeLabel={label}
      filename={`sheltuh-analytics_${data.range.from}_${data.range.to}.csv`}
      fetchCsv={() => downloadAnalyticsOverviewCsv(getToken, query)}
    />
  );

  return (
    <>
      {header(exportButton || undefined)}
      <div className="flex flex-col gap-12 sm:gap-16">
        {controls}
        {renderResults()}
      </div>
      <p role="status" className="sr-only">
        {data && !loading && !error ? `Showing ${label}.` : ""}
      </p>
    </>
  );

  function renderResults() {
    if (error) {
      return (
        <div>
          <Notice tone="danger" role="alert">
            Couldn&rsquo;t load analytics.
          </Notice>
          <Button variant="outline" size="lg" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      );
    }
    if (!data) {
      return (
        <div aria-busy="true" className="min-h-96">
          <LoadingState text="Loading analytics…" />
        </div>
      );
    }
    if (data.events.length === 0) {
      return (
        <EmptyState
          title="Nothing to show yet"
          action={
            <ButtonLink size="lg" href="/dashboard/new">
              New event
            </ButtonLink>
          }
        >
          Analytics start when your first event is published.
        </EmptyState>
      );
    }
    return <OverviewBody data={data} busy={loading || stale} />;
  }
}

function OverviewBody({ data, busy }: { data: Overview; busy: boolean }) {
  const coverage = viewsCoverage(data.range, data.viewsTrackedSince);
  const counted = coverage !== "none";
  const previousCounted = data.previous ? viewsCoverage(data.previous.range, data.viewsTrackedSince) !== "none" : false;
  const days = daysInRange(data.range.from, data.range.to);
  const stats = buildStats({
    totals: data.totals,
    previous: data.previous?.totals,
    viewsCounted: counted,
    previousViewsCounted: previousCounted,
    days,
    withFees: false,
  });
  // Null (no column, no section) when the organiser has no external event.
  const clicks = data.outboundClicks ?? null;

  return (
    <div aria-busy={busy || undefined} className={`flex flex-col gap-12 sm:gap-16 ${busy ? "opacity-60" : ""}`.trim()}>
      <StatGrid
        stats={stats}
        footnote={
          <ViewsFootnote
            coverage={coverage}
            viewsTrackedSince={data.viewsTrackedSince}
            unreliable={unreliableDays(data.byDay)}
            unreliableRange={isViewsUnreliable(data) || isViewsUnreliable(data.totals)}
          />
        }
      />
      {clicks && (
        <OutboundClicks
          clicks={clicks}
          range={data.range}
          days={days}
          previousLabel={data.previous ? previousLabelFor(data.range) : undefined}
          intro="Clicks on the “Get tickets on …” links of your events sold on other sites. Their sales happen on those sites, so they aren’t in the sales numbers above."
        />
      )}
      <Panel title="By event" titleId="by-event">
        <DataTable
          caption="Views and sales by event"
          columns={[
            { key: "event", label: "Event" },
            { key: "views", label: "Views", numeric: true },
            { key: "orders", label: "Orders", numeric: true },
            { key: "tickets", label: "Tickets", numeric: true },
            { key: "gross", label: "Gross", numeric: true },
            { key: "net", label: "Net", numeric: true },
            { key: "conversion", label: "Conversion", numeric: true },
            ...(clicks ? [{ key: "clicks", label: "Ticket link clicks", numeric: true }] : []),
          ]}
          rows={data.events.map((event) => ({
            key: event.eventId,
            header: (
              <span className="flex flex-col">
                <Link
                  href={`/dashboard/events/${encodeURIComponent(event.eventId)}/analytics`}
                  className="inline-flex min-h-6 items-center font-semibold underline-offset-4 hover:underline"
                >
                  {event.title || "Untitled event"}
                </Link>
                <span className="text-xs text-muted">
                  {formatEventDateShort(event.startsAt)} · {STATUS_LABEL[event.status]}
                </span>
              </span>
            ),
            cells: [
              <ValueOrNoData key="v" value={counted ? formatCount(event.totals.views) : null} />,
              formatCount(event.totals.orders),
              formatCount(event.totals.ticketsSold),
              formatAudExact(event.totals.grossCents),
              formatAudExact(event.totals.netCents),
              <ValueOrNoData key="c" value={rowConversion(event.totals, counted)} />,
              // Only external events have a ticket link to click.
              ...(clicks
                ? [<ValueOrNoData key="k" value={event.outboundClicks ? formatCount(event.outboundClicks.total) : null} />]
                : []),
            ],
          }))}
          totals={[
            <ValueOrNoData key="v" value={counted ? formatCount(data.totals.views) : null} />,
            formatCount(data.totals.orders),
            formatCount(data.totals.ticketsSold),
            formatAudExact(data.totals.grossCents),
            formatAudExact(data.totals.netCents),
            <ValueOrNoData key="c" value={rowConversion(data.totals, counted)} />,
            ...(clicks ? [formatCount(clicks.total)] : []),
          ]}
        />
        {data.eventsTruncated && (
          <p className="mt-4 text-xs text-muted">
            Only your first 500 events are listed. The totals include every event.
          </p>
        )}
      </Panel>
      <AnalyticsPrivacyNote />
      <LaterStagesNote />
    </div>
  );
}
