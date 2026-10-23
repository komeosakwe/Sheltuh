"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import NotFoundMessage from "@/components/NotFoundMessage";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { ApiError } from "@/lib/api/client";
import { getPublicEventBySlug } from "@/lib/api/public-events";
import { getSeatAvailability, getSeatMap } from "@/lib/api/seating";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { unavailablePositions } from "@/lib/seating/availability";
import type { SheltuhEvent } from "@/lib/types";
import SeatPicker, { SeatPickerLoading, type SeatPickerMap } from "./SeatPicker";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "no-map"; event: SheltuhEvent }
  | { status: "error"; attempt: number }
  | { status: "ready"; event: SheltuhEvent; map: SeatPickerMap; unavailable: number[] };

/** The map and what's unavailable on it, together (a map without availability would offer taken seats). */
async function loadMap(event: SheltuhEvent, version?: number): Promise<{ map: SeatPickerMap; unavailable: number[] }> {
  const [record, availability] = await Promise.all([getSeatMap(event.id, version), getSeatAvailability(event.id)]);
  // A bitmap for another version (the map was just replaced) or unreadable: treat every seat as taken
  // until the next poll, never as free.
  const positions =
    availability.version === record.version ? unavailablePositions(availability.unavailable, record.seatCount) : null;
  return {
    map: { version: record.version, seatCount: record.seatCount, template: record.template },
    unavailable: positions ?? Array.from({ length: record.seatCount }, (_, i) => i),
  };
}

/**
 * The live seat page (docs/design/seating.md §5.2): loads the event by slug,
 * then its map and availability, with loading, not-found and error states.
 * A map replaced while the page is open is reloaded with the event, in place
 * (the picker keeps the buyer's seats that are still on it).
 */
export default function LiveSeatPage({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const errorHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const event = adaptPublicEvent(await getPublicEventBySlug(slug));
        if (!event.seating) {
          if (!cancelled) setState({ status: "no-map", event });
          return;
        }
        const loaded = await loadMap(event, event.seating.version);
        if (!cancelled) setState({ status: "ready", event, ...loaded });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setState({ status: "not-found" });
        else setState((prev) => ({ status: "error", attempt: prev.status === "error" ? prev.attempt + 1 : 0 }));
      } finally {
        if (!cancelled) setRetrying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

  const title = state.status === "ready" || state.status === "no-map" ? `Choose seats — ${state.event.title} — Sheltüh` : null;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  useEffect(() => {
    if (state.status === "error" && retrying === false && attempt > 0) errorHeadingRef.current?.focus();
  }, [state, retrying, attempt]);

  // The availability poll (or a checkout) saw another map version: load the event again (its tiers,
  // prices and seated flags may have changed with the map), then the current map. The picker keeps
  // its selection and drops seats that are no longer on the map.
  const reloading = useRef(false);
  const reloadMap = useCallback(() => {
    if (reloading.current) return;
    reloading.current = true;
    (async () => {
      try {
        const event = adaptPublicEvent(await getPublicEventBySlug(slug));
        if (!event.seating) {
          setState({ status: "no-map", event });
          return;
        }
        const loaded = await loadMap(event);
        setState({ status: "ready", event, ...loaded });
      } catch {
        // Keep the page as it is; the next poll tries again.
      } finally {
        reloading.current = false;
      }
    })();
  }, [slug]);

  if (state.status === "loading") return <SeatPickerLoading />;
  if (state.status === "not-found") return <NotFoundMessage />;
  if (state.status === "no-map") {
    return (
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-5 py-16 sm:px-8">
        <h1 className="font-heading text-2xl">This event doesn&rsquo;t have numbered seats</h1>
        <p className="text-sm text-muted">Choose tickets on the event page instead.</p>
        <Link href={`/events/${state.event.slug}#tickets`} className="inline-flex min-h-11 items-center underline underline-offset-4">
          Go to tickets
        </Link>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-5 py-16 sm:px-8">
        <h1 ref={errorHeadingRef} tabIndex={-1} className="font-heading text-2xl outline-offset-2">
          Choose seats
        </h1>
        <Notice key={state.attempt} tone="danger" role="alert">
          We couldn&rsquo;t load the seat map.
        </Notice>
        <Button
          variant="outline"
          size="lg"
          busy={retrying}
          onClick={() => {
            setRetrying(true);
            setAttempt((n) => n + 1);
          }}
        >
          {retrying ? "Trying again…" : "Try again"}
        </Button>
        <Link href={`/events/${slug}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
          Back to the event
        </Link>
      </div>
    );
  }
  return (
    <SeatPicker
      event={state.event}
      map={state.map}
      mode="live"
      initialUnavailable={state.unavailable}
      poll={{}}
      onMapStale={reloadMap}
    />
  );
}
