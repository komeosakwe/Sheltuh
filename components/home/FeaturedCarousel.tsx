"use client";

import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import EventArt from "@/components/EventArt";
import { useClipViewer } from "@/components/events/ClipViewer";
import { ButtonLink } from "@/components/ui/Button";
import { useMotionOk } from "@/components/ui/useMotionOk";
import { cardCta, cardMetaParts, cardState, categoryLabel } from "@/lib/event-card";
import { formatCardPriceLabel, SOLD_OUT_LABEL } from "@/lib/pricing";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import type { SheltuhEvent } from "@/lib/types";
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from "./icons";

/** How long each slide shows before the next, while it plays (WCAG 2.2.2: over 5s, so it has a Pause). */
export const CAROUSEL_INTERVAL_MS = 6000;
/** At most this many slides. */
export const CAROUSEL_MAX = 5;
/** A scroll that has had no event for this long has ended (engines without `scrollend`). */
const SCROLL_REST_MS = 150;

/** The carousel's controls: 48px squares below md, 40px from md (the rules' icon buttons). */
const CONTROL =
  "flex size-12 shrink-0 items-center justify-center rounded-control border-control border-foreground bg-background text-foreground hover:bg-hover md:size-10 lg:border-ink lg:bg-paper lg:text-ink motion-safe:transition-colors motion-safe:duration-200";

/** The slide's mono line: the card's date, time and place, then the all-inclusive price ("From A$37.60"). */
function slideFacts(event: SheltuhEvent, now: Date): string {
  const state = cardState(event, now);
  const price = state === "sold-out" ? SOLD_OUT_LABEL : formatCardPriceLabel(event);
  return [...cardMetaParts(event, now), ...(price ? [price] : [])].join(" · ");
}

/**
 * The home's featured carousel (the proposal's full-width banner, redesign PR 3): one event at a
 * time, its photo full width with a black panel over its bottom-left holding the category (the
 * eyebrow says the category only: no "Featured" until promoted listings exist, owner decision),
 * the title in Display/M, one mono line (date, time, place and the all-inclusive price), the
 * event's own ticket action (Buy tickets, Free tickets, Choose seats or Join waitlist, as its
 * card would say; none when there's nothing to buy yet) and Details. The events are the page's
 * Popular right now (real trending), else Coming up: `title` names it for screen readers.
 *
 * It advances by itself every CAROUSEL_INTERVAL_MS, looping, only while motion is welcome
 * (never under reduced motion, where the Pause button isn't shown either), the tab is visible,
 * and nothing holds it: the pointer over it, focus in it (other than on Pause/Play), or the
 * page's clip viewer open. Pause/Play stops and restarts it; Previous, Next (looping) and a dot per slide move
 * between slides and stop it (the visitor has taken over). A swipe moves it too (native scroll
 * snapping). Moving never takes focus anywhere. The WAI carousel pattern: a region with
 * `aria-roledescription="carousel"`, each slide a labelled group ("2 of 5"), the slides' live
 * region off while it plays (so it isn't announced every few seconds) and polite otherwise.
 * Slides out of view are inert: out of the tab order and hidden from assistive tech.
 *
 * Below 1024px the controls sit under the photo; from 1024px they're over its bottom-right, in
 * white in both themes (as drawn), so they stand out on any photo.
 */
export default function FeaturedCarousel({
  id,
  title,
  events,
  now,
  className = "",
}: {
  /** The section's heading id. */
  id: string;
  /** The section's name ("Popular right now" or "Coming up"), a visually hidden h2. */
  title: string;
  events: SheltuhEvent[];
  now: Date;
  className?: string;
}) {
  const slides = events.slice(0, CAROUSEL_MAX);
  const count = slides.length;
  const trackId = `${id}-slides`;
  const trackRef = useRef<HTMLDivElement>(null);
  const motionOk = useMotionOk();
  const clipViewer = useClipViewer();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const indexRef = useRef(0);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const moving = motionOk && playing && count > 1;
  const advancing = moving && !hovered && !focused && !(clipViewer?.isOpen ?? false);

  function goTo(next: number) {
    const target = ((next % count) + count) % count;
    setIndex(target);
    indexRef.current = target;
    const track = trackRef.current;
    if (track && typeof track.scrollTo === "function") {
      track.scrollTo({ left: target * track.clientWidth, behavior: motionOk ? "smooth" : "auto" });
    }
  }

  useVisibleInterval(() => goTo(indexRef.current + 1), CAROUSEL_INTERVAL_MS, { enabled: advancing });

  // A swipe (or any scroll the carousel didn't make) settles on a slide: that's the current one.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (track.clientWidth <= 0) return;
      const nearest = Math.min(count - 1, Math.max(0, Math.round(track.scrollLeft / track.clientWidth)));
      if (nearest !== indexRef.current) {
        indexRef.current = nearest;
        setIndex(nearest);
      }
    };
    const onScroll = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(settle, SCROLL_REST_MS);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("scrollend", settle);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      track.removeEventListener("scroll", onScroll);
      track.removeEventListener("scrollend", settle);
    };
  }, [count]);

  // Focus anywhere in it holds it, except on Pause/Play (Play pressed from the keyboard plays: the WAI
  // carousel pattern); leaving lets it carry on.
  function handleFocus(event: FocusEvent<HTMLElement>) {
    setFocused(!(event.target instanceof Element && event.target.closest("[data-carousel-rotation]")));
  }
  function handleBlur(event: FocusEvent<HTMLElement>) {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocused(false);
  }
  // A mouse over it holds it (a touch is a swipe or a tap, which say it themselves).
  function handlePointer(event: PointerEvent<HTMLElement>, over: boolean) {
    if (event.pointerType === "mouse") setHovered(over);
  }

  function step(delta: number) {
    setPlaying(false);
    goTo(indexRef.current + delta);
  }

  if (count === 0) return null;

  return (
    <section
      aria-labelledby={id}
      aria-roledescription="carousel"
      data-home-section=""
      data-featured-carousel=""
      // Try again's focus lands here (it's the first section): the whole carousel is outlined.
      data-home-focus=""
      tabIndex={-1}
      className={`relative ${className}`.trim()}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPointerEnter={(event) => handlePointer(event, true)}
      onPointerLeave={(event) => handlePointer(event, false)}
    >
      <h2 id={id} tabIndex={-1} className="sr-only">
        {title}
      </h2>
      <div
        ref={trackRef}
        id={trackId}
        aria-live={advancing ? "off" : "polite"}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-card"
      >
        {slides.map((event, i) => {
          const cta = cardCta(event, now);
          const href = `/events/${event.slug}`;
          return (
            <div
              key={event.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              data-slide=""
              data-current={i === index ? "" : undefined}
              inert={i !== index}
              className="relative w-full shrink-0 snap-start overflow-hidden rounded-card"
            >
              <EventArt
                poster={event.poster}
                imageUrl={event.imageUrl}
                imageFocus={event.imageFocus}
                title={event.title}
                priority={i === 0}
                className="aspect-square w-full sm:aspect-video lg:aspect-[21/9]"
              />
              <div
                data-surface="ink"
                className="absolute inset-x-4 bottom-4 rounded-card bg-background/90 p-4 sm:right-auto sm:max-w-2xl md:bottom-6 lg:max-w-xl xl:max-w-2xl md:left-6 md:p-6 lg:bottom-8 lg:left-8"
              >
                <p className="mono-s text-signal uppercase">{categoryLabel(event)}</p>
                <h3 className="mt-2 line-clamp-3 font-display text-3xl leading-9 break-words uppercase md:display-m md:line-clamp-2">
                  {event.title}
                </h3>
                <p className="mono-s mt-3 uppercase">{slideFacts(event, now)}</p>
                <div className="mt-4 flex flex-wrap gap-2 md:gap-4">
                  {cta && (
                    // Named with the event (each slide has one), its visible words first (WCAG 2.5.3).
                    <ButtonLink href={cta.href} variant={cta.tone === "signal" ? "signal" : "outline"} aria-label={`${cta.label}: ${event.title}`}>
                      {cta.label}
                      <ArrowRightIcon className="size-4 shrink-0" />
                    </ButtonLink>
                  )}
                  <ButtonLink href={href} variant="outline" aria-label={`Details: ${event.title}`}>
                    Details
                  </ButtonLink>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {count > 1 && (
        <div
          data-carousel-controls=""
          className="mt-4 flex items-center justify-end gap-2 lg:absolute lg:right-8 lg:bottom-8 lg:mt-0"
        >
          {/* From 1024px the dots sit on a white pill over the photo, so they read on any image. */}
          <ul className="mr-2 flex items-center lg:h-10 lg:rounded-control lg:bg-paper lg:px-2" aria-label="Slides">
            {slides.map((event, i) => (
              <li key={event.id} className="flex">
                <button
                  type="button"
                  aria-label={`Slide ${i + 1}: ${event.title}`}
                  aria-current={i === index ? "true" : undefined}
                  aria-controls={trackId}
                  onClick={() => {
                    setPlaying(false);
                    goTo(i);
                  }}
                  className="group/dot flex size-6 items-center justify-center"
                >
                  <span
                    aria-hidden="true"
                    className={`block h-2 rounded-xs motion-safe:transition-all motion-safe:duration-200 ${
                      i === index ? "w-6 bg-signal" : "w-2 bg-muted group-hover/dot:bg-foreground lg:bg-ink/60 lg:group-hover/dot:bg-ink"
                    }`}
                  />
                </button>
              </li>
            ))}
          </ul>
          {motionOk && (
            <button
              type="button"
              data-carousel-rotation=""
              aria-label={playing ? "Pause carousel" : "Play carousel"}
              aria-controls={trackId}
              onClick={() => setPlaying((p) => !p)}
              className={CONTROL}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
          )}
          <button type="button" aria-label="Previous slide" aria-controls={trackId} onClick={() => step(-1)} className={CONTROL}>
            <ChevronLeftIcon />
          </button>
          <button type="button" aria-label="Next slide" aria-controls={trackId} onClick={() => step(1)} className={CONTROL}>
            <ChevronRightIcon />
          </button>
        </div>
      )}
    </section>
  );
}
