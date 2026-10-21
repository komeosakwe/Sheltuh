import Link from "next/link";
import EventArt from "@/components/EventArt";
import { buttonClass } from "@/components/ui/Button";
import { formatEventDateShort, formatEventTime } from "@/lib/format";
import { resolveEventCoordinates } from "@/lib/geo";
import { formatFeedPrice } from "@/lib/pricing";
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

/** The selected event's summary on the map: photo first, then title, date, venue, all-inclusive price and a link. */
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
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-foreground bg-background font-sans text-lg text-foreground ${
        sheet ? "" : "absolute top-2 right-2"
      }`}
    >
      <span aria-hidden="true">&times;</span>
    </button>
  );

  return (
    <section aria-label="Selected event" className={`border border-foreground bg-background ${className}`}>
      <div className={sheet ? "flex gap-3 p-3" : "flex flex-col"}>
        <EventArt
          poster={event.poster}
          title={event.title}
          imageUrl={event.imageUrl}
          className={sheet ? "h-20 w-20 shrink-0" : "aspect-video w-full"}
        />
        <div className={`min-w-0 ${sheet ? "flex-1" : "px-4 pt-3"}`}>
          <p className="eyebrow text-muted">{categoryLabel}</p>
          <p className="mt-1 line-clamp-2 font-sans text-base leading-snug font-semibold text-foreground">{event.title}</p>
          <p className="mt-1 truncate font-sans text-sm text-muted">
            {formatEventDateShort(event.startsAt)}, {formatEventTime(event.startsAt)}
          </p>
          <p className="truncate font-sans text-sm text-muted">
            {event.venueName} &middot; {event.suburb}
          </p>
          <p className="mt-1 font-sans text-sm font-medium text-foreground">{formatFeedPrice(event)}</p>
          {locationNote && <p className="mt-1 font-sans text-xs text-muted">{locationNote}</p>}
        </div>
      </div>
      <div className={`flex items-center gap-2 ${sheet ? "px-3 pb-3" : "p-4 pt-3"}`}>
        <Link href={detailsHref} className={buttonClass("solid", "lg", "flex-1")}>
          View event<span className="sr-only">: {event.title}</span>
        </Link>
        {sheet && dismiss}
      </div>
      {!sheet && dismiss}
    </section>
  );
}
