import Link from "next/link";
import { useId } from "react";
import ProgressBar from "@/components/dashboard/ui/ProgressBar";
import StatusPill from "@/components/dashboard/ui/StatusPill";
import type { OrganiserEventPerformance } from "@/lib/api/types";
import { formatCount } from "@/lib/analytics-format";
import { deltaPill, performanceAmount, soldLine } from "@/lib/organiser-dashboard";
import { manageEventHref } from "@/lib/organiser-nav";

const DELTA_TONE = { up: "green", down: "red", flat: "grey" } as const;

/**
 * "Org / Progress card" (Latte 466:8249): white, radius 16, 24 by 20 in: the event's title and its
 * takings (SemiBold 16/24; "A$0 · free" for a free event), the sales bar, then "86 / 120 sold"
 * (Label/Tag, text/secondary) and this week's tickets against the week before as a pill: "↑ 15%"
 * green, "↓ 10%" red, read as "Up 15% on the week before". No pill when the week before sold
 * nothing (no percentage means anything then).
 */
function ProgressCard({ event }: { event: OrganiserEventPerformance }) {
  const delta = deltaPill(event.deltaPct);
  return (
    <li data-progress-card={event.eventId} className="flex flex-col gap-3 rounded-card bg-card px-6 py-5">
      <div className="label-button flex flex-wrap items-start justify-between gap-x-3">
        {/* The event's name goes to it (its Manage page), looking as drawn. */}
        <h4 className="label-button min-w-0 wrap-anywhere">
          <Link href={manageEventHref(event.eventId)} className="underline-offset-4 hover:underline">
            {event.title.trim() || "Untitled event"}
          </Link>
        </h4>
        <p className="min-w-0 break-words tabular-nums">{performanceAmount(event)}</p>
      </div>
      <ProgressBar value={event.ticketsSold} max={event.capacity} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="label-tag min-w-0 text-muted tabular-nums">{soldLine(event)}</p>
        {delta && (
          <StatusPill tone={DELTA_TONE[delta.direction]} srText={delta.srText}>
            {delta.text}
          </StatusPill>
        )}
      </div>
    </li>
  );
}

/**
 * The Overview's "Performance" column (Latte 430:7340): cream (surface/card-hover), 400 wide down the
 * panel's right edge from `col-lg` (1280px inside the frame, where the page's column has room for
 * it), and below the page full width under that, as the 768 and 390 frames draw it. "Performance"
 * (Heading/H2), "New followers (21)", then "Your events": a progress card for each live event sold
 * on Sheltüh (the API's `performance`, at most 10).
 *
 * Followers are a count only: Latte draws four followers' faces and names and "See all", but who
 * follows an organiser isn't shared with them (owner question 34), so those are left out.
 */
export default function PerformancePanel({
  newFollowers,
  events,
  className = "",
}: {
  newFollowers: number;
  events: OrganiserEventPerformance[];
  className?: string;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} data-performance="" className={`flex flex-col gap-6 bg-hover ${className}`.trim()}>
      <h2 id={titleId} className="heading-dash wrap-anywhere">
        Performance
      </h2>
      <div className="flex flex-col gap-1">
        {/* A line, not a heading: nothing sits under it but its period. */}
        <p data-new-followers="" className="label-button">
          New followers ({formatCount(newFollowers)})
        </p>
        <p className="body-s text-muted">In the last 7 days.</p>
      </div>
      <h3 className="label-button">Your events</h3>
      {events.length > 0 ? (
        <ul className="flex flex-col gap-6">
          {events.map((event) => (
            <ProgressCard key={event.eventId} event={event} />
          ))}
        </ul>
      ) : (
        <p data-performance-empty="" className="body-s text-muted">
          Your live events show here, with their sales this week.
        </p>
      )}
    </section>
  );
}
