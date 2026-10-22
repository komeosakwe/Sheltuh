import Link from "next/link";
import EventArt from "@/components/EventArt";
import QuickBuyLink from "@/components/QuickBuyLink";
import CardPrice from "@/components/ui/CardPrice";
import { categoryLabel } from "@/lib/event-card";
import { formatEventDateShort, formatEventTime } from "@/lib/format";
import type { SheltuhEvent } from "@/lib/types";

interface SceneEventRowProps {
  event: SheltuhEvent;
  selected: boolean;
  /** `opener`: the Locate button, for focus to come back to when the selection is dismissed. */
  onLocate: (eventId: string, opener: HTMLElement) => void;
  hasLocation: boolean;
  detailsHref: string;
}

/**
 * A map list row (docs/design/brand-direction-one.md §6.15, compact card
 * anatomy): the thumbnail, the date in mono, a title link to the event page,
 * venue · suburb, category and the all-inclusive price, then the orange "Buy
 * tickets" (owner decision 6), and a separate "locate on map" button
 * (selects + pans). Independent, non-nested controls, rather than one big
 * clickable card wrapping a link. Selected: a sunken fill, a black edge and
 * the word "Selected", never colour alone.
 */
export default function SceneEventRow({ event, selected, onLocate, hasLocation, detailsHref }: SceneEventRowProps) {
  return (
    <div
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 border-b border-l-2 border-b-surface-border px-4 py-3 last:border-b-0 ${
        selected ? "border-l-foreground bg-surface" : "border-l-transparent"
      }`}
    >
      <EventArt
        poster={event.poster}
        title={event.title}
        imageUrl={event.imageUrl}
        className="h-20 w-20 shrink-0 overflow-hidden rounded-control sm:h-24 sm:w-24"
      />

      <div className="min-w-0">
        {selected && (
          <p className="eyebrow mb-1 flex items-center gap-1">
            <span aria-hidden="true">&#10003;</span> Selected
          </p>
        )}
        <p className="meta">
          <span className="whitespace-nowrap">{formatEventDateShort(event.startsAt)}</span> ·{" "}
          <span className="whitespace-nowrap">{formatEventTime(event.startsAt)}</span>
        </p>
        <Link
          href={detailsHref}
          className="mt-1 block text-base leading-[1.375rem] font-semibold break-words text-foreground underline-offset-4 hover:underline"
        >
          {event.title}
        </Link>
        <p className="truncate text-sm leading-5 text-muted">
          {event.venueName} &middot; {event.suburb}
        </p>
        <p className="text-sm leading-5 text-muted">
          {categoryLabel(event)}
          {!hasLocation && <> &middot; not shown on map</>}
        </p>
        <CardPrice event={event} className="text-sm leading-5" />
      </div>

      <button
        type="button"
        onClick={(click) => onLocate(event.id, click.currentTarget)}
        disabled={!hasLocation}
        aria-pressed={selected}
        aria-label={`Locate ${event.title} on the map`}
        title="Locate on map"
        className={`flex size-11 shrink-0 items-center justify-center rounded-control border disabled:cursor-not-allowed disabled:border-surface-border disabled:bg-surface disabled:text-muted ${
          selected ? "border-foreground bg-foreground text-background" : "border-foreground bg-card text-foreground hover:bg-surface"
        }`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="h-5 w-5">
          <circle cx="12" cy="12" r="6" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </button>

      {/* Under the text and the locate button, so it has room at 320px. */}
      <QuickBuyLink event={event} narrow className="col-span-2 col-start-2 pt-3" />
    </div>
  );
}
