"use client";

import EventArt from "@/components/EventArt";
import type { SheltuhEvent } from "@/lib/types";

interface MapClusterMarkerProps {
  /** Members, soonest first. The first one's photo represents the group. */
  events: SheltuhEvent[];
  /**
   * The events share one spot (usually a suburb centre), so zooming in can't
   * separate them: activating opens a list instead of zooming.
   */
  stacked: boolean;
  /** Whether that list is open (stacked clusters only). */
  expanded: boolean;
  onActivate: (button: HTMLButtonElement) => void;
}

/** Several events too close together to tell apart at this zoom: a photo stack with a count. */
export default function MapClusterMarker({ events, stacked, expanded, onActivate }: MapClusterMarkerProps) {
  const [lead] = events;
  if (!lead) return null;
  const count = events.length;
  const label = stacked
    ? `${count} events at this spot, including ${lead.title}. Show the list`
    : `${count} events close together, including ${lead.title}. Zoom in to see them`;

  return (
    <button
      type="button"
      onClick={(domEvent) => onActivate(domEvent.currentTarget)}
      aria-label={label}
      aria-expanded={stacked ? expanded : undefined}
      // Its events, so focus can come back here for one of them (SceneMap's Dismiss).
      data-event-ids={events.map((event) => event.id).join(" ")}
      className="group relative block h-12 w-12 cursor-pointer rounded-dot"
    >
      {/* A second disc peeking out behind suggests a stack. */}
      <span aria-hidden="true" className="absolute inset-0 translate-x-1 -translate-y-1 rounded-dot border-2 border-foreground bg-surface" />
      <span className="relative block h-full w-full rounded-dot bg-foreground p-1 ring-2 ring-background motion-safe:transition-transform group-hover:scale-105">
        <EventArt poster={lead.poster} title={lead.title} imageUrl={lead.imageUrl} imageFocus={lead.imageFocus} className="h-full w-full rounded-dot" />
      </span>
      <span
        aria-hidden="true"
        className="absolute -right-2 -bottom-1 flex h-6 min-w-6 items-center justify-center rounded-badge border-2 border-background bg-foreground px-1 font-sans text-xs font-semibold text-background"
      >
        {count}
      </span>
    </button>
  );
}
