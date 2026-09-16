import Link from "next/link";
import type { SheltuhEvent } from "@/lib/types";
import { EVENT_CATEGORIES } from "@/lib/types";
import { getFromPriceCents, isFreeEvent } from "@/lib/data";
import { formatAud, formatEventDate, formatEventTime } from "@/lib/format";

export default function EventCard({ event }: { event: SheltuhEvent }) {
  const categoryLabel =
    EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ??
    event.category;
  const free = isFreeEvent(event);
  const priceLabel = free ? "Free" : `From ${formatAud(getFromPriceCents(event))}`;

  return (
    <Link
      href={`/events/${event.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-surface-border bg-surface transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div
        aria-hidden="true"
        className="relative flex h-36 items-end p-3 sm:h-40"
        style={{
          background: `linear-gradient(135deg, ${event.imageGradient[0]}, ${event.imageGradient[1]})`,
        }}
      >
        <span className="rounded bg-black/50 px-2 py-1 text-xs font-medium uppercase tracking-wide text-white">
          {categoryLabel}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-heading text-2xl text-foreground group-hover:text-accent">
          {event.title}
        </h3>
        <p className="text-sm text-muted">
          {formatEventDate(event.startsAt)} &middot; {formatEventTime(event.startsAt)}
        </p>
        <p className="text-sm text-muted">{event.suburb}</p>
        <p className="mt-auto pt-2 text-sm font-semibold text-foreground">{priceLabel}</p>
      </div>
    </Link>
  );
}
