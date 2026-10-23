"use client";

import Image from "next/image";
import { ButtonLink } from "@/components/ui/Button";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { cardGoing } from "@/lib/event-card";
import { popularEvents, type TrendingSignal } from "@/lib/home-sections";
import { initialsFor } from "@/lib/initials";
import { getSampleGoing } from "@/lib/sample-going";
import type { SheltuhEvent } from "@/lib/types";
import { COMMUNITY_SAMPLE_FACES } from "./home-content";
import { useOptionalHomeEvents } from "./HomeEventsProvider";
import { HOME_CONTAINER } from "./HomeRail";
import { ArrowRightIcon, PersonIcon } from "./icons";

/** The card's four circles, in the brand fills in turn (black, orange, sunken paper, black), each with its readable text colour. */
const FACE_FILLS = [
  "bg-foreground text-card",
  "bg-signal text-signal-foreground",
  "bg-surface text-foreground",
  "bg-foreground text-card",
] as const;
/** The card's muted lines: black at 60% on white is #666 (5.74:1). Inside the band `--muted` is black. */
const CARD_MUTED = "text-foreground/60";

/** Live mode's footnote: the count is the server's thresholded Who's Going count for a Popular right now event. */
export const COMMUNITY_LIVE_NOTE = "Popular right now · Real count";
/** Demo mode's footnote: a real sample event, with fictional sample attendees. */
export const COMMUNITY_DEMO_NOTE = "Example event · Sample attendees";

interface Example {
  title: string;
  count: number;
  sample: boolean;
  /** The demo's fictional sample attendees' initials; empty in live. */
  initials: string[];
}

/**
 * One real example for the card, or none: the first event on the page that
 * has a count to show (the same rule as the cards: live, the server's
 * thresholded trending count; demo, the sample's count, labelled as one).
 * Never an invented number. Initials only for the demo's sample attendees:
 * live, the home names and shows no one.
 */
function pickExample(mode: "demo" | "live", candidates: { event: SheltuhEvent; signal?: TrendingSignal }[]): Example | null {
  for (const { event, signal } of candidates) {
    const going = cardGoing(event, mode, signal);
    if (!going) continue;
    const initials = going.sample
      ? getSampleGoing(event.id)
          .attendees.slice(0, FACE_FILLS.length)
          .map((attendee) => initialsFor(attendee.displayName))
      : [];
    return { title: event.title, count: going.count, sample: going.sample, initials };
  }
  return null;
}

/**
 * The card's overlapping circles, with a white ring between them (an
 * explicit owner exception, 23 Oct 2026: avatars are rounded squares
 * everywhere else). Decorative: the count under them is the information.
 * Demo: the photos listed in `COMMUNITY_SAMPLE_FACES` (home-content.ts) when
 * there are any, else the sample attendees' initials. Live: plain person
 * shapes, nothing that identifies anyone.
 */
function Faces({ example }: { example: Example }) {
  return (
    <div aria-hidden="true" data-community-faces="" className="mt-5 flex sm:mt-6">
      {FACE_FILLS.map((fill, i) => {
        const photo = example.sample ? COMMUNITY_SAMPLE_FACES[i] : undefined;
        const initials = example.initials[i];
        return (
          <span
            key={fill + i}
            className={`relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-card text-lg leading-6 font-semibold sm:size-20 sm:text-xl ${i > 0 ? "-ml-4" : ""} ${fill}`.trim()}
          >
            {photo ? (
              <Image src={photo} alt="" fill sizes="80px" className="object-cover" />
            ) : initials ? (
              initials
            ) : (
              <PersonIcon className="size-7 sm:size-8" />
            )}
          </span>
        );
      })}
    </div>
  );
}

/**
 * "Find your people" (owner mockup, 23 Oct 2026; docs/design/mobile-redesign.md
 * §6.4.4): the page's one orange band, full-bleed (the caller places it
 * outside the page column). Left, the pitch: an eyebrow, a two-line
 * sentence-case headline, two lines of body and one large black action
 * (sign up; signed in, find an event). Right from 1024px (stacked under it
 * before), a white "A look inside" card: a real event on this page, four
 * circles and its going count, with a footnote saying what the number is
 * (the demo's are samples). With no event to draw on there's no card and
 * the pitch stands alone: never an invented number.
 * `#find-your-people` links land here, focus included (tabIndex -1).
 * Black on orange (6.18:1); never an orange button here. The band looks the
 * same in Light and Dark: the signal scope pins --card and --surface to
 * their Light values, so the card stays white with black text.
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
        className={`${HOME_CONTAINER} py-12 sm:py-16 lg:py-20 ${example ? "lg:grid lg:grid-cols-12 lg:items-center lg:gap-x-8" : ""}`.trim()}
      >
        <div className={example ? "lg:col-span-7" : undefined}>
          <p className="eyebrow tracking-widest">Better together</p>
          {/* The literal spaces keep the heading's name "See who’s going. Find your people." (and the body's) as sentences. */}
          <h2 id="home-people" className="mt-4 text-4xl leading-none font-bold tracking-tighter sm:mt-5 sm:text-5xl lg:text-6xl">
            <span className="block">See who’s going.</span> <span className="block">Find your people.</span>
          </h2>
          <p className="mt-5 text-lg leading-7 sm:mt-6 sm:text-xl sm:leading-8">
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
        {example && (
          <div
            data-community-example=""
            className="mt-10 rounded-2xl bg-card p-6 text-foreground sm:max-w-md sm:p-8 lg:col-span-5 lg:mt-0 lg:max-w-none"
          >
            <p className={`eyebrow tracking-widest ${CARD_MUTED}`}>A look inside</p>
            <p className="mt-3 text-2xl leading-8 font-bold tracking-tight break-words sm:text-3xl sm:leading-9">
              {example.title}
            </p>
            <Faces example={example} />
            <p data-community-count="" className="mt-5 flex flex-wrap items-baseline gap-x-2 sm:mt-6">
              <span className="text-5xl leading-none font-bold tracking-tighter tabular-nums sm:text-6xl">{example.count}</span>{" "}
              <span className="text-lg leading-7 font-semibold">people going</span>
            </p>
            <p className={`mt-3 text-sm leading-5 ${CARD_MUTED}`}>{example.sample ? COMMUNITY_DEMO_NOTE : COMMUNITY_LIVE_NOTE}</p>
          </div>
        )}
      </div>
    </section>
  );
}
