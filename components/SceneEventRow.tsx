import Link from "next/link";
import EventArt from "@/components/EventArt";
import { EVENT_CATEGORIES } from "@/lib/types";
import type { SheltuhEvent } from "@/lib/types";
import { formatFeedPrice } from "@/lib/pricing";
import { formatEventDateShort, formatEventTime } from "@/lib/format";

const ORANGE = "#e15b27";

interface SceneEventRowProps {
  event: SheltuhEvent;
  selected: boolean;
  onSelect: (eventId: string) => void;
  hasLocation: boolean;
}

export default function SceneEventRow({ event, selected, onSelect, hasLocation }: SceneEventRowProps) {
  const categoryLabel = EVENT_CATEGORIES.find((c) => c.value === event.category)?.label ?? event.category;
  const priceLabel = formatFeedPrice(event);

  return (
    <div
      className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-surface-border px-4 py-3 transition-colors last:border-b-0"
      style={selected ? { background: "#24140e", borderLeft: `2px solid ${ORANGE}` } : { borderLeft: "2px solid transparent" }}
    >
      <button
        type="button"
        onClick={() => onSelect(event.id)}
        aria-pressed={selected}
        className="flex min-w-0 items-center gap-3 text-left"
      >
        <EventArt poster={event.poster} title={event.title} className="h-14 w-14 flex-shrink-0 rounded" />
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{event.title}</h3>
          <p className="truncate text-xs text-muted">
            {event.suburb} &middot; {formatEventDateShort(event.startsAt)}, {formatEventTime(event.startsAt)}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {categoryLabel} &middot; <span className="text-foreground">{priceLabel}</span>
            {!hasLocation && <span className="ml-1.5">&middot; not shown on map</span>}
          </p>
        </div>
      </button>
      <Link
        href={`/events/${event.slug}`}
        className="text-xs font-medium underline underline-offset-2"
        style={{ color: ORANGE }}
      >
        View &rarr;
      </Link>
    </div>
  );
}
