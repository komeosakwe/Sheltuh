"use client";

import Image from "next/image";
import DotsMark from "@/components/brand/DotsMark";
import { ButtonLink } from "@/components/ui/Button";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { cardGoing } from "@/lib/event-card";
import { popularEvents, type TrendingSignal } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";
import { COMMUNITY_SAMPLE_FACES } from "./home-content";
import { useOptionalHomeEvents } from "./HomeEventsProvider";
import { ArrowRightIcon } from "./icons";

/** Live mode's footnote: the count is the server's thresholded Who's Going count for a Popular right now event. */
export const COMMUNITY_LIVE_NOTE = "Popular right now · Real count";
/** Demo mode's footnote: a real sample event, with its sample (made-up) count. */
export const COMMUNITY_DEMO_NOTE = "Example event · Sample count";
/** The band's line under "See who's going." (the proposal's, with its second half cut: §7, no communities to follow). */
export const COMMUNITY_BAND_LINE = "Ticket holders choose to appear.";

interface Example {
  title: string;
  count: number;
  sample: boolean;
}

/**
 * One real example for the band, or none: the first event on the page that has a count to show
 * (the same rule as the cards: live, the server's thresholded trending count; demo, the sample's
 * count, labelled as one). Never an invented number.
 */
function pickExample(mode: "demo" | "live", candidates: { event: SheltuhEvent; signal?: TrendingSignal }[]): Example | null {
  for (const { event, signal } of candidates) {
    const going = cardGoing(event, mode, signal);
    if (going) return { title: event.title, count: going.count, sample: going.sample };
  }
  return null;
}

/**
 * The band's overlapping round portraits (an owner exception, 23 Oct 2026): the illustrative,
 * licensed stock photos in `COMMUNITY_SAMPLE_FACES` (people from behind; public/home/README.md),
 * the same in demo and live. Decorative and never anyone's attendance: hidden from assistive
 * tech, and kept apart from the example's count.
 */
function Faces() {
  return (
    <div aria-hidden="true" data-community-faces="" className="flex shrink-0">
      {COMMUNITY_SAMPLE_FACES.map((photo, i) => (
        <span
          key={photo}
          className={`relative size-10 shrink-0 overflow-hidden rounded-full border-2 border-paper bg-surface md:size-12 ${i > 0 ? "-ml-3" : ""}`.trim()}
        >
          <Image src={photo} alt="" width={48} height={48} loading="lazy" decoding="async" className="size-full object-cover" />
        </span>
      ))}
    </div>
  );
}

/**
 * "Find your people." (the proposal, redesign PR 3): the home's community section. An eyebrow,
 * the dotted Heading/H1-size h2, the proposal's lede and "Explore communities" (→ /community),
 * then the compact orange "See who's going." band: its one line (the proposal's first half: no
 * communities to follow yet), the illustrative faces, a real example when the page has one (a
 * live thresholded count or the demo's sample count, with a footnote saying which) and one black
 * action: "Create profile" (sign up), or, signed in, "Find an event". Never an orange button on
 * the orange band, and black on orange only (6.18:1); the band looks the same in Light and Dark
 * (the signal scope). The proposal's Fashion, Art and Music cards ("8 friends going", Follow)
 * have no data behind them, so they're left out. `#find-your-people` still lands here.
 */
export default function CommunitySection({ className = "" }: { className?: string }) {
  const auth = useOptionalAuth();
  const signedIn = auth?.status === "signed-in";
  const home = useOptionalHomeEvents();
  const sections = home?.state.status === "ready" ? home.state.sections : null;
  const example =
    home && sections
      ? pickExample(home.mode, [
          ...(sections.popular?.kind === "popular"
            ? sections.popular.items.map(({ event, signal }) => ({ event, signal }))
            : popularEvents(sections.popular).map((event) => ({ event }))),
          ...(sections.weekend.status === "cards"
            ? sections.weekend.items.map((event) => {
                const count = sections.weekend.going[event.id];
                return { event, signal: count === undefined ? undefined : ({ kind: "going", count } as const) };
              })
            : []),
        ])
      : null;

  return (
    <section
      id="find-your-people"
      aria-labelledby="home-people"
      tabIndex={-1}
      // Phones: the head, the band, then Explore communities full width (the owner's 390 mock). From
      // 640px Explore communities sits on the head's row, at its right.
      className={`grid grid-cols-1 gap-y-6 focus:outline-none sm:grid-cols-[1fr_auto] sm:items-end sm:gap-x-8 md:gap-y-8 lg:gap-y-12 ${className}`.trim()}
    >
      <div className="min-w-0">
        <p className="eyebrow text-muted">Community</p>
        <h2 id="home-people" className="mt-2 heading-h1 flex items-center gap-3">
          <DotsMark size="sm" className="text-signal" />
          Find your people.
        </h2>
        <p className="mt-2 body-l text-muted">The people and creative scenes behind the events.</p>
      </div>
      <ButtonLink href="/community" variant="solid" className="w-full max-sm:order-last sm:w-auto">
        Explore communities
        <ArrowRightIcon className="size-4 shrink-0" />
      </ButtonLink>

      <div
        data-surface="signal"
        data-community-band=""
        data-community-example={example ? "" : undefined}
        className="flex flex-col gap-6 rounded-card p-6 sm:col-span-2 md:p-8 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:px-12"
      >
        <div className="min-w-0">
          <h3 className="heading-h1">See who’s going.</h3>
          <p className="mt-2 body-s font-semibold">{COMMUNITY_BAND_LINE}</p>
          {example && (
            <div className="mt-4">
              <p data-community-count="" className="body-m">
                <span className="font-semibold tabular-nums">{example.count} people going</span> · {example.title}
              </p>
              <p data-community-note="" className="mt-1 mono-s">
                {example.sample ? COMMUNITY_DEMO_NOTE : COMMUNITY_LIVE_NOTE}
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <Faces />
          {/* Signed out (or while auth loads, the server render), sign up; signed in, find an event. */}
          <ButtonLink href={signedIn ? "/events" : "/signup"} variant="solid" className="w-full sm:w-auto">
            {signedIn ? "Find an event" : "Create profile"}
            <ArrowRightIcon className="size-4 shrink-0" />
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
