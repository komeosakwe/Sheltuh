"use client";

import { useEffect, useMemo, useRef } from "react";
import { useHomeEvents } from "@/components/home/HomeEventsProvider";
import { HOME_LOAD_ERROR } from "@/components/home/HomeEventSections";
import { isApiConfigured } from "@/lib/api/client";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { swipeFeedEvents } from "@/lib/home-sections";
import SwipeScreen, { SwipeClose } from "./SwipeScreen";
import { readSwipePosition, saveSwipePosition } from "./swipePosition";

/** A full-screen state (loading, error, empty, the end), a screen high like an event's, taller if it must be. */
const STATE_SCREEN = "flex min-h-dvh snap-start flex-col justify-center px-5 pt-[calc(4.5rem+env(safe-area-inset-top))] pb-8";

/**
 * /swipe: the vertical event feed (a TikTok-style, one event a screen).
 * Events come from the home's provider, so they are the home's sections in
 * the home's order, each once: This weekend, From organisers you follow, then
 * Popular right now or Coming up. Upcoming only: "Recently on" is left out.
 *
 * The `<main>` is the scroller (snap-y, one screen an event) and is
 * focusable, so the arrow and Page Down keys scroll it natively; it takes
 * focus on arrival so they work at once. The snap is mandatory only in a
 * window tall enough (560px) for a whole event; in a short one (a phone on its
 * side, 320×256) a screen is as tall as its text and the snap is proximity, so
 * nothing is clipped or out of reach. A centred phone-width column on a black
 * page (the page behind it too, so an overscroll shows no white) from 640px.
 * Smooth scrolling only when motion is welcome. The Close button (to /) stays
 * in the top-left corner of every state. The events are a `feed`: the last
 * screen says that's everything. The event on screen is kept in
 * sessionStorage, so Back from an event lands on it again.
 */
export default function SwipeFeed() {
  const { state, retry } = useHomeEvents();
  const mainRef = useRef<HTMLElement>(null);
  const retried = useRef(false);
  const retrying = state.status === "error" && state.retrying;
  const loading = state.status === "loading" || retrying;
  const items = useMemo(() => (state.status === "ready" ? swipeFeedEvents(state.sections) : []), [state]);
  const ready = state.status === "ready";

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, []);

  // A black page behind the feed, only while it is open (the root element, so an overscroll shows no white).
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.backgroundColor;
    root.style.backgroundColor = "var(--ink)";
    return () => {
      root.style.backgroundColor = before;
    };
  }, []);

  // Keep the place: jump to the stored event once (Back from an event), then track the event on screen.
  const restored = useRef(false);
  useEffect(() => {
    const main = mainRef.current;
    if (!main || items.length === 0) return;
    const screens = Array.from(main.querySelectorAll<HTMLElement>("[data-event-id]"));
    if (!restored.current) {
      restored.current = true;
      const saved = readSwipePosition();
      screens.find((el) => el.dataset.eventId === saved)?.scrollIntoView({ behavior: "instant", block: "start" });
    }
    if (typeof IntersectionObserver === "undefined") return;
    // A band at the scroller's middle line: the screen crossing it is the one on view, however tall it is.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.isIntersecting && entry.target instanceof HTMLElement ? entry.target.dataset.eventId : undefined;
          if (id) saveSwipePosition(id);
        }
      },
      { root: main, rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );
    for (const el of screens) observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  function backToTop() {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTo({ top: 0 });
    main.focus({ preventScroll: true });
  }

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
        aria-label="Events"
        aria-describedby="swipe-keys"
        className="no-scrollbar mx-auto h-dvh w-full max-w-md snap-y snap-proximity [@media(min-height:560px)]:snap-mandatory overflow-x-hidden overflow-y-auto overscroll-contain motion-safe:scroll-smooth focus-visible:-outline-offset-2"
      >
        <h1 className="sr-only">Events</h1>
        <p id="swipe-keys" className="sr-only">
          Use arrow keys or Page Down to move between events.
        </p>
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
          {loading ? "Loading events…" : ready && items.length > 0 ? `${items.length} ${items.length === 1 ? "event" : "events"}` : ""}
        </p>

        {(state.status === "loading" || items.length > 0) && (
          <div role="feed" aria-busy={state.status === "loading"}>
            {state.status === "loading" && (
              <div aria-hidden="true" data-swipe-loading="" className="min-h-dvh snap-start bg-surface" />
            )}
            {state.status === "ready" &&
              items.map(({ event, section }, index) => (
                <SwipeScreen
                  key={event.id}
                  event={event}
                  section={section}
                  position={index + 1}
                  total={items.length}
                  now={state.now}
                  first={index === 0}
                  hint={index === 0 && items.length > 1}
                />
              ))}
          </div>
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

        {ready && items.length === 0 && (
          <div className={STATE_SCREEN}>
            <p className="text-base leading-6">No events yet.</p>
            <ButtonLink href="/events" variant="outline" size="lg" className="mt-3 self-start">
              All events
            </ButtonLink>
          </div>
        )}

        {ready && items.length > 0 && (
          <div data-swipe-end="" className={STATE_SCREEN}>
            <p className="text-2xl leading-8 font-bold tracking-[-0.02em]">That’s everything</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <ButtonLink href="/events" variant="outline" size="lg">
                All events
              </ButtonLink>
              <Button variant="outline" size="lg" onClick={backToTop}>
                Back to top
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
