"use client";

import { useCallback, useEffect, useState } from "react";
import EventRow from "@/components/events/EventRow";
import RowLoadError from "@/components/events/RowLoadError";
import { listPublicEvents } from "@/lib/api/public-events";
import { categoryLabel } from "@/lib/event-card";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { EVENT_ROW_MAX, similarNearby } from "@/lib/similar-events";
import type { SheltuhEvent } from "@/lib/types";

/** How many upcoming events of the category are read a page to find the nearby ones (the API's page maximum). */
const CANDIDATES = 50;
/** At most this many pages a visit (each CDN-cacheable): the row is found without reading a whole national category. */
export const SIMILAR_MAX_PAGES = 4;

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; events: SheltuhEvent[] };

/**
 * The similar events nearby. Live: the public list has no location filter (lib/api/public-events.ts), so distance
 * is worked out here, from the category's upcoming events, soonest first, a page at a time: on to the next page
 * only while the row isn't full (a later page's events start later, so they'd never replace one already found),
 * up to SIMILAR_MAX_PAGES. In the demo, the samples.
 */
async function loadSimilar(event: SheltuhEvent, demo: boolean, now: Date): Promise<SheltuhEvent[]> {
  if (demo) {
    const { getUpcomingEvents } = await import("@/lib/data");
    return similarNearby(event, await getUpcomingEvents(), now);
  }
  const candidates: SheltuhEvent[] = [];
  let cursor: string | undefined;
  let found: SheltuhEvent[] = [];
  for (let page = 0; page < SIMILAR_MAX_PAGES; page++) {
    const result = await listPublicEvents({ category: event.category, upcoming: true, limit: CANDIDATES, cursor });
    candidates.push(...result.items.map(adaptPublicEvent));
    found = similarNearby(event, candidates, now);
    cursor = result.nextCursor;
    if (!cursor || found.length >= EVENT_ROW_MAX) break;
  }
  return found;
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
    loadSimilar(event, demo, new Date()).then(
      (events) => {
        if (!cancelled) setResult({ key, load: { status: "ready", events } });
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
