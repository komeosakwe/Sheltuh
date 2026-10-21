import Link from "next/link";
import { useId } from "react";
import EventArt from "@/components/EventArt";
import SaveButton from "@/components/favourites/SaveButton";
import CardPrice from "@/components/home/CardPrice";
import QuickBuyLink from "@/components/QuickBuyLink";
import { formatEventDateShort, formatEventTime } from "@/lib/format";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";

/**
 * The event card of grids (/events, /search, /saved, an organiser's
 * profile), per docs/design/brand-direction-one.md §6.5: image first with no
 * container (a 4:5 rounded-square photo with its category chip), then the
 * date in mono, the title, venue · suburb and the all-inclusive price set on
 * the page beneath.
 *
 * Reading and tab order: the card's link, the save heart, the orange "Buy
 * tickets" (owner decision 6; to the event page's tickets), then (live
 * events, which carry an organiserId) a "By {organiser}" link to the
 * organiser's profile. All are siblings of the card's link, never inside it
 * (no buttons or links within a link). The heart is absolutely positioned
 * over the photo's top-right corner, so its place in the DOM doesn't move it
 * on screen. `showOrganiser={false}` drops the organiser link where the
 * organiser is already the page.
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
    EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ?? event.category;
  const place = [event.venueName, event.suburb].filter(Boolean).join(" · ");
  // The link's name starts with the title, then date, place, price and category.
  const id = useId();
  const ids = { title: `${id}-title`, date: `${id}-date`, place: `${id}-place`, price: `${id}-price`, chip: `${id}-chip` };
  const labelledBy = [ids.title, ids.date, place ? ids.place : null, ids.price, ids.chip].filter(Boolean).join(" ");

  return (
    <div className={`relative flex min-w-0 flex-col ${className}`.trim()}>
      <Link
        href={`/events/${event.slug}`}
        aria-labelledby={labelledBy}
        className="group flex flex-col gap-3 motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.98]"
      >
        <div className="relative overflow-hidden rounded-card">
          <EventArt
            poster={event.poster}
            imageUrl={event.imageUrl}
            title={event.title}
            className="aspect-[4/5] motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover:scale-[1.03]"
          />
          {/* An opaque chip: 20:1 whatever the photo. */}
          <span id={ids.chip} className="eyebrow absolute top-2 left-2 max-w-[calc(100%-4rem)] truncate rounded-badge bg-cream px-2 py-0.5 text-ink">
            {categoryLabel}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p id={ids.date} className="meta">
            {formatEventDateShort(event.startsAt)} · {formatEventTime(event.startsAt)}
          </p>
          <h3 id={ids.title} className="line-clamp-2 font-sans text-sm leading-5 font-semibold tracking-[-0.01em] break-words normal-case underline-offset-4 group-hover:underline sm:text-base sm:leading-[1.375rem]">
            {event.title}
          </h3>
          {place && <p id={ids.place} className="truncate text-xs leading-4 text-muted sm:text-sm sm:leading-5">{place}</p>}
          <CardPrice id={ids.price} event={event} className="text-xs leading-4 sm:text-sm sm:leading-5" />
        </div>
      </Link>
      {showSave && (
        <SaveButton
          event={{ id: event.id, title: event.title, slug: event.slug }}
          variant="overlay"
          className="absolute right-1 top-1"
        />
      )}
      {/* mt-auto lines the buttons up along a grid row; pt-3 keeps them clear of the text. */}
      <QuickBuyLink event={event} narrow className="mt-auto pt-3" />
      {showOrganiser && event.organiserId && (
        <Link
          href={`/organisers/${encodeURIComponent(event.organiserId)}`}
          className="inline-flex min-h-11 max-w-full items-center text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          {/* A long name wraps to a second line, then is cut short. */}
          <span className="line-clamp-2 min-w-0 break-words">By {event.organiserName}</span>
        </Link>
      )}
    </div>
  );
}

/** A tile's shape while events load: 4:5 media and three text bars. No shimmer. */
export function EventTilePlaceholder() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <div className="aspect-[4/5] rounded-card bg-surface" />
      <div className="flex flex-col gap-2">
        <div className="h-3 w-24 max-w-full bg-surface" />
        <div className="h-4 w-full bg-surface" />
        <div className="h-3 w-32 max-w-full bg-surface" />
      </div>
    </div>
  );
}
