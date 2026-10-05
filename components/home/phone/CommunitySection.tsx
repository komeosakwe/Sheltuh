"use client";

import { ButtonLink } from "@/components/ui/Button";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { initialsFor } from "@/lib/initials";
import { getSampleGoing } from "@/lib/sample-going";
import { isApiConfigured } from "@/lib/api/client";
import GoingStack from "./GoingStack";

/** Demo only: fictional initials. Live shows plain discs, since signed-out visitors never receive names. */
const DEMO_INITIALS = isApiConfigured
  ? undefined
  : getSampleGoing("home-community").attendees.slice(0, 5).map((a) => initialsFor(a.displayName));

/**
 * "Find your people": the hero's "Join the community" jumps here. The CTA
 * sends signed-in members to find an event and everyone else (including
 * while auth is still loading, which is also the server render) to sign up.
 */
export default function CommunitySection({ className = "" }: { className?: string }) {
  const auth = useOptionalAuth();
  const signedIn = auth?.status === "signed-in";

  return (
    <section
      id="find-your-people"
      aria-labelledby="home-people"
      tabIndex={-1}
      className={`focus:outline-none ${className}`}
    >
      <h2 id="home-people" className="text-[1.375rem] leading-7 normal-case">
        Find your people
      </h2>
      <GoingStack size="lg" initials={DEMO_INITIALS} className="mt-4" />
      <p className="mt-4 text-base leading-6">
        See who’s going before you book. Add yourself to an event’s guest list, and meet people who like what you
        like.
      </p>
      {signedIn ? (
        <ButtonLink href="/events" variant="outline" size="lg" className="mt-5 w-full">
          Find an event
        </ButtonLink>
      ) : (
        <ButtonLink href="/signup" variant="outline" size="lg" className="mt-5 w-full">
          Join the community
        </ButtonLink>
      )}
    </section>
  );
}
