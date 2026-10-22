"use client";

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
 * "Find your people": the page's one orange band, full-bleed (so the caller
 * places it outside the page container). `#find-your-people` links land
 * here, focus included (tabIndex -1). The CTA sends signed-in members to find an event and everyone
 * else (including while auth is still loading, which is also the server
 * render) to sign up. Black on orange throughout (6.18:1); never an orange
 * button here.
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
      <div className="mx-auto max-w-6xl px-5 py-12 sm:grid sm:grid-cols-2 sm:items-end sm:gap-x-8 sm:px-8 sm:py-16">
        <div>
          <h2 id="home-people" className="display-lg font-display">
            Find your people
          </h2>
          <GoingStack size="lg" initials={DEMO_INITIALS} className="mt-6" />
        </div>
        <div className="mt-6 sm:mt-0">
          <p className="max-w-md text-base leading-6 sm:text-lg sm:leading-7">
            See who’s going before you book. Add yourself to an event’s guest list, and meet people who like what you
            like.
          </p>
          {signedIn ? (
            <ButtonLink href="/events" variant="solid" size="lg" className="mt-5 w-full sm:w-auto">
              Find an event
            </ButtonLink>
          ) : (
            <ButtonLink href="/signup" variant="solid" size="lg" className="mt-5 w-full sm:w-auto">
              Join the community
            </ButtonLink>
          )}
        </div>
      </div>
    </section>
  );
}
