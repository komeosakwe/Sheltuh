"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import GoingStack from "@/components/ui/GoingStack";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { initialsFor } from "@/lib/initials";
import { getSampleGoing } from "@/lib/sample-going";
import { isApiConfigured } from "@/lib/api/client";

/** Demo only: fictional initials. Live shows no stack (no blank tiles), since signed-out visitors never receive names. */
const DEMO_INITIALS = isApiConfigured
  ? undefined
  : getSampleGoing("home-community").attendees.slice(0, 5).map((a) => initialsFor(a.displayName));

/**
 * What Who's Going shows whom, in order (mobile-redesign.md §6.4.4), as the
 * code does it: anyone sees the count (from three people up); a signed-in
 * member with a verified email and a free profile sees the names, ticket or
 * not; adding yourself needs a ticket booked with that email; and messaging
 * needs you on the same list.
 */
export const COMMUNITY_INTRO =
  "Anyone can see how many are going, once there are three or more. Make a free profile and you’ll see who.";
export const COMMUNITY_STEPS = [
  "Sign up and make a free profile to see who’s going.",
  "Got a ticket? Add yourself to the list, only if you want to.",
  "Once you’re on the list, say hi to others going before the night.",
] as const;

/**
 * "Find your people" (docs/design/mobile-redesign.md §6.4.4): the page's one
 * orange band, full-bleed (so the caller places it outside the page
 * container). Its promise is the real access rule: the names are visible to
 * members before they book (a profile is free and needs no ticket); a
 * ticket lets you add yourself, and being on the list lets you message the
 * others on it. It never shows a community size.
 * `#find-your-people` links land here, focus included (tabIndex -1). The CTA
 * sends signed-in members to find an event and everyone else (including
 * while auth is still loading, which is also the server render) to sign up,
 * with "Browse events" beside it, since buying a ticket needs no account.
 * Black on orange throughout (6.18:1); never an orange button here.
 */
export default function CommunitySection({ className = "" }: { className?: string }) {
  const auth = useOptionalAuth();
  const signedIn = auth?.status === "signed-in";

  return (
    <section
      id="find-your-people"
      aria-labelledby="home-people"
      tabIndex={-1}
      data-surface="signal"
      className={`focus:outline-none ${className}`.trim()}
    >
      <div className="mx-auto max-w-6xl px-5 py-10 sm:grid sm:grid-cols-2 sm:gap-x-8 sm:px-8 sm:py-16">
        <div>
          <p className="eyebrow">Find your people</p>
          <h2 id="home-people" className="display-lg font-display mt-3">
            See who’s going before you book.
          </h2>
          <GoingStack size="lg" initials={DEMO_INITIALS} className="mt-6" />
        </div>
        <div className="mt-6 sm:mt-0">
          <p className="max-w-md text-base leading-6 sm:text-lg sm:leading-7">
            {COMMUNITY_INTRO}
          </p>
          <ol className="mt-5 grid gap-3 sm:grid-cols-3 sm:gap-6">
            {COMMUNITY_STEPS.map((step, i) => (
              <li key={step} className="border-t border-foreground pt-3">
                {/* The list's own order is what's read; the number is for the eye. */}
                <span aria-hidden="true" data-step-number="" className="meta">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="mt-1 text-sm leading-5">{step}</p>
              </li>
            ))}
          </ol>
          {signedIn ? (
            <ButtonLink href="/events" variant="solid" size="lg" className="mt-6 w-full sm:w-auto">
              Find an event
            </ButtonLink>
          ) : (
            // Signing up isn't needed to book: the way to events stays one tap away.
            <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
              <ButtonLink href="/signup" variant="solid" size="lg" className="w-full sm:w-auto">
                Join the community
              </ButtonLink>
              <Link
                href="/events"
                className="inline-flex min-h-11 items-center text-base leading-6 font-semibold underline underline-offset-4 hover:decoration-2"
              >
                Browse events
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
