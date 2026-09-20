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
  onLocate: (eventId: string) => void;
  hasLocation: boolean;
  detailsHref: string;
}

/**
 * A row is a title Link (navigates to the details page) plus a separate
 * "locate on map" button (selects + pans) — two independent, non-nested
 * interactive elements, rather than one big clickable card wrapping a link.
 */
export default function SceneEventRow({ event, selected, onLocate, hasLocation, detailsHref }: SceneEventRowProps) {
  const categoryLabel = EVENT_CATEGORIES.find((c) => c.value === event.category)?.label ?? event.category;
  const priceLabel = formatFeedPrice(event);

  return (
    <div
      className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-surface-border px-4 py-3 transition-colors last:border-b-0"
      style={
        selected
          ? { background: "#24140e", boxShadow: `inset 2px 0 0 ${ORANGE}` }
          : { boxShadow: "inset 2px 0 0 transparent" }
      }
    >
      <EventArt
        poster={event.poster}
        title={event.title}
        className="h-20 w-20 flex-shrink-0 rounded sm:h-24 sm:w-24"
      />

      <div className="min-w-0">
        {selected && (
          <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: ORANGE }}>
            <span aria-hidden="true">&#10003;</span> Selected
          </span>
        )}
        <Link
          href={detailsHref}
          className="block font-sans text-[17px] leading-snug font-semibold text-foreground underline-offset-2 hover:underline sm:text-[18px]"
        >
          {event.title}
        </Link>
        <p className="mt-1 truncate font-sans text-sm text-muted">
          {formatEventDateShort(event.startsAt)}, {formatEventTime(event.startsAt)}
        </p>
        <p className="truncate font-sans text-sm text-muted">
          {event.venueName} &middot; {event.suburb}
        </p>
        <p className="mt-1 font-sans text-sm">
          <span className="text-muted">{categoryLabel}</span>
          <span className="text-muted"> &middot; </span>
          <span className="font-medium text-foreground">{priceLabel}</span>
          {!hasLocation && <span className="ml-1.5 text-muted">&middot; not shown on map</span>}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onLocate(event.id)}
        disabled={!hasLocation}
        aria-pressed={selected}
        aria-label={`Locate ${event.title} on the map`}
        title="Locate on map"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border font-sans text-base transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        style={
          selected
            ? { background: ORANGE, borderColor: ORANGE, color: "#17140f" }
            : { background: "#151311", borderColor: "#3d352e", color: "#d5cec3" }
        }
      >
        <span aria-hidden="true">&#8982;</span>
      </button>
    </div>
  );
}
