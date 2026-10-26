import Link from "next/link";
import type { Ref } from "react";
import EventArt from "@/components/EventArt";
import QuickBuyLink from "@/components/QuickBuyLink";
import { buttonClass } from "@/components/ui/Button";
import CardPrice from "@/components/ui/CardPrice";
import { categoryLabel, placeLabel, startDateTimeLine } from "@/lib/event-card";
import { resolveEventCoordinates, type SuburbLookup } from "@/lib/geo";
import type { SheltuhEvent } from "@/lib/types";

interface SceneMapEventCardProps {
  event: SheltuhEvent;
  detailsHref: string;
  onDismiss: () => void;
  /** `overlay`: over the desktop map, photo on top. `sheet`: the phone's bottom card, photo on the left. */
  variant: "overlay" | "sheet";
  /** Must position the card (`absolute`/`fixed`/`relative`): the dismiss button is placed against it. */
  className: string;
  ref?: Ref<HTMLElement>;
  /** Where an event without coordinates of its own goes: its suburb's centre (lib/geo.ts). */
  findSuburb?: SuburbLookup;
}

/**
 * The selected event's summary on the map (§6.15): a white card with a black
 * border; photo first, then category, date, title, venue, the all-inclusive
 * price, then the orange "Buy tickets" and "View event".
 *
 * The sheet takes focus (tabIndex -1) when Locate opens it on a phone, and
 * carries `data-map-sheet`, so globals.css keeps focused things on the page
 * clear of it while it's open (WCAG 2.4.11).
 */
export default function SceneMapEventCard({
  event,
  detailsHref,
  onDismiss,
  variant,
  className,
  ref,
  findSuburb,
}: SceneMapEventCardProps) {
  const place = placeLabel(event);
  const pinned = resolveEventCoordinates(event, findSuburb);
  const locationNote = !pinned
    ? "Not on the map yet: no venue location on file."
    : !event.coordinates
      ? "Pinned at the suburb centre, not the exact venue."
      : null;
  const sheet = variant === "sheet";

  const dismiss = (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss selected event"
      className={`flex size-11 shrink-0 items-center justify-center rounded-control border border-foreground bg-card text-foreground hover:bg-surface ${
        sheet ? "" : "absolute top-2 right-2"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="h-4 w-4">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );

  return (
    <section
      ref={ref}
      aria-label="Selected event"
      tabIndex={sheet ? -1 : undefined}
      data-map-sheet={sheet ? "" : undefined}
      className={`overflow-hidden rounded-card border border-foreground bg-card ${className}`}
    >
      <div className={sheet ? "flex gap-3 p-3" : "flex flex-col"}>
        <EventArt
          poster={event.poster}
          title={event.title}
          imageUrl={event.imageUrl}
          className={sheet ? "h-20 w-20 shrink-0 overflow-hidden rounded-control" : "aspect-[3/2] w-full"}
        />
        <div className={`min-w-0 ${sheet ? "flex-1 pr-1" : "px-4 pt-3"}`}>
          <p className="eyebrow text-muted">{categoryLabel(event)}</p>
          <p className="meta mt-1">
            {startDateTimeLine(event)}
          </p>
          <p className="mt-1 line-clamp-2 text-base leading-[1.375rem] font-semibold break-words text-foreground">
            {event.title}
          </p>
          {place && <p className="truncate text-sm leading-5 text-muted">{place}</p>}
          <CardPrice event={event} className="mt-1 text-sm leading-5" />
          {locationNote && <p className="mt-1 text-xs leading-4 text-muted">{locationNote}</p>}
        </div>
        {sheet && dismiss}
      </div>
      {/* Stacked, full width: neither label is squeezed or wraps beside the other. */}
      <div className={`flex flex-col gap-2 ${sheet ? "px-3 pb-3" : "p-4 pt-3"}`}>
        <QuickBuyLink event={event} fill />
        <Link href={detailsHref} className={buttonClass("outline", "md", "min-h-11 w-full sm:min-h-10")}>
          View event<span className="sr-only">: {event.title}</span>
        </Link>
      </div>
      {!sheet && dismiss}
    </section>
  );
}
