"use client";

import Image from "next/image";
import { ButtonLink } from "@/components/ui/Button";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { cardGoing } from "@/lib/event-card";
import { popularEvents, type TrendingSignal } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";
import { COMMUNITY_SAMPLE_FACES } from "./home-content";
import { useOptionalHomeEvents } from "./HomeEventsProvider";
import { HOME_CONTAINER } from "./HomeRail";
import { ArrowRightIcon } from "./icons";

/** The card's muted lines: black at 60% on white is #666 (5.74:1). Inside the band `--muted` is black. */
const CARD_MUTED = "text-foreground/60";

/** Every footnote ends with this: the faces are the owner's illustrative portraits, never anyone going. */
const PHOTOS_NOTE = "Illustrative photos";
/** Live mode's footnote: the count is the server's thresholded Who's Going count for a Popular right now event. */
export const COMMUNITY_LIVE_NOTE = `Popular right now · Real count · ${PHOTOS_NOTE}`;
/** Demo mode's footnote: a real sample event, with its sample (made-up) count. */
export const COMMUNITY_DEMO_NOTE = `Example event · Sample count · ${PHOTOS_NOTE}`;
/** With no real example to show: what the card says instead of an event and a number. */
export const COMMUNITY_TEASER = {
  title: "Know who’ll be there",
  body: "Ticket holders can opt in to Who’s Going, so you can see the crowd before you book.",
  note: PHOTOS_NOTE,
} as const;

interface Example {
  title: string;
  count: number;
  sample: boolean;
}

/**
 * One real example for the card, or none: the first event on the page that
 * has a count to show (the same rule as the cards: live, the server's
 * thresholded trending count; demo, the sample's count, labelled as one).
 * Never an invented number.
 */
function pickExample(mode: "demo" | "live", candidates: { event: SheltuhEvent; signal?: TrendingSignal }[]): Example | null {
  for (const { event, signal } of candidates) {
    const going = cardGoing(event, mode, signal);
    if (going) return { title: event.title, count: going.count, sample: going.sample };
  }
  return null;
}

/**
 * The card's overlapping round portraits, with a white ring between them (an
 * explicit owner exception, 23 Oct 2026: avatars are rounded squares
 * everywhere else): the owner's illustrative photos in `COMMUNITY_SAMPLE_FACES`
 * (home-content.ts), the same in demo and live. Decorative and never anyone's
 * attendance: hidden from assistive tech, and every footnote says so.
 * 56px on phones, 80px from 640px, 72px from 1024px (the narrow card column)
 * and 80px again from 1280px.
 */
function Faces() {
  return (
    <div aria-hidden="true" data-community-faces="" className="mt-4 flex sm:mt-6">
      {COMMUNITY_SAMPLE_FACES.map((photo, i) => (
        <span
          key={photo}
          className={`relative size-14 shrink-0 overflow-hidden rounded-full border-4 border-card bg-surface sm:size-20 lg:size-18 xl:size-20 ${i > 0 ? "-ml-4" : ""}`.trim()}
        >
          <Image
            src={photo}
            alt=""
            width={80}
            height={80}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        </span>
      ))}
    </div>
  );
}

/** A footnote whose " · " parts each stay on one line, so "Illustrative photos" never splits on a phone. */
function NoteParts({ note }: { note: string }) {
  return note.split(" · ").map((part, i) => (
    <span key={part}>
      {i > 0 && " · "}
      <span className="whitespace-nowrap">{part}</span>
    </span>
  ));
}

/**
 * "Find your people" (owner mockup, 23 Oct 2026; docs/design/mobile-redesign.md
 * §6.4.4): the page's one orange band, full-bleed (the caller places it
 * outside the page column). Left, the pitch: an eyebrow, a two-line
 * sentence-case headline, two lines of body and one large black action
 * (sign up; signed in, find an event). Right from 1024px (stacked under it
 * before), a white "A look inside" card, always: the owner's illustrative
 * portraits (five overlapping circles) and, when the page has a real example
 * (a live thresholded count or the demo's sample count), that event's title
 * and "N people going". With none, a short pitch instead of an event and a
 * number: never an invented count, and the faces are never paired with an
 * event as if they were its attendees (the footnote always says the photos
 * are illustrative; Australian Consumer Law).
 * `#find-your-people` links land here, focus included (tabIndex -1).
 * Black on orange (6.18:1); never an orange button here. The band looks the
 * same in Light and Dark: the signal scope pins --card and --surface to
 * their Light values, so the card stays white with black text.
 * Phones are compact (owner, 23 Oct 2026, layout polish): 40px band padding,
 * 32px between the pitch, the action and the card, 20px card padding;
 * from 640px the spacing is as before.
 */
export default function CommunitySection({ className = "" }: { className?: string }) {
  const auth = useOptionalAuth();
  const signedIn = auth?.status === "signed-in";
  const home = useOptionalHomeEvents();
  const sections = home?.state.status === "ready" ? home.state.sections : null;
  const example = home && sections
    ? pickExample(home.mode, [
        ...(sections.popular?.kind === "popular"
          ? sections.popular.items.map(({ event, signal }) => ({ event, signal }))
          : popularEvents(sections.popular).map((event) => ({ event }))),
        ...(sections.weekend.status === "cards" ? sections.weekend.items.map((event) => ({ event })) : []),
      ])
    : null;

  return (
    <section
      id="find-your-people"
      aria-labelledby="home-people"
      tabIndex={-1}
      data-surface="signal"
      className={`focus:outline-none ${className}`.trim()}
    >
      <div
        className={`${HOME_CONTAINER} py-10 sm:py-16 lg:grid lg:grid-cols-12 lg:items-center lg:gap-x-8 lg:py-20`}
      >
        <div className="lg:col-span-7">
          <p className="eyebrow tracking-widest">Better together</p>
          {/* The literal spaces keep the heading's name "See who’s going. Find your people." (and the body's) as sentences. */}
          <h2 id="home-people" className="mt-3 text-4xl leading-none font-bold tracking-tighter sm:mt-5 sm:text-5xl lg:text-6xl">
            <span className="block">See who’s going.</span> <span className="block">Find your people.</span>
          </h2>
          <p className="mt-4 text-lg leading-7 sm:mt-6 sm:text-xl sm:leading-8">
            <span className="block">Discover the crowd before you book.</span>{" "}
            <span className="block">
              {signedIn ? "Open an event to see who’s going." : "Create a free profile to see who’s going."}
            </span>
          </p>
          {/* The one action: signed out (or while auth loads, the server render), sign up; signed in, find an event. */}
          <ButtonLink
            href={signedIn ? "/events" : "/signup"}
            variant="solid"
            size="lg"
            className="mt-8 min-h-14 w-full gap-3 px-7 text-base leading-6 tracking-normal normal-case sm:w-auto"
          >
            {signedIn ? "Find an event" : "Create profile now"}
            <ArrowRightIcon className="size-5 shrink-0" />
          </ButtonLink>
        </div>
        <div
          data-community-card=""
          data-community-example={example ? "" : undefined}
          className="mt-8 rounded-2xl bg-card p-5 text-foreground sm:mt-10 sm:max-w-md sm:p-8 lg:col-span-5 lg:mt-0 lg:max-w-none"
        >
          <p className={`eyebrow tracking-widest ${CARD_MUTED}`}>A look inside</p>
          <p className="mt-3 text-2xl leading-8 font-bold tracking-tight break-words sm:text-3xl sm:leading-9">
            {example ? example.title : COMMUNITY_TEASER.title}
          </p>
          <Faces />
          {example ? (
            <p data-community-count="" className="mt-4 flex flex-wrap items-baseline gap-x-2 sm:mt-6">
              <span className="text-5xl leading-none font-bold tracking-tighter tabular-nums sm:text-6xl">{example.count}</span>{" "}
              <span className="text-lg leading-7 font-semibold">people going</span>
            </p>
          ) : (
            <p className="mt-4 text-lg leading-7 sm:mt-6">{COMMUNITY_TEASER.body}</p>
          )}
          <p data-community-note="" className={`mt-3 text-sm leading-5 ${CARD_MUTED}`}>
            <NoteParts note={example ? (example.sample ? COMMUNITY_DEMO_NOTE : COMMUNITY_LIVE_NOTE) : COMMUNITY_TEASER.note} />
          </p>
        </div>
      </div>
    </section>
  );
}
