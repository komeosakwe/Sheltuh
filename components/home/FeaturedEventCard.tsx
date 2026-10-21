"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import DotsMark from "@/components/brand/DotsMark";
import EventArt from "@/components/EventArt";
import SaveButton from "@/components/favourites/SaveButton";
import { COUNT_THRESHOLD } from "@/components/whos-going/WhosGoingProvider";
import { getGoingSummary } from "@/lib/api/going";
import type { GoingSummary } from "@/lib/api/types";
import { formatEventDateTimeRange } from "@/lib/format";
import type { SheltuhEvent } from "@/lib/types";
import CardPrice from "./CardPrice";
import GoingStack from "./GoingStack";
import { demoGoing } from "./going";
import { ChevronRightIcon } from "./icons";

/**
 * Live "N going" for the featured card only: one summary request. Shown only
 * when the API gives a real number at or above the threshold; loading, an
 * error, a hidden count and a closed list all show nothing (it's an extra
 * signal, not the card's content) and reserve no space. No initials: signed-out
 * visitors never receive names.
 */
function useLiveGoingCount(eventId: string, enabled: boolean): number | null {
  const [result, setResult] = useState<{ eventId: string; summary: GoingSummary | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getGoingSummary(eventId).then(
      (summary) => {
        if (!cancelled) setResult({ eventId, summary });
      },
      () => {
        if (!cancelled) setResult({ eventId, summary: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, enabled]);

  const summary = result?.eventId === eventId ? result.summary : null;
  if (!summary || summary.closed || summary.countHidden || summary.count < COUNT_THRESHOLD) return null;
  return summary.count;
}

/**
 * The featured card's photo ratio (docs/design/home.md §5.5): a wide strip,
 * thinnest on phones so the next section's heading is still on the first
 * screen (owner decision 7), and never under 40% of the card.
 */
const FEATURED_ASPECT = "aspect-[4/1] sm:aspect-[2/1] lg:aspect-video";

/**
 * The featured card's box: the photo strip plus the text block under it, so
 * the hero stays compact and the events below it show without scrolling.
 * Shared by every Up next state, so a loading, error or empty box holds about
 * the card's space.
 */
export const FEATURED_BOX = "aspect-[8/5] sm:aspect-[4/3] lg:aspect-square rounded-card";

/**
 * "Up next": the soonest event as one link, the photo on top and its details
 * on a black block below it (the ink scope, so its text and avatars invert;
 * cream on black, 20:1; muted 7.9:1). Nothing is laid over the photo but
 * Save and the "Up next" chip in its corners (an opaque badge, like the
 * tiles' category chip), so the photo is seen. Save sits on the photo, outside
 * the link. An external event has no Who's Going, so no count and no
 * request; the count, when there is one, shares the price's line.
 *
 * The link's name is the title, then the date, place, price and going
 * count (aria-labelledby): the "Up next" chip repeats the section's name.
 */
export default function FeaturedEventCard({ event, mode }: { event: SheltuhEvent; mode: "demo" | "live" }) {
  const external = event.ticketingMode === "external";
  const liveCount = useLiveGoingCount(event.id, mode === "live" && !external);
  const going: { count: number; initials?: string[] } | null = external
    ? null
    : mode === "demo"
      ? demoGoing(event.id)
      : liveCount === null
        ? null
        : { count: liveCount };
  const id = useId();
  const ids = { title: `${id}-title`, meta: `${id}-meta`, price: `${id}-price`, going: `${id}-going` };

  return (
    <div className="relative">
      <Link
        href={`/events/${event.slug}`}
        aria-labelledby={[ids.title, ids.meta, ids.price, going ? ids.going : null].filter(Boolean).join(" ")}
        className="group relative flex flex-col overflow-hidden rounded-card bg-ink motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.99]"
      >
        <EventArt
          poster={event.poster}
          imageUrl={event.imageUrl}
          title={event.title}
          priority
          motion
          className={`w-full ${FEATURED_ASPECT}`}
        />
        {/* An opaque badge in the photo's corner (black on orange, 6.18:1, whatever the photo). */}
        <span className="eyebrow absolute top-2 left-2 flex items-center gap-2 rounded-badge bg-signal px-2 py-1 text-signal-foreground sm:top-3 sm:left-3">
          <DotsMark size="xs" />
          Up next
        </span>
        {/* The ink scope is inside the link, so the link's own focus ring stays the page's black. */}
        <div data-surface="ink" className="relative flex flex-col p-3 pr-16 sm:p-5 sm:pr-20">
          <h3
            id={ids.title}
            className="line-clamp-2 font-heading text-[1.375rem] leading-[0.95] tracking-[-0.025em] uppercase underline-offset-4 group-hover:underline sm:text-[1.75rem]"
          >
            {event.title}
          </h3>
          <div className="mt-1 text-sm leading-5 sm:mt-2">
            <div id={ids.meta}>
              <p>{formatEventDateTimeRange(event.startsAt, event.endsAt)}</p>
              <p className="truncate text-muted">{[event.venueName, event.suburb].filter(Boolean).join(" · ")}</p>
            </div>
            {/* The price and the going count share a line. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <CardPrice id={ids.price} event={event} />
              {going && <GoingStack id={ids.going} count={going.count} initials={going.initials} />}
            </div>
          </div>
        </div>
        <span
          aria-hidden="true"
          className="absolute right-3 bottom-3 flex size-11 items-center justify-center rounded-control bg-cream text-ink sm:right-5 sm:bottom-5"
        >
          <ChevronRightIcon />
        </span>
      </Link>
      <SaveButton
        event={{ id: event.id, title: event.title, slug: event.slug }}
        variant="overlay"
        className="absolute right-1 top-1"
      />
    </div>
  );
}

/** The featured card's box while events load. */
export function FeaturedEventCardPlaceholder() {
  return <div aria-hidden="true" className={`bg-surface ${FEATURED_BOX}`} />;
}
