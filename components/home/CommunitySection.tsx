"use client";

import { ButtonLink } from "@/components/ui/Button";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { cardGoing } from "@/lib/event-card";
import { popularEvents, type TrendingSignal } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";
import { useOptionalHomeEvents } from "./HomeEventsProvider";

/**
 * The benefit, as the code does it (docs/design/mobile-redesign.md,
 * Refinement 22 Oct 2026): anyone sees the count from three people; names
 * and faces need a free profile with a verified email. How to add yourself
 * (after getting a ticket) is explained where you'd do it: the event page's
 * Who's Going panel ("How Who's Going works").
 */
export const COMMUNITY_BENEFIT =
  "Every event shows how many are going once three people have added themselves. Make a free profile to see who.";

interface Example {
  title: string;
  count: number;
  sample: boolean;
}

/**
 * One real example for the band, or none: the first event on the page that
 * has a count to show (the same rule as the cards: live, the server's
 * thresholded trending count; demo, the sample's count, labelled as one).
 * Never an invented number, and never faces (the home has no names).
 */
function pickExample(mode: "demo" | "live", candidates: { event: SheltuhEvent; signal?: TrendingSignal }[]): Example | null {
  for (const { event, signal } of candidates) {
    const going = cardGoing(event, mode, signal);
    if (going) return { title: event.title, count: going.count, sample: going.sample };
  }
  return null;
}

/**
 * "Find your people" (docs/design/mobile-redesign.md §6.4.4, compressed in
 * the Refinement of 22 Oct 2026): the page's one orange band, full-bleed (the
 * caller places it outside the page container). A calm heading, one benefit
 * line, a compact example (a real count from an event on this page, or the
 * demo's sample count, labelled; nothing when there's none) and one action:
 * sign up free (or, signed in, find an event). Buying a ticket needs no
 * account; the hero's search and the cards are the way to events. The step-by-step lives in the
 * event page's Who's Going panel, where you'd act on it.
 * `#find-your-people` links land here, focus included (tabIndex -1).
 * Black on orange throughout (6.18:1); never an orange button here.
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
      <div className="mx-auto max-w-6xl px-5 py-8 sm:grid sm:grid-cols-[1fr_auto] sm:items-end sm:gap-x-10 sm:px-8 sm:py-10">
        <div>
          <h2 id="home-people" className="display-md">
            See who’s going before you book
          </h2>
          <p className="mt-2 max-w-md text-base leading-6">{COMMUNITY_BENEFIT}</p>
          {example && (
            <p data-community-example="" className="mt-4 flex flex-wrap items-baseline gap-x-2 text-sm leading-5">
              <span className="font-heading text-2xl leading-none tabular-nums">{example.count}</span>{" "}
              <span>
                going to <span className="font-semibold">{example.title}</span>
                {example.sample && " (sample)"}
              </span>
            </p>
          )}
        </div>
        {/* The one action: signed out (or while auth loads, the server render), sign up; signed in, find an event. */}
        <ButtonLink
          href={signedIn ? "/events" : "/signup"}
          variant="solid"
          size="lg"
          className="mt-5 w-full sm:mt-0 sm:w-auto"
        >
          {signedIn ? "Find an event" : "Sign up free"}
        </ButtonLink>
      </div>
    </section>
  );
}
