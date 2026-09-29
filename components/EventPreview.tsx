"use client";

import { useEffect, useState } from "react";
import EventResults from "@/components/EventResults";
import { ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { isApiConfigured } from "@/lib/api/client";
import { listPublicEvents } from "@/lib/api/public-events";
import { getEvents } from "@/lib/data";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { SheltuhEvent } from "@/lib/types";

/** How many events the home page shows before pointing at the full list. */
export const PREVIEW_COUNT = 6;

async function loadPreview(): Promise<SheltuhEvent[]> {
  if (!isApiConfigured) {
    const all = await getEvents();
    return [...all].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, PREVIEW_COUNT);
  }
  const page = await listPublicEvents();
  return page.items.slice(0, PREVIEW_COUNT).map(adaptPublicEvent);
}

/** The first few upcoming events, then a link to the rest on /events. */
export default function EventPreview() {
  const [events, setEvents] = useState<SheltuhEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadPreview()
      .then((loaded) => {
        if (!cancelled) setEvents(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      {/* Always mounted so "Loading events…" is announced. */}
      <p role="status" className={events === null && !failed ? "text-sm text-muted" : "sr-only"}>
        {events === null && !failed ? "Loading events…" : ""}
      </p>
      {failed && <Notice tone="danger" role="alert">Couldn’t load events.</Notice>}
      {events !== null && events.length > 0 && <EventResults events={events} />}
      {events !== null && events.length === 0 && (
        <p className="text-muted">No events have been published yet. Check back soon.</p>
      )}
      <div>
        <ButtonLink href="/events" variant="outline" size="lg">
          See all events
        </ButtonLink>
      </div>
    </div>
  );
}
