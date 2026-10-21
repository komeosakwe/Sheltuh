import Link from "next/link";
import EventArt from "@/components/EventArt";
import CardPrice from "@/components/home/CardPrice";
import QuickBuyLink from "@/components/QuickBuyLink";
import { buttonClass } from "@/components/ui/Button";
import { formatEventDateShort, formatEventTime } from "@/lib/format";
import { resolveEventCoordinates } from "@/lib/geo";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";

interface SceneMapEventCardProps {
  event: SheltuhEvent;
  detailsHref: string;
  onDismiss: () => void;
  /** `overlay`: over the desktop map, photo on top. `sheet`: the phone's bottom card, photo on the left. */
  variant: "overlay" | "sheet";
  /** Must position the card (`absolute`/`fixed`/`relative`): the dismiss button is placed against it. */
  className: string;
}

/**
 * The selected event's summary on the map (§6.15): a white card with a black
 * border; photo first, then category, date, title, venue, the all-inclusive
 * price, then the orange "Buy tickets" and "View event".
 */
export default function SceneMapEventCard({ event, detailsHref, onDismiss, variant, className }: SceneMapEventCardProps) {
  const categoryLabel = EVENT_CATEGORIES.find((c) => c.value === event.category)?.label ?? event.category;
  const pinned = resolveEventCoordinates(event);
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
      aria-label="Selected event"
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
          <p className="eyebrow text-muted">{categoryLabel}</p>
          <p className="meta mt-1">
            {formatEventDateShort(event.startsAt)}, {formatEventTime(event.startsAt)}
          </p>
          <p className="mt-1 line-clamp-2 text-base leading-[1.375rem] font-semibold break-words text-foreground">
            {event.title}
          </p>
          <p className="truncate text-sm leading-5 text-muted">
            {event.venueName} &middot; {event.suburb}
          </p>
          <CardPrice event={event} className="mt-1 text-sm leading-5" />
          {locationNote && <p className="mt-1 text-xs leading-4 text-muted">{locationNote}</p>}
        </div>
        {sheet && dismiss}
      </div>
      <div className={`flex flex-wrap items-center gap-2 ${sheet ? "px-3 pb-3" : "p-4 pt-3"}`}>
        <QuickBuyLink event={event} fill className="flex-1" />
        <Link href={detailsHref} className={buttonClass("outline", "md", "min-h-11 flex-1 sm:min-h-10")}>
          View event<span className="sr-only">: {event.title}</span>
        </Link>
      </div>
      {!sheet && dismiss}
    </section>
  );
}
