"use client";

import { useEffect, useId, useRef } from "react";
import EventArt from "@/components/EventArt";
import { startDateTimeLine } from "@/lib/event-card";
import type { SheltuhEvent } from "@/lib/types";

interface MapSpotListProps {
  events: SheltuhEvent[];
  onChoose: (eventId: string) => void;
  onClose: () => void;
}

/**
 * The events stacked on one map spot (zooming can't separate them), as a
 * short list over the map. Focus moves to the first event when it opens;
 * Escape or Close dismisses it (the parent puts focus back on the cluster).
 */
export default function MapSpotList({ events, onChoose, onClose }: MapSpotListProps) {
  const headingId = useId();
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstButton.current?.focus();
  }, []);

  const suburbs = new Set(events.map((event) => event.suburb));
  const place = suburbs.size === 1 ? `in ${events[0]?.suburb}` : "at this spot";
  const approximate = events.some((event) => !event.coordinates);

  return (
    <section
      aria-labelledby={headingId}
      onKeyDown={(domEvent) => {
        if (domEvent.key === "Escape") {
          domEvent.stopPropagation();
          onClose();
        }
      }}
      className="pointer-events-auto flex max-h-full w-72 max-w-full flex-col border border-foreground bg-background"
    >
      <div className="flex items-start justify-between gap-2 border-b border-surface-border p-3">
        <div className="min-w-0">
          <p id={headingId} className="font-sans text-sm font-semibold text-foreground">
            {events.length} events {place}
          </p>
          {approximate && (
            <p className="mt-0.5 font-sans text-xs text-muted">Pinned at the suburb centre until venue locations are added.</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close list"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-surface-border font-sans text-lg text-muted"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      <ul className="min-h-0 overflow-y-auto">
        {events.map((event, index) => (
          <li key={event.id} className="border-b border-surface-border last:border-b-0">
            <button
              ref={index === 0 ? firstButton : undefined}
              type="button"
              onClick={() => onChoose(event.id)}
              className="flex min-h-14 w-full items-center gap-3 p-2 text-left hover:bg-surface"
            >
              <EventArt
                poster={event.poster}
                title={event.title}
                imageUrl={event.imageUrl}
                className="h-10 w-10 shrink-0 rounded-dot"
              />
              <span className="min-w-0">
                <span className="block truncate font-sans text-sm font-semibold text-foreground">{event.title}</span>
                <span className="block truncate font-sans text-xs text-muted">
                  {startDateTimeLine(event)} &middot; {event.venueName}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
