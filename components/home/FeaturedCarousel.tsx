"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import EventArt from "@/components/EventArt";
import { useClipViewer } from "@/components/events/ClipViewer";
import { ButtonLink } from "@/components/ui/Button";
import { useMotionOk } from "@/components/ui/useMotionOk";
import { cardCta, categoryLabel, slideFacts } from "@/lib/event-card";
import { FEATURED_MAX } from "@/lib/home-sections";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import type { SheltuhEvent } from "@/lib/types";
import { ArrowRightIcon, PauseIcon, PlayIcon } from "./icons";

/** How long each slide shows before the next, while it plays (WCAG 2.2.2: over 5s, so it has a Pause). */
export const CAROUSEL_INTERVAL_MS = 6000;
/** At most this many slides (lib/home-sections.ts picks no more for it). */
export const CAROUSEL_MAX = FEATURED_MAX;
/** A scroll that has had no event for this long has ended (engines without `scrollend`). */
const SCROLL_REST_MS = 150;

/**
 * Pause/Play over the photo: white with a black edge in both themes, 48px below 768px and 40px from it.
 * The cream hover (and its focus twin) is Light's; in Dark --hover is near-black, which would hide the
 * black icon, so the button stays white there and the white focus ring carries the state.
 */
const ROTATION =
  "flex size-12 shrink-0 items-center justify-center rounded-control border-control border-ink bg-paper text-ink hover:bg-hover focus-visible:bg-hover dark:hover:bg-paper dark:focus-visible:bg-paper md:size-10 motion-safe:transition-colors motion-safe:duration-200";

/**
 * Where the photo's subject sits when the event has no `imageFocus` (Round 2 §1.1): the middle on
 * phones, a little higher on wider crops, so subjects stay above the text at the bottom.
 */
const FOCUS_DEFAULTS = "object-[50%_50%] sm:object-[50%_40%] lg:object-[50%_35%]";

/**
 * The home's featured banner (the proposal's full-width banner, redesign PR 3; Round 2 §1.1): one
 * event at a time, its photo full bleed (4:5 below 640px, 2:1 to 1023px, 5:2 from 1024px) under a
 * black gradient (60% ink by a fifth to a third of the way down, 80–85% at the bottom: §1.1's clear
 * to 35% failed WCAG 1.4.3 on bright photos), with no box: the category (no "Featured"
 * until promoted listings exist, owner decision), the title in title-banner (Bootzy, as entered),
 * "date · venue" and the event's own ticket action (Buy tickets, Free tickets, Choose seats or Join
 * waitlist, as its card would say; none when there's nothing to buy yet), M below 1440px and L from
 * it. The events are the page's Popular right now (real trending), else Coming up: `title` names it
 * for screen readers.
 *
 * The whole slide opens the event: the title's link is stretched over it (`::after`), and the ticket
 * action is a sibling raised above it (z-10), never nested in the link. Hovering the slide underlines
 * the title; keyboard focus on it does too, with the global ring (white in ink).
 *
 * It advances by itself every CAROUSEL_INTERVAL_MS, looping, only while motion is welcome
 * (never under reduced motion, where the Pause button isn't shown either), the tab is visible,
 * and nothing holds it: the pointer over it, focus in it (other than on Pause/Play), or the
 * page's clip viewer open. Pause/Play stops and restarts it; a dot per slide moves to it and stops
 * it (the visitor has taken over). A swipe moves it too (native scroll snapping) and stops it.
 * Moving never takes focus anywhere. The WAI carousel pattern: a region with
 * `aria-roledescription="carousel"`, each slide a labelled group ("2 of 5"), the slides' live
 * region off while it plays (so it isn't announced every few seconds) and polite otherwise.
 * Slides out of view are inert: out of the tab order and hidden from assistive tech.
 *
 * The controls (Pause/Play, then the dots on a white pill) sit over the photo's bottom-right at every
 * width, white in both themes so they stand out on any photo, before the slides in the DOM (tab order:
 * Pause, the dots, the title, the ticket action). Below 640px the words leave room under them; from 640px
 * the ticket action's bottom lines up with theirs. A touch
 * on it, or a swipe or any scroll the carousel didn't make, stops it; new slides start again from the first.
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
  /** The carousel is scrolling the track itself (goTo): a scroll then isn't the visitor's. */
  const ownScrollRef = useRef(false);
  // New slides (the saved suburb changed the order, or a reload): start again from the first.
  const idsKey = slides.map((event) => event.id).join("|");
  const [shownIds, setShownIds] = useState(idsKey);
  if (shownIds !== idsKey) {
    setShownIds(idsKey);
    setIndex(0);
  }
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    const track = trackRef.current;
    if (track && typeof track.scrollTo === "function" && track.scrollLeft !== 0) track.scrollTo({ left: 0, behavior: "auto" });
  }, [idsKey]);

  const moving = motionOk && playing && count > 1;
  const advancing = moving && !hovered && !focused && !(clipViewer?.isOpen ?? false);

  function goTo(next: number) {
    const target = ((next % count) + count) % count;
    setIndex(target);
    indexRef.current = target;
    const track = trackRef.current;
    if (track && typeof track.scrollTo === "function") {
      ownScrollRef.current = true;
      track.scrollTo({ left: target * track.clientWidth, behavior: motionOk ? "smooth" : "auto" });
    }
  }

  useVisibleInterval(() => goTo(indexRef.current + 1), CAROUSEL_INTERVAL_MS, { enabled: advancing });

  // A swipe (or any scroll the carousel didn't make) is the visitor taking over: it stops, and the
  // slide it settles on is the current one.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      ownScrollRef.current = false;
      if (track.clientWidth <= 0) return;
      const nearest = Math.min(count - 1, Math.max(0, Math.round(track.scrollLeft / track.clientWidth)));
      if (nearest !== indexRef.current) {
        indexRef.current = nearest;
        setIndex(nearest);
      }
    };
    const onScroll = () => {
      if (!ownScrollRef.current) setPlaying(false);
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
  // A mouse over it holds it; a touch on it (a tap, the start of a swipe) stops it: the visitor has taken over.
  function handlePointer(event: PointerEvent<HTMLElement>, over: boolean) {
    if (event.pointerType === "mouse") setHovered(over);
  }
  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch" || event.pointerType === "pen") setPlaying(false);
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
      className={`relative flex flex-col ${className}`.trim()}
      onFocus={handleFocus}
      onPointerDown={handlePointerDown}
      onBlur={handleBlur}
      onPointerEnter={(event) => handlePointer(event, true)}
      onPointerLeave={(event) => handlePointer(event, false)}
    >
      <h2 id={id} tabIndex={-1} className="sr-only">
        {title}
      </h2>
      {/* Before the slides in the DOM (the WAI carousel pattern: the controls come first, Pause/Play
          first of them), drawn over the photo's bottom-right at every width. Focus rings are white over
          the dark gradient (--foreground re-pointed at paper); on the white pill they're black. */}
      {count > 1 && (
        <div
          data-carousel-controls=""
          className="absolute right-6 bottom-6 z-10 flex items-center gap-2 [--foreground:var(--paper)] md:right-8 md:bottom-8 lg:right-12 lg:bottom-12"
        >
          {motionOk && (
            <button
              type="button"
              data-carousel-rotation=""
              aria-label={playing ? "Pause carousel" : "Play carousel"}
              aria-controls={trackId}
              onClick={() => setPlaying((p) => !p)}
              className={ROTATION}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
          )}
          {/* The dots on a white pill, so they read on any photo. 24px targets. */}
          <ul className="flex h-10 items-center rounded-control bg-paper px-2 [--foreground:var(--ink)]" aria-label="Slides">
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
                      i === index ? "w-6 bg-signal" : "w-2 bg-ink/60 group-hover/dot:bg-ink group-focus-visible/dot:bg-ink"
                    }`}
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
              // The ink scope paints black under the photo (its loading backdrop too) and turns the words white.
              data-surface="ink"
              // 4:5 below 640px, 2:1 to 1023px, 5:2 from 1024px. The words are in the flow, so a slide whose
              // words need more room (a long title at 320px, or 200% text) grows rather than cutting them off.
              className="group/slide relative isolate flex aspect-[4/5] w-full shrink-0 snap-start flex-col justify-end sm:aspect-[2/1] lg:aspect-[5/2]"
            >
              <div className="absolute inset-0 -z-10 overflow-hidden rounded-card">
                <EventArt
                  poster={event.poster}
                  imageUrl={event.imageUrl}
                  imageFocus={event.imageFocus}
                  imgClassName={event.imageFocus ? undefined : FOCUS_DEFAULTS}
                  title={event.title}
                  fit="poster"
                  priority={i === 0}
                  className="size-full"
                />
              </div>
              {/* The shade, for the words' contrast (WCAG 1.4.3: 4.5:1 for the category and facts, 3:1 for the
                  title, measured against the brightest pixel behind each line on every demo slide, with one-
                  and two-line titles, from 320 to 1440px). The words can start a quarter of the way down a
                  4:5 slide at 320px and a third of the way down a 2:1 one, so 60% ink is reached by then:
                  below 640px 60% at 20% and 85% at the bottom; to 767px clear to 5%, 60% at 30%, 85%; from
                  768px clear to 10%, 60% at 35%, 80% at the bottom. */}
              <div
                aria-hidden="true"
                data-slide-shade=""
                className="absolute inset-0 -z-10 rounded-card bg-linear-to-b from-transparent via-ink/60 via-20% to-ink/85 sm:from-5% sm:via-30% md:from-10% md:via-35% md:to-ink/80"
              />
              {/* Not positioned, so the title's stretched link covers the whole slide. Below 640px the
                  bottom padding clears the controls (24 + 48 + 16), which would overlap the ticket action;
                  from 640px the slide is wide enough for the action to sit beside them, bottoms aligned. */}
              <div data-slide-content="" className="flex flex-col p-6 pb-22 sm:pb-6 md:max-w-md md:p-8 lg:max-w-xl lg:p-12 xl:max-w-2xl">
                <p className="mono-s text-foreground">{categoryLabel(event)}</p>
                <h3 className="title-banner mt-2 line-clamp-2 break-words">
                  <Link
                    href={href}
                    data-banner-link=""
                    className="underline decoration-transparent underline-offset-4 group-hover/slide:decoration-current focus-visible:decoration-current after:absolute after:inset-0 after:z-0 after:rounded-card after:content-[''] motion-safe:transition-colors motion-safe:duration-200"
                  >
                    {event.title}
                  </Link>
                </h3>
                <p data-slide-facts="" className="body-m mt-3 tabular-nums">
                  {slideFacts(event, now)}
                </p>
                {cta && (
                  // A sibling of the title's link, raised above its stretch. Named with the event (each slide
                  // has one), its visible words first (WCAG 2.5.3). M (48) below 1440px, L (56) from it.
                  <ButtonLink
                    href={cta.href}
                    variant={cta.tone === "signal" ? "signal" : "outline"}
                    size="md"
                    aria-label={`${cta.label}: ${event.title}`}
                    className="relative z-10 mt-4 self-start min-[90rem]:min-h-14 min-[90rem]:px-8"
                  >
                    {cta.label}
                    <ArrowRightIcon className="size-4 shrink-0" />
                  </ButtonLink>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
