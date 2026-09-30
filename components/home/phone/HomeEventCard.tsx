import Link from "next/link";
import EventArt from "@/components/EventArt";
import { firstSentence } from "@/lib/home-sections";
import { formatDateBadge, formatEventDateShort, formatEventTime } from "@/lib/format";
import { formatFeedPrice } from "@/lib/pricing";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";
import GoingStack from "./GoingStack";
import { demoGoing } from "./going";
import { CalendarIcon, PinIcon } from "./icons";

export type HomeCardVariant = "standard" | "wide" | "compact";

const categoryLabel = (event: SheltuhEvent) =>
  EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ?? event.category;

const cardClass =
  "group flex overflow-hidden rounded-card bg-card shadow-card motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.98]";
const titleClass = "font-sans normal-case tracking-normal font-semibold group-hover:underline underline-offset-4";
const chipClass = "eyebrow absolute rounded-full bg-background px-2 py-0.5 text-foreground";

/**
 * The phone home's event card: one link, art first, then a plain text stack.
 * `standard` (Coming up), `wide` (What's on), `compact` (Free & low-cost).
 * Demo cards show the sample "N going"; live cards don't until the list API
 * carries a count (no request per card).
 */
export default function HomeEventCard({
  event,
  variant,
  mode,
  badge,
}: {
  event: SheltuhEvent;
  variant: HomeCardVariant;
  mode: "demo" | "live";
  badge?: "free" | "low-cost";
}) {
  const href = `/events/${event.slug}`;
  const going = mode === "demo" ? demoGoing(event.id) : null;
  const art = { poster: event.poster, imageUrl: event.imageUrl, title: event.title };

  if (variant === "compact") {
    return (
      <Link href={href} className={`${cardClass} grid min-h-28 w-[78vw] max-w-75 grid-cols-[6rem_1fr]`}>
        <EventArt {...art} className="h-full" />
        <div className="flex min-w-0 flex-col gap-1 p-3">
          {badge && (
            <span
              className={`eyebrow self-start rounded-full px-2 py-0.5 text-foreground ${
                badge === "free" ? "bg-highlight" : "bg-pop"
              }`}
            >
              {badge === "free" ? "Free" : "Under A$20"}
            </span>
          )}
          <h3 className={`${titleClass} line-clamp-1 text-sm leading-5`}>{event.title}</h3>
          <p className="truncate text-xs leading-4 text-muted">
            {formatEventDateShort(event.startsAt)} · {event.venueName || event.suburb}
          </p>
          <p className="text-xs leading-4 font-semibold">{formatFeedPrice(event)}</p>
        </div>
      </Link>
    );
  }

  if (variant === "wide") {
    const date = formatDateBadge(event.startsAt, event.endsAt);
    return (
      <Link href={href} className={`${cardClass} w-[80vw] max-w-80 flex-col`}>
        {/* Badges sit beside the art, not inside it: the art is aria-hidden, the badges are content. */}
        <div className="relative">
          <EventArt {...art} className="aspect-[3/2]" />
          <p className="absolute left-3 top-3 flex flex-col items-center rounded-badge bg-card px-2 py-1 text-center text-foreground">
            <span className="font-heading text-sm leading-4 font-extrabold">{date.range}</span>{" "}
            <span className="eyebrow leading-3">{date.month}</span>
          </p>
          <span className={`${chipClass} bottom-3 left-3`}>{categoryLabel(event)}</span>
        </div>
        <div className="flex flex-1 flex-col gap-1 p-4">
          <h3 className={`${titleClass} line-clamp-2 text-base leading-[1.375rem]`}>{event.title}</h3>
          <p className="line-clamp-2 text-sm leading-5 text-muted">{firstSentence(event.description)}</p>
          <p className="text-xs leading-4 font-semibold">{formatFeedPrice(event)}</p>
          {going && <GoingStack count={going.count} initials={going.initials} className="mt-auto pt-1" />}
        </div>
      </Link>
    );
  }

  return (
    <Link href={href} className={`${cardClass} w-[62vw] max-w-60 flex-col`}>
      <div className="relative">
        <EventArt {...art} className="aspect-[4/3]" />
        <span className={`${chipClass} left-2 top-2`}>{categoryLabel(event)}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className={`${titleClass} line-clamp-2 text-sm leading-5`}>{event.title}</h3>
        <p className="flex items-center gap-1 text-xs leading-4 text-muted">
          <CalendarIcon className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {formatEventDateShort(event.startsAt)} · {formatEventTime(event.startsAt)}
          </span>
        </p>
        <p className="flex items-center gap-1 text-xs leading-4 text-muted">
          <PinIcon className="h-3 w-3 shrink-0" />
          <span className="truncate">{event.venueName || event.suburb}</span>
        </p>
        <p className="text-xs leading-4 font-semibold">{formatFeedPrice(event)}</p>
        {going && <GoingStack count={going.count} initials={going.initials} className="mt-auto pt-2" />}
      </div>
    </Link>
  );
}

/** The standard card's box with no content: holds Coming up's space while events load. */
export function HomeEventCardPlaceholder() {
  return (
    <div aria-hidden="true" className="w-[62vw] max-w-60 overflow-hidden rounded-card bg-surface">
      <div className="aspect-[4/3]" />
      <div className="h-40" />
    </div>
  );
}
