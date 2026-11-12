"use client";

import { useCallback, useEffect, useState } from "react";
import EventRow from "@/components/events/EventRow";
import RowLoadError from "@/components/events/RowLoadError";
import { listPublicEvents } from "@/lib/api/public-events";
import { categoryLabel } from "@/lib/event-card";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { similarNearby } from "@/lib/similar-events";
import type { SheltuhEvent } from "@/lib/types";

/** How many upcoming events of the category are read to find the nearby ones (the API's page maximum). */
const CANDIDATES = 50;

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; events: SheltuhEvent[] };

/** The candidates: live, one public page of the category's upcoming events (CDN-cacheable); in the demo, the samples. */
async function loadCandidates(event: SheltuhEvent, demo: boolean): Promise<SheltuhEvent[]> {
  if (demo) {
    const { getUpcomingEvents } = await import("@/lib/data");
    return getUpcomingEvents();
  }
  const page = await listPublicEvents({ category: event.category, upcoming: true, limit: CANDIDATES });
  return page.items.map(adaptPublicEvent);
}

/**
 * "Similar nearby" under the event's details (the audit's fix): upcoming events in the same category within
 * 25 km (lib/similar-events.ts), with "See all" to that category's events. Read after the first paint; nothing
 * while it loads or when there are none; a failed read says so, with Try again. Never in the editor's preview.
 */
export default function SimilarNearby({ event, demo }: { event: SheltuhEvent; demo: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const key = `${event.id}|${demo}|${attempt}`;
  const [result, setResult] = useState<{ key: string; load: Load } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCandidates(event, demo).then(
      (candidates) => {
        if (!cancelled) setResult({ key, load: { status: "ready", events: similarNearby(event, candidates, new Date()) } });
      },
      () => {
        if (!cancelled) setResult({ key, load: { status: "error" } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, event, demo]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // Try again keeps the error (and its button, with focus) on screen until the new read settles.
  const retrying = result !== null && result.key !== key && result.load.status === "error";
  const load: Load = result && (result.key === key || retrying) ? result.load : { status: "loading" };

  const id = "similar-nearby";
  const title = "Similar nearby";
  const category = categoryLabel(event);
  const note = event.suburb.trim() ? `${category} · near ${event.suburb.trim()}` : category;
  if (load.status === "error") {
    return (
      <EventRow id={id} title={title} note={note}>
        <RowLoadError onRetry={retry} retrying={retrying} />
      </EventRow>
    );
  }
  if (load.status !== "ready" || load.events.length === 0) return null;
  return (
    <EventRow
      id={id}
      title={title}
      note={note}
      seeAll={{ href: `/events?category=${encodeURIComponent(event.category)}`, srLabel: `${category} events` }}
      events={load.events}
    />
  );
}
