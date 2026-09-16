import Link from "next/link";
import EventArt from "@/components/EventArt";
import type { SheltuhEvent } from "@/lib/types";
import { EVENT_CATEGORIES } from "@/lib/types";
import { formatFeedPrice } from "@/lib/pricing";
import { formatEventDateShort, formatEventTime } from "@/lib/format";

export default function EventCard({ event }: { event: SheltuhEvent }) {
  const categoryLabel =
    EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ??
    event.category;
  const priceLabel = formatFeedPrice(event);

  return (
    <Link
      href={`/events/${event.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-surface-border bg-surface transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <EventArt poster={event.poster} title={event.title} className="h-24 sm:h-32">
        <span className="rounded bg-black/50 px-2 py-1 text-xs font-medium uppercase tracking-wide text-white">
          {categoryLabel}
        </span>
      </EventArt>
      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        <h3 className="font-heading text-xl text-foreground group-hover:text-accent sm:text-2xl">
          {event.title}
        </h3>
        <p className="text-xs text-muted sm:text-sm">
          {formatEventDateShort(event.startsAt)}, {formatEventTime(event.startsAt)} &middot;{" "}
          {event.suburb}
        </p>
        <p className="mt-auto pt-1 text-sm font-semibold text-foreground">{priceLabel}</p>
      </div>
    </Link>
  );
}
