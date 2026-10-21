"use client";

import EventArt from "@/components/EventArt";
import { formatEventDateShort } from "@/lib/format";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";

interface MapEventMarkerProps {
  event: SheltuhEvent;
  selected: boolean;
  onSelect: (eventId: string) => void;
}

/**
 * A single event's map marker: a rounded-square photo thumbnail (poster art
 * when there's no photo or it fails, via EventArt) in a black ring that turns
 * Signal Orange when selected. Categories have no colours (owner decision,
 * brand-direction-one.md §2.7): the category is in the accessible name and on
 * the card. It's a real button, so Tab reaches it and Enter/Space select it
 * natively. The 48px box never changes size; selection scales the mark inside
 * it, so nothing shifts.
 */
export default function MapEventMarker({ event, selected, onSelect }: MapEventMarkerProps) {
  const categoryLabel = EVENT_CATEGORIES.find((c) => c.value === event.category)?.label ?? event.category;

  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      aria-pressed={selected}
      aria-label={`${event.title}. ${categoryLabel}, ${formatEventDateShort(event.startsAt)}`}
      data-category={event.category}
      data-event-id={event.id}
      className="group block h-12 w-12 cursor-pointer rounded-dot"
    >
      <span
        className={`block h-full w-full rounded-dot p-1 motion-safe:transition-transform ${
          selected
            ? "scale-110 bg-signal ring-2 ring-foreground ring-offset-2 ring-offset-background"
            : "bg-foreground ring-2 ring-background group-hover:scale-105"
        }`}
      >
        <EventArt poster={event.poster} title={event.title} imageUrl={event.imageUrl} className="h-full w-full rounded-dot" />
      </span>
    </button>
  );
}
