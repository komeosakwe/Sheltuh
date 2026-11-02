"use client";

import { useEffect, type MouseEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { SwipeFeedItem } from "@/lib/home-sections";
import SwipeScreen from "@/components/swipe/SwipeScreen";
import { saveHomeFeedPosition, takeHomeFeedPosition } from "./homeFeedPosition";

/**
 * The phone home's events (below 640px, in place of the rails): the swipe
 * feed's screens one after another under the category row, then the end
 * screen. They are `SwipeScreen`s, each as tall as the area under the sticky
 * site header, in a `feed` inside the home's `<main>` (the event titles are
 * h2s under the hero's h1).
 *
 * While mounted the page's scroller (the root element) snaps `y proximity` to
 * the screens from the second on (see `SwipeScreen`), so the hero and search
 * still scroll freely. Unmounting (the
 * window grows past 640px, or the page changes) lets the snap go. The first
 * screen's photo loads at once, the rest lazily. Back from an event scrolls to
 * the screen you left (`homeFeedPosition`). The end screen is a short ink band, not a full screen: the home carries on below it.
 */
export default function HomeInlineFeed({ items, now }: { items: SwipeFeedItem[]; now: Date }) {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.scrollSnapType;
    root.style.scrollSnapType = "y proximity";
    return () => {
      root.style.scrollSnapType = before;
    };
  }, []);

  useEffect(() => {
    const saved = takeHomeFeedPosition();
    if (!saved) return;
    const screens = document.querySelectorAll<HTMLElement>("[data-home-feed] [data-event-id]");
    Array.from(screens)
      .find((el) => el.dataset.eventId === saved)
      ?.scrollIntoView({ behavior: "instant", block: "start" });
  }, []);

  // Any link in a screen (View event, Save's sign-in) leaves the page: remember which event it was on.
  function rememberScreen(e: MouseEvent<HTMLDivElement>) {
    if (!(e.target instanceof Element) || !e.target.closest("a")) return;
    const id = e.target.closest<HTMLElement>("[data-event-id]")?.dataset.eventId;
    if (id) saveHomeFeedPosition(id);
  }

  function backToTop() {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.getElementById("main")?.focus({ preventScroll: true });
  }

  return (
    <>
      {/* The screens follow the category row at once; the end screen is outside the feed, as on /swipe. */}
      <div role="feed" aria-busy="false" aria-label="Upcoming events" data-home-feed="" onClick={rememberScreen} className="mt-4">
        {items.map(({ event, section }, index) => (
          <SwipeScreen
            key={event.id}
            event={event}
            section={section}
            position={index + 1}
            total={items.length}
            now={now}
            first={index === 0}
            inline
          />
        ))}
      </div>
      <div data-swipe-end="" data-surface="ink" className="snap-start -scroll-mt-2 px-5 py-16">
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
    </>
  );
}
