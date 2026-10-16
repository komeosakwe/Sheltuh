import Link from "next/link";
import EventArt from "@/components/EventArt";
import SaveButton from "@/components/favourites/SaveButton";
import { formatEventDateShort, formatEventTime } from "@/lib/format";
import { formatFeedPrice } from "@/lib/pricing";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";

/**
 * Poster-first event tile: square artwork, then metadata set as plain text
 * beneath (title, date, venue, price). Used by carousels and grids. The save
 * heart sits over the art's top-right corner as a sibling of the link (a
 * button can't go inside a link), after the title in reading and tab order.
 * Live events (they carry an organiserId) end with an "By {organiser}" link to
 * the organiser's profile, also a sibling of the tile's link, never inside it.
 * `showOrganiser={false}` drops it where the organiser is already the page.
 */
export default function EventTile({
  event,
  className = "",
  showSave = true,
  showOrganiser = true,
}: {
  event: SheltuhEvent;
  className?: string;
  showSave?: boolean;
  showOrganiser?: boolean;
}) {
  const categoryLabel =
    EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ??
    event.category;

  return (
    <div className={`relative ${className}`.trim()}>
      <Link href={`/events/${event.slug}`} className="group flex flex-col gap-3">
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
      {showOrganiser && event.organiserId && (
        <Link
          href={`/organisers/${encodeURIComponent(event.organiserId)}`}
          className="inline-flex min-h-11 max-w-full items-center text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          <span className="min-w-0 truncate">By {event.organiserName}</span>
        </Link>
      )}
      {showSave && (
        <SaveButton
          event={{ id: event.id, title: event.title, slug: event.slug }}
          variant="overlay"
          className="absolute right-1 top-1"
        />
      )}
    </div>
  );
}
