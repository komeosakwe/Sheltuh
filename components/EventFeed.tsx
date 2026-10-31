"use client";

import { useEffect, useState } from "react";
import EventBrowser from "@/components/EventBrowser";
import FeedLoading from "@/components/FeedLoading";
import { useLoadingProgress } from "@/components/ui/ProgressLoader";
import LiveEventFeed from "@/components/LiveEventFeed";
import { isApiConfigured } from "@/lib/api/client";
import { getEventCategories, getFeedEvents, getUpcomingEvents } from "@/lib/data";
import type { CategoryFilter, PricingFilter } from "@/lib/event-filter-params";
import type { Locality } from "@/lib/location";
import type { SheltuhEvent } from "@/lib/types";

interface FeedProps {
  /** Free-text search from /search; both the demo and live feeds honour it. */
  query?: string;
  /**
   * The suburb from /search?near=, found in the suburb table by the page:
   * results in bands by distance from it. Used only in the browser; never
   * sent to the API.
   */
  near?: Locality;
  /** Starting filters (from /events?category=&pricing=). They only seed the filter state. */
  initialCategory?: CategoryFilter;
  initialPricing?: PricingFilter;
}

/** The demo/sample-data feed — a small fixed list, so no pagination applies here. */
function DemoEventFeed({ query, near, initialCategory, initialPricing }: FeedProps) {
  const categories = getEventCategories();
  const [events, setEvents] = useState<SheltuhEvent[] | null>(null);
  const [summary, setSummary] = useState("");
  const progress = useLoadingProgress(events === null);

  const nearMode = near !== undefined;

  useEffect(() => {
    let cancelled = false;
    // Same rule as the live feed (upcoming=1&recent=1): events that haven't ended, then those that ended in the last 2 weeks.
    // Near a suburb (ordered by distance) only the upcoming ones, as live.
    (nearMode ? getUpcomingEvents() : getFeedEvents()).then((loaded) => {
      if (!cancelled) setEvents(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [nearMode]);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Always mounted: screen readers announce text that changes inside a live region,
          not one that appears already holding its text. It says the load's start, then its
          result (the browser's summary, also on every filter change). The loader shows the progress. */}
      <p role="status" className="sr-only">
        {events === null ? "Loading events…" : progress.visible ? "" : summary}
      </p>
      {progress.visible && <FeedLoading percent={progress.percent} done={progress.done} />}
      {events !== null && !progress.visible && (
        <EventBrowser
          events={events}
          categories={categories}
          query={query}
          near={near}
          initialCategory={initialCategory}
          initialPricing={initialPricing}
          onSummaryChange={setSummary}
        />
      )}
    </div>
  );
}

export default function EventFeed({ query, near, initialCategory, initialPricing }: FeedProps = {}) {
  const categories = getEventCategories();

  if (!isApiConfigured) {
    return <DemoEventFeed query={query} near={near} initialCategory={initialCategory} initialPricing={initialPricing} />;
  }

  return (
    <LiveEventFeed
      categories={categories}
      query={query}
      near={near}
      initialCategory={initialCategory}
      initialPricing={initialPricing}
    />
  );
}
