import Link from "next/link";
import EventArt from "@/components/EventArt";
import { formatEventDateShort, formatEventTime } from "@/lib/format";
import { formatFeedPrice } from "@/lib/pricing";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";

/**
 * Poster-first event tile: square artwork, then metadata set as plain text
 * beneath (title, date, venue, price). Used by carousels and grids.
 */
export default function EventTile({
  event,
  className = "",
}: {
  event: SheltuhEvent;
  className?: string;
}) {
  const categoryLabel =
    EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ??
    event.category;

  return (
    <Link href={`/events/${event.slug}`} className={`group flex flex-col gap-3 ${className}`}>
      <div className="relative overflow-hidden">
        <EventArt
          poster={event.poster}
          imageUrl={event.imageUrl}
          title={event.title}
          className="aspect-square transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <span className="eyebrow absolute left-3 top-3 bg-background px-2 py-1 text-foreground">
          {categoryLabel}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <h3 className="font-sans text-base font-semibold normal-case leading-snug tracking-normal group-hover:underline group-hover:underline-offset-4">
          {event.title}
        </h3>
        <p className="text-sm text-muted">
          {formatEventDateShort(event.startsAt)}, {formatEventTime(event.startsAt)}
        </p>
        <p className="text-sm text-muted">{event.venueName || event.suburb}</p>
        <p className="text-sm font-semibold">{formatFeedPrice(event)}</p>
      </div>
    </Link>
  );
}
