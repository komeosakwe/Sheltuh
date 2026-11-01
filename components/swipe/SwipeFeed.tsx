"use client";

import { useEffect, useRef } from "react";
import { useHomeEvents } from "@/components/home/HomeEventsProvider";
import { HOME_LOAD_ERROR } from "@/components/home/HomeEventSections";
import { isApiConfigured } from "@/lib/api/client";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { swipeFeedEvents } from "@/lib/home-sections";
import SwipeScreen, { SwipeClose } from "./SwipeScreen";

/** A full-screen state (loading, error, empty), one screen high like an event's. */
const STATE_SCREEN = "flex h-dvh snap-start flex-col justify-center px-5";

/**
 * /swipe: the vertical event feed (a TikTok-style, one event a screen).
 * Events come from the home's provider, so they are the home's sections in
 * the home's order, each once: This weekend, From organisers you follow, then
 * Popular right now or Coming up. Upcoming only: "Recently on" is left out.
 *
 * The `<main>` is the scroller (snap-y mandatory, one screen an event) and is
 * focusable, so the arrow and Page Down keys scroll it natively; it takes
 * focus on arrival so they work at once. A centred phone-width column on a
 * black page from 640px. Smooth scrolling only when motion is welcome. The
 * Close button (to /) stays in the top-left corner of every state.
 */
export default function SwipeFeed() {
  const { state, retry } = useHomeEvents();
  const mainRef = useRef<HTMLElement>(null);
  const retried = useRef(false);
  const retrying = state.status === "error" && state.retrying;
  const loading = state.status === "loading" || retrying;
  const events = state.status === "ready" ? swipeFeedEvents(state.sections) : [];

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, []);

  // After Try again the button is gone: hand focus back to the feed so the keys keep working.
  useEffect(() => {
    if (state.status !== "ready" || !retried.current) return;
    retried.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    mainRef.current?.focus({ preventScroll: true });
  }, [state.status]);

  function handleRetry() {
    retried.current = true;
    retry();
  }

  return (
    <div data-surface="ink" className="h-dvh">
      <main
        ref={mainRef}
        id="main"
        tabIndex={0}
        data-swipe-feed=""
        className="no-scrollbar mx-auto h-dvh w-full max-w-md snap-y snap-mandatory overflow-x-hidden overflow-y-auto overscroll-contain motion-safe:scroll-smooth focus-visible:-outline-offset-2"
      >
        <h1 className="sr-only">Events</h1>
        {/* Over the screens as they scroll; no height, so the first screen starts at the top. */}
        <div className="sticky top-0 z-20 h-0">
          <div className="absolute inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] flex items-center justify-between px-3">
            <SwipeClose />
            {!isApiConfigured && (
              <p role="note" data-demo-banner="" className="rounded-control bg-ink/70 px-3 py-1 text-xs leading-4 font-semibold text-paper">
                Demo · Sample data
              </p>
            )}
          </div>
        </div>
        {/* Always mounted so "Loading events…" is announced. */}
        <p role="status" className="sr-only">
          {loading ? "Loading events…" : ""}
        </p>

        {state.status === "loading" && (
          <div aria-hidden="true" data-swipe-loading="" className="h-dvh snap-start bg-surface" />
        )}

        {state.status === "error" && (
          <div className={STATE_SCREEN}>
            <Notice key={retrying ? "retrying" : "failed"} tone="danger" role="alert">
              {HOME_LOAD_ERROR}
            </Notice>
            <Button variant="outline" size="lg" className="mt-3 self-start" busy={retrying} onClick={handleRetry}>
              {retrying ? "Trying again…" : "Try again"}
            </Button>
          </div>
        )}

        {state.status === "ready" && events.length === 0 && (
          <div className={STATE_SCREEN}>
            <p className="text-base leading-6">No events yet.</p>
            <ButtonLink href="/events" variant="outline" size="lg" className="mt-3 self-start">
              All events
            </ButtonLink>
          </div>
        )}

        {state.status === "ready" &&
          events.map((event, index) => (
            <SwipeScreen key={event.id} event={event} now={state.now} first={index === 0} hint={index === 0 && events.length > 1} />
          ))}
      </main>
    </div>
  );
}
