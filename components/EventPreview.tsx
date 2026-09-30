"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import EventResults from "@/components/EventResults";
import { ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { isApiConfigured } from "@/lib/api/client";
import { listPublicEvents } from "@/lib/api/public-events";
import { getEvents } from "@/lib/data";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { SheltuhEvent } from "@/lib/types";

/** Phones see a short list before the link to the rest; wider screens get the full drifting carousel. */
export const PREVIEW_COUNT = 6;
const WIDE_COUNT = 24;
const PHONE_QUERY = "(max-width: 639.98px)";

function subscribePhone(onChange: () => void) {
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

async function loadPreview(): Promise<SheltuhEvent[]> {
  if (!isApiConfigured) {
    const all = await getEvents();
    return [...all].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, WIDE_COUNT);
  }
  // Pages of 10: fetch enough to fill the wide carousel.
  const items: SheltuhEvent[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 3 && items.length < WIDE_COUNT; i++) {
    const page = await listPublicEvents({ cursor });
    items.push(...page.items.map(adaptPublicEvent));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return items.slice(0, WIDE_COUNT);
}

/** The first few upcoming events, then a link to the rest on /events. */
export default function EventPreview() {
  const [events, setEvents] = useState<SheltuhEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);

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
      {events !== null && events.length > 0 && <EventResults events={phone ? events.slice(0, PREVIEW_COUNT) : events} />}
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
