"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import EventArt from "@/components/EventArt";
import { COUNT_THRESHOLD } from "@/components/whos-going/WhosGoingProvider";
import { getGoingSummary } from "@/lib/api/going";
import type { GoingSummary } from "@/lib/api/types";
import { formatEventDateTimeRange } from "@/lib/format";
import { formatFeedPrice } from "@/lib/pricing";
import type { SheltuhEvent } from "@/lib/types";
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

/** "Up next": the soonest event as a big photo card with its details over a dark scrim. */
export default function FeaturedEventCard({ event, mode }: { event: SheltuhEvent; mode: "demo" | "live" }) {
  const liveCount = useLiveGoingCount(event.id, mode === "live");
  const going: { count: number; initials?: string[] } | null =
    mode === "demo" ? demoGoing(event.id) : liveCount === null ? null : { count: liveCount };

  return (
    <Link
      href={`/events/${event.slug}`}
      className="group relative block aspect-[4/5] overflow-hidden rounded-card bg-foreground text-background shadow-card motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.99] min-[375px]:aspect-square"
    >
      <div className="absolute inset-0">
        <EventArt poster={event.poster} imageUrl={event.imageUrl} title={event.title} className="h-full w-full" />
      </div>
      {/* Functional scrim: at least 85% black wherever text sits, so the text stays readable over any photo. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-t from-foreground from-35% via-foreground/85 via-65% to-foreground/10"
      />
      <div className="absolute inset-x-0 bottom-0 flex flex-col p-5 pr-16">
        <span className="eyebrow self-start rounded-full bg-pop px-3 py-1 text-foreground">Up next</span>
        <h3 className="mt-2 line-clamp-2 text-[clamp(1.75rem,8vw,2rem)] leading-[0.95] underline-offset-4 group-hover:underline">
          {event.title}
        </h3>
        <div className="mt-2 text-sm leading-5">
          <p>{formatEventDateTimeRange(event.startsAt, event.endsAt)}</p>
          <p className="truncate text-background/80">
            {[event.venueName, event.suburb].filter(Boolean).join(" · ")}
          </p>
          <p className="font-semibold">{formatFeedPrice(event)}</p>
        </div>
        {going && <GoingStack tone="dark" count={going.count} initials={going.initials} className="mt-2" />}
      </div>
      <span
        aria-hidden="true"
        className="absolute bottom-5 right-5 flex size-11 items-center justify-center rounded-full bg-background text-foreground"
      >
        <ChevronRightIcon />
      </span>
    </Link>
  );
}

/** The featured card's box while events load. */
export function FeaturedEventCardPlaceholder() {
  return <div aria-hidden="true" className="aspect-[4/5] rounded-card bg-surface min-[375px]:aspect-square" />;
}
