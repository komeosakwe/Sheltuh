import Link from "next/link";
import EventArt from "@/components/EventArt";
import QuickBuyLink from "@/components/QuickBuyLink";
import PlaceLines from "@/components/ui/PlaceLines";
import { categoryLabel, startLabel } from "@/lib/event-card";
import { formatCardPriceLabel, isSoldOut, NO_TICKETS_LABEL, SOLD_OUT_LABEL } from "@/lib/pricing";
import type { SheltuhEvent } from "@/lib/types";

interface SceneEventRowProps {
  event: SheltuhEvent;
  selected: boolean;
  /** `opener`: the Locate button, for focus to come back to when the selection is dismissed. */
  onLocate: (eventId: string, opener: HTMLElement) => void;
  hasLocation: boolean;
  /** How far from the visitor or their place ("8.3 km"), once Nearby has one; approximate. */
  distance?: string | null;
  detailsHref: string;
}

/** The row's price: the all-inclusive "From A$5" (lib/pricing.ts, the card's label), "Free", or "Sold out". */
function rowPrice(event: SheltuhEvent): string {
  if (isSoldOut(event)) return SOLD_OUT_LABEL;
  return formatCardPriceLabel(event) ?? NO_TICKETS_LABEL;
}

/**
 * A Nearby list row (the proposal's Nearby; the owner's 390 and 768 mocks): the photo, the date in
 * mono, the title (the row's one link, stretched over it, so hover, press and keyboard focus show
 * on the row), the venue and "Suburb, STATE" (a line each), "Category · 8.3 km", the all-inclusive
 * "From A$5", then, from lg, the orange "Buy tickets" (the phone and tablet mocks leave it off: the
 * row opens the event). Locate sits top right at every width, selecting the event on the map.
 * Independent controls, never nested in the link. Selected: a muted fill, a black edge and the
 * word "Selected", never colour alone.
 */
export default function SceneEventRow({ event, selected, onLocate, hasLocation, distance, detailsHref }: SceneEventRowProps) {
  const start = startLabel(event);
  return (
    <div
      data-scene-row=""
      className={`group/row relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 border-b border-l-2 border-b-surface-border p-4 last:border-b-0 has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:-outline-offset-2 has-[[data-card-link]:focus-visible]:outline-foreground has-[[data-card-link]:active]:bg-surface-border lg:p-6 ${
        selected ? "border-l-foreground bg-surface" : "border-l-transparent hover:bg-surface"
      }`}
    >
      <EventArt
        poster={event.poster}
        title={event.title}
        imageUrl={event.imageUrl}
        imageFocus={event.imageFocus}
        className="size-20 shrink-0 overflow-hidden rounded-control sm:size-24 xl:size-40"
      />

      <div className="min-w-0">
        {selected && (
          <p className="eyebrow mb-1 flex items-center gap-1">
            <span aria-hidden="true">&#10003;</span> Selected
          </p>
        )}
        <p className="meta">
          <span className="whitespace-nowrap">{start.date}</span>{" "}
          <span className="whitespace-nowrap">· {start.time}</span>
          {/* Its own part, so it wraps under the time rather than under the locate button. */}
          {start.zone && (
            <>
              {" "}
              <span className="whitespace-nowrap">{start.zone}</span>
            </>
          )}
        </p>
        <Link
          href={detailsHref}
          data-card-link=""
          className="heading-h4 mt-2 block break-words text-foreground underline-offset-4 group-hover/row:underline after:absolute after:inset-0 after:z-0 after:content-['']"
        >
          {event.title}
        </Link>
        <PlaceLines event={event} className="body-s mt-1 text-muted" />
        {/* Phones and tablets: the price at the end of the category line (the mocks); from lg, a line of its own. */}
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 lg:block">
          <p className="body-s text-muted">
            {categoryLabel(event)}
            {distance && (
              <>
                {" "}&middot; {distance}
                <span className="sr-only"> away</span>
              </>
            )}
            {!hasLocation && <> &middot; not shown on map</>}
          </p>
          <p data-row-price="" className="body-m font-semibold text-foreground tabular-nums lg:mt-1">
            {rowPrice(event)}
          </p>
        </div>
        <div className="relative z-10 hidden lg:block">
          <QuickBuyLink event={event} className="mt-4" />
        </div>
      </div>

      <button
        type="button"
        onClick={(click) => onLocate(event.id, click.currentTarget)}
        disabled={!hasLocation}
        aria-pressed={selected}
        aria-label={`Locate ${event.title} on the map`}
        title="Locate on map"
        className={`relative z-10 flex size-12 shrink-0 items-center justify-center rounded-control border-control disabled:cursor-not-allowed disabled:border-surface-border disabled:bg-surface disabled:text-muted ${
          selected ? "border-foreground bg-foreground text-background" : "border-foreground bg-background text-foreground hover:bg-hover"
        }`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="size-6">
          <circle cx="12" cy="12" r="6" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </button>
    </div>
  );
}
