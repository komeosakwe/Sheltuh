"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import EventCard, { EventCardPlaceholder } from "@/components/ui/EventCard";
import { Notice } from "@/components/ui/Section";
import ScrollHint from "@/components/ui/ScrollHint";
import { ArrowRightIcon } from "@/components/home/icons";
import { preferState } from "@/lib/home-sections";
import { readStoredNearState, subscribeStoredNear } from "@/lib/near-storage";
import { useCommunityEvents } from "./CommunityEventsProvider";
import { LOCAL_DISCOVERY, PANEL_LINE } from "./community-content";

/** How many events the row shows. */
export const LOCAL_DISCOVERY_MAX = 6;
/** The page's one load error, shown here (Scenes by city then shows its cities without counts). */
export const COMMUNITY_LOAD_ERROR = "Couldn’t load events. Check your connection and try again.";

const serverNull = () => null;

/**
 * "Local discovery" (the proposal's panel, redesign PR 3): its title and line, then the soonest
 * upcoming events as a sideways row of the one EventCard (256px each, so a card's foot stays on
 * one line), the saved suburb's state first (read in the browser, never sent; as the home), and
 * "See events on Nearby". A cream panel (--hover), as tall as the panel beside it. While loading, placeholders; on failure, the error with Try again; with
 * nothing upcoming, a line saying so.
 */
export default function LocalDiscovery({ className = "" }: { className?: string }) {
  const { mode, state, retry } = useCommunityEvents();
  const preferredState = useSyncExternalStore(subscribeStoredNear, readStoredNearState, serverNull);
  const events =
    state.status === "ready"
      ? preferState(state.feed.events, preferredState, (event) => event).slice(0, LOCAL_DISCOVERY_MAX)
      : [];

  return (
    <section aria-labelledby="community-local" className={`flex flex-col rounded-card bg-hover p-6 md:p-8 lg:p-12 ${className}`.trim()}>
      <h2 id="community-local" className="heading-h1">
        {LOCAL_DISCOVERY.title}
      </h2>
      <p className={PANEL_LINE}>{LOCAL_DISCOVERY.body}</p>
      <p role="status" className="sr-only">
        {state.status === "loading" || (state.status === "error" && state.retrying) ? "Loading events…" : ""}
      </p>

      {state.status === "loading" && (
        <div aria-hidden="true" className="mt-6 flex gap-6 overflow-hidden">
          {Array.from({ length: 3 }, (_, i) => (
            <EventCardPlaceholder key={i} variant="grid" className="w-64 shrink-0" />
          ))}
        </div>
      )}

      {state.status === "error" && (
        <div className="mt-6">
          <Notice tone="danger" role="alert">
            {COMMUNITY_LOAD_ERROR}
          </Notice>
          <Button variant="outline" className="mt-4" busy={state.retrying} onClick={retry}>
            {state.retrying ? "Trying again…" : "Try again"}
          </Button>
        </div>
      )}

      {state.status === "ready" && events.length === 0 && <p className="mt-6 body-m">No events yet.</p>}

      {events.length > 0 && state.status === "ready" && (
        <ScrollHint className="-mx-6 mt-6 md:-mx-8 lg:-mx-12" fadeClassName="hidden">
          <ul
            aria-labelledby="community-local"
            className="no-scrollbar flex snap-x snap-mandatory gap-6 overflow-x-auto overscroll-x-contain scroll-px-6 px-6 py-4 md:scroll-px-8 md:px-8 lg:scroll-px-12 lg:px-12"
          >
            {events.map((event) => (
              <li key={event.id} className="flex w-64 shrink-0 snap-start">
                <EventCard event={event} variant="grid" mode={mode} now={state.now} />
              </li>
            ))}
          </ul>
        </ScrollHint>
      )}

      <Link href="/map" className="label-button mt-auto inline-flex min-h-12 items-center gap-2 self-start pt-4 underline underline-offset-4">
        See events on Nearby
        <ArrowRightIcon className="size-4 shrink-0" />
      </Link>
    </section>
  );
}
