"use client";

import { useEffect, useState } from "react";
import EventResults from "@/components/EventResults";
import { ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { useIsPhone } from "@/components/home/phone/useIsPhone";
import { loadHomeEvents } from "@/lib/home-events";
import type { SheltuhEvent } from "@/lib/types";

/** Phones see a short list before the link to the rest; wider screens get the full drifting carousel. */
export const PREVIEW_COUNT = 6;

/** The first few upcoming events, then a link to the rest on /events. */
export default function EventPreview() {
  const [events, setEvents] = useState<SheltuhEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const phone = useIsPhone();

  useEffect(() => {
    let cancelled = false;
    loadHomeEvents()
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
