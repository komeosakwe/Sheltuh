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

/** The featured card's media ratio (docs/design/home.md §5.5, owner decision 7): landscape at every width. */
const FEATURED_ASPECT = "aspect-[4/3] min-[375px]:aspect-video sm:aspect-[2/1] lg:aspect-[4/3]";

/**
 * The featured card's box: a landscape card at every width, so the hero
 * stays compact and the events below it show without scrolling. Shared by
 * every Up next state, so a loading, error or empty box holds exactly the
 * card's space.
 */
export const FEATURED_BOX = `${FEATURED_ASPECT} rounded-card`;

/**
 * "Up next": the soonest event as one photo link, its details on a black
 * panel along the bottom of the photo (the ink scope, so its text and
 * avatars invert) that fades out above the text. The photo and the panel
 * share one grid cell: the photo sets the card's least height, and the
 * panel, in flow, grows the card when its text needs more room (larger
 * text sizes, narrow cards), so nothing is ever clipped and the text never
 * sits on the fade (cream on black, 20:1; muted 7.9:1). Save sits on the
 * photo, outside the link. An external event has no Who's Going, so no
 * count and no request.
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
  const ids = { title: `${id}-title`, meta: `${id}-meta`, going: `${id}-going` };

  return (
    <div className="relative">
      <Link
        href={`/events/${event.slug}`}
        aria-labelledby={[ids.title, ids.meta, going ? ids.going : null].filter(Boolean).join(" ")}
        className="group relative grid overflow-hidden rounded-card bg-ink motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.99]"
      >
        <EventArt
          poster={event.poster}
          imageUrl={event.imageUrl}
          title={event.title}
          priority
          motion
          className={`col-start-1 row-start-1 h-full w-full ${FEATURED_ASPECT}`}
        />
        {/* The ink scope is inside the link, so the link's own focus ring stays the page's black. */}
        <div
          data-surface="ink"
          className="relative col-start-1 row-start-1 flex flex-col self-end p-4 pr-16 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-12 before:bg-linear-to-t before:from-ink before:to-ink/0 sm:max-w-[36rem] sm:p-6 sm:pr-20"
        >
          <span className="eyebrow flex items-center gap-2 self-start rounded-badge bg-signal px-2 py-1 text-signal-foreground">
            <DotsMark size="xs" />
            Up next
          </span>
          <h3
            id={ids.title}
            className="mt-2 line-clamp-2 font-heading text-[1.375rem] leading-[0.95] tracking-[-0.025em] uppercase underline-offset-4 group-hover:underline sm:mt-3 sm:text-[2rem] md:text-[2.5rem] lg:text-[1.75rem]"
          >
            {event.title}
          </h3>
          <div id={ids.meta} className="mt-1.5 text-sm leading-5 sm:mt-2 sm:text-base sm:leading-6 lg:text-sm lg:leading-5">
            <p>{formatEventDateTimeRange(event.startsAt, event.endsAt)}</p>
            <p className="truncate text-muted">{[event.venueName, event.suburb].filter(Boolean).join(" · ")}</p>
            <CardPrice event={event} />
          </div>
          {going && (
            <div id={ids.going} className="mt-1.5 sm:mt-2">
              <GoingStack count={going.count} initials={going.initials} />
            </div>
          )}
        </div>
        <span
          aria-hidden="true"
          className="absolute bottom-4 right-4 flex size-11 items-center justify-center rounded-control bg-cream text-ink sm:bottom-6 sm:right-6"
        >
          <ChevronRightIcon />
        </span>
      </Link>
      <SaveButton
        event={{ id: event.id, title: event.title, slug: event.slug }}
        variant="overlay"
        className="absolute right-1 top-1 sm:right-3 sm:top-3"
      />
    </div>
  );
}

/** The featured card's box while events load. */
export function FeaturedEventCardPlaceholder() {
  return <div aria-hidden="true" className={`bg-surface ${FEATURED_BOX}`} />;
}
