import { Panel } from "@/components/ui/Section";
import { formatChange, formatCount, formatDay } from "@/lib/analytics-format";
import type { DateRange, OutboundClickStats } from "@/lib/api/types";
import DataTable from "./DataTable";
import StatGrid from "./StatGrid";
import TimeSeriesChart from "./TimeSeriesChart";

/** The days whose clicks hit the per-minute cap (so some may be missing), oldest first. */
export function unreliableClickDays(stats: OutboundClickStats): string[] {
  return stats.byDay.filter((day) => day.unreliable).map((day) => day.date);
}

/** "Some clicks may be missing on these days: …", or for the period; null when every day is reliable. */
export function clicksReliabilityNote(stats: OutboundClickStats): string | null {
  const days = unreliableClickDays(stats);
  if (days.length > 0) return `Some clicks may be missing on these days: ${days.map(formatDay).join(", ")}.`;
  if (stats.unreliable) return "Some clicks may be missing in this period.";
  return null;
}

/**
 * Clicks on external events' "Get tickets on …" links (docs/architecture.md,
 * "Organiser analytics"): the total with its change, a chart per day (the
 * previous period dashed, when comparing), and the numbers as a table. Days
 * where the click cap was reached are named, since their count is a lower
 * bound. Shown only when the report has `outboundClicks` (an external event,
 * or an organiser with one).
 */
export default function OutboundClicks({
  clicks,
  range,
  days,
  previousLabel,
  intro,
}: {
  clicks: OutboundClickStats & { previous?: OutboundClickStats };
  range: DateRange;
  /** Days in `range`, for the change line. */
  days: number;
  /** "Previous 30 days", when comparing. */
  previousLabel?: string;
  intro: string;
}) {
  const previous = clicks.previous;
  const note = clicksReliabilityNote(clicks);
  const previousNote = previous ? clicksReliabilityNote(previous) : null;

  return (
    <Panel title="Ticket link clicks" titleId="ticket-link-clicks">
      <p className="mb-6 max-w-2xl text-sm text-muted">{intro}</p>
      <div className="flex flex-col gap-8">
        <StatGrid
          stats={[
            {
              label: "Ticket link clicks",
              value: formatCount(clicks.total),
              change: formatChange(clicks.total, previous?.total, days),
            },
          ]}
          footnote={
            note || previousNote ? (
              <>
                {note && <p>{note}</p>}
                {previousNote && <p>In the previous period: {previousNote}</p>}
              </>
            ) : undefined
          }
        />
        <TimeSeriesChart
          title="Ticket link clicks"
          unit="clicks"
          range={range}
          dates={clicks.byDay.map((day) => day.date)}
          values={clicks.byDay.map((day) => day.clicks)}
          previous={previous?.byDay.map((day) => day.clicks)}
          previousLabel={previous ? previousLabel : undefined}
          emptyText="No clicks in this period."
          footnote={note ?? undefined}
        />
      </div>
      <details className="mt-8">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">
          Show the clicks as a table
        </summary>
        <div className="mt-4">
          <DataTable
            caption="Ticket link clicks per day"
            columns={[
              { key: "date", label: "Date" },
              { key: "clicks", label: "Clicks", numeric: true },
              ...(previous ? [{ key: "prev-clicks", label: "Previous clicks", numeric: true }] : []),
            ]}
            rows={clicks.byDay.map((day, i) => {
              const prev = previous?.byDay[i];
              return {
                key: day.date,
                header: formatDay(day.date),
                cells: [
                  <ClickCount key="c" clicks={day.clicks} unreliable={day.unreliable} />,
                  ...(previous
                    ? [<ClickCount key="p" clicks={prev?.clicks ?? 0} unreliable={prev?.unreliable ?? false} />]
                    : []),
                ],
              };
            })}
            totals={[
              formatCount(clicks.total),
              ...(previous ? [formatCount(previous.total)] : []),
            ]}
          />
        </div>
      </details>
    </Panel>
  );
}

/** A day's count, flagged in words when the cap was reached that day. */
function ClickCount({ clicks, unreliable }: { clicks: number; unreliable: boolean }) {
  return (
    <>
      {formatCount(clicks)}
      {unreliable && <span className="block text-xs text-muted">some may be missing</span>}
    </>
  );
}
