"use client";

import { useEffect, useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import EventBrowser from "@/components/EventBrowser";
import LiveEventFeed from "@/components/LiveEventFeed";
import { isApiConfigured } from "@/lib/api/client";
import { getEventCategories, getEvents } from "@/lib/data";
import type { SheltuhEvent } from "@/lib/types";

/** The demo/sample-data feed — a small fixed list, so no pagination applies here. */
function DemoEventFeed() {
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
    <div className="flex flex-col gap-6">
      <DemoNotice>
        These are fictional sample listings for this local prototype — no real tickets are on
        sale.
      </DemoNotice>
      {events === null ? (
        <p className="text-sm text-muted">Loading events…</p>
      ) : (
        <EventBrowser events={events} categories={categories} />
      )}
    </div>
  );
}

export default function EventFeed() {
  const categories = getEventCategories();

  if (!isApiConfigured) return <DemoEventFeed />;

  return <LiveEventFeed categories={categories} />;
}
