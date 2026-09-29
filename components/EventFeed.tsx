"use client";

import { useEffect, useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import EventBrowser from "@/components/EventBrowser";
import LiveEventFeed from "@/components/LiveEventFeed";
import { isApiConfigured } from "@/lib/api/client";
import { getEventCategories, getEvents } from "@/lib/data";
import type { SheltuhEvent } from "@/lib/types";

/** The demo/sample-data feed — a small fixed list, so no pagination applies here. */
function DemoEventFeed({ query }: { query?: string }) {
  const categories = getEventCategories();
  const [events, setEvents] = useState<SheltuhEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEvents().then((loaded) => {
      if (!cancelled) setEvents(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <DemoNotice>
        These are fictional sample listings for this local prototype — no real tickets are on
        sale.
      </DemoNotice>
      {/* Always mounted: screen readers announce text that changes inside a live region,
          not one that appears already holding its text. */}
      <p role="status" className={events === null ? "text-sm text-muted" : "sr-only"}>
        {events === null ? "Loading events…" : ""}
      </p>
      {events !== null && <EventBrowser events={events} categories={categories} query={query} />}
    </div>
  );
}

/** `query` is the optional free-text search from /search; both the demo and live feeds honour it. */
export default function EventFeed({ query }: { query?: string } = {}) {
  const categories = getEventCategories();

  if (!isApiConfigured) return <DemoEventFeed query={query} />;

  return <LiveEventFeed categories={categories} query={query} />;
}
