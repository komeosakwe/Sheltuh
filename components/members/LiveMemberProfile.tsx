"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingIndicator } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice } from "@/components/ui/Section";
import SuspendedNotice from "@/components/whos-going/SuspendedNotice";
import { ApiError } from "@/lib/api/client";
import { getMemberProfile } from "@/lib/api/profiles";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { MemberProfile } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { isSessionExpired } from "@/components/messages/shared";
import { useProfile } from "@/lib/auth/useProfile";
import { withNext } from "@/lib/safe-next-path";
import MemberPageShell from "./MemberPageShell";
import MemberProfileView from "./MemberProfileView";

type Load =
  | { status: "loading" }
  | { status: "loaded"; profile: MemberProfile }
  | { status: "unavailable" }
  | { status: "unverified"; message: string }
  | { status: "rate-limited" }
  | { status: "session" }
  | { status: "error" };

/** What happened after the page loaded: the member was blocked here, or can't be seen any more. */
type After = { kind: "blocked"; name: string } | { kind: "gone" } | null;

const linkClass = "underline underline-offset-4 hover:decoration-2";

/**
 * /members/{profileId} (live): only for signed-in members with a Who's Going
 * profile (the API's gate also needs a verified email and no suspension, and
 * says 404 for anything the caller can't see, unknown ids included). Each
 * gate state explains what to do: sign in, create a profile, verify the
 * email. Whatever the API can't show is "This profile isn't available", never
 * why. Retries and changes move focus to the new heading.
 */
export default function LiveMemberProfile({ profileId }: { profileId: string }) {
  const auth = useAuth();
  const { state: own, reload: reloadOwn } = useProfile();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; load: Load } | null>(null);
  const [after, setAfter] = useState<After>(null);
  const focusHeading = useRef(false);
  // Focuses the heading a retry or change brings in, as it mounts. (An effect
  // could run late, for the view that was on screen when Try again was
  // pressed, and spend the request on that view's heading.)
  const headingRef = useCallback((heading: HTMLHeadingElement | null) => {
    if (!heading || !focusHeading.current) return;
    focusHeading.current = false;
    heading.focus();
  }, []);
  const returnTo = `/members/${encodeURIComponent(profileId)}`;

  const ownReady = own.status === "ready" ? own.profile : undefined;
  const canLoad = auth.status === "signed-in" && ownReady !== undefined && ownReady !== null && !ownReady.suspended;
  const key = `${profileId}#${attempt}`;
  const getToken = auth.getAccessToken;

  useEffect(() => {
    if (!canLoad) return;
    let cancelled = false;
    getMemberProfile(profileId, getToken).then(
      (profile) => {
        if (!cancelled) setResult({ key, load: { status: "loaded", profile } });
      },
      (err: unknown) => {
        if (cancelled) return;
        let load: Load = { status: "error" };
        if (isSessionExpired(err)) load = { status: "session" };
        else if (err instanceof ApiError && err.status === 404) load = { status: "unavailable" };
        else if (err instanceof ApiError && err.status === 403) load = { status: "unverified", message: err.message };
        else if (err instanceof ApiError && err.status === 429) load = { status: "rate-limited" };
        setResult({ key, load });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [canLoad, profileId, getToken, key]);

  const load: Load = result?.key === key ? result.load : { status: "loading" };

  function retry() {
    focusHeading.current = true;
    setAttempt((n) => n + 1);
  }

  const shell = (children: React.ReactNode) => <MemberPageShell>{children}</MemberPageShell>;

  const loading = (
    <div className="flex flex-col items-center py-12">
      <p role="status" className="sr-only">
        Loading profile…
      </p>
      <LoadingIndicator label="Loading profile" />
    </div>
  );

  if (auth.status === "loading") return shell(loading);

  if (auth.status === "signed-out") {
    return shell(
      <EmptyState
        title="Sign in to see member profiles"
        headingLevel={1}
        action={
          <ButtonLink size="lg" href={withNext("/login", returnTo)}>
            Sign in
          </ButtonLink>
        }
      >
        Member profiles are only shown to signed-in members with a Who&rsquo;s Going profile.
      </EmptyState>,
    );
  }

  if (own.status === "loading") return shell(loading);

  if (own.status === "error") {
    return shell(
      <div className="flex flex-col items-start gap-4">
        <h1 className="display-md">Couldn&rsquo;t load this profile</h1>
        <Notice tone="danger" role="alert">
          We couldn&rsquo;t check your own profile. Try again in a moment.
        </Notice>
        <Button variant="outline" size="lg" onClick={reloadOwn}>
          Try again
        </Button>
      </div>,
    );
  }

  if (own.profile === null) {
    return shell(
      <EmptyState
        title="Create a profile to see member profiles"
        headingLevel={1}
        action={
          <ButtonLink size="lg" href="/account">
            Create your profile
          </ButtonLink>
        }
      >
        Member profiles are shown to members with a Who&rsquo;s Going profile: a display name you choose. It takes a
        moment.
      </EmptyState>,
    );
  }

  if (own.profile.suspended) {
    return shell(
      <EmptyState title="This profile isn’t available" headingLevel={1} mark={false}>
        <SuspendedNotice />
      </EmptyState>,
    );
  }

  if (after?.kind === "blocked") {
    return shell(
      <EmptyState title={`You blocked ${after.name}`} headingLevel={1} titleRef={headingRef}>
        You won&rsquo;t see each other&rsquo;s profiles or appear on each other&rsquo;s Who&rsquo;s Going lists, and
        they can&rsquo;t message you. We won&rsquo;t tell them.{" "}
        <Link href="/messages/blocked" className={`${linkClass} text-foreground`}>
          Blocked members
        </Link>
      </EmptyState>,
    );
  }

  if (after?.kind === "gone" || load.status === "unavailable") {
    return shell(
      <EmptyState
        title="This profile isn’t available"
        headingLevel={1}
        titleRef={headingRef}
        action={
          <ButtonLink href="/events" size="lg" variant="outline">
            Browse events
          </ButtonLink>
        }
      >
        The member may have made it private, or the link is out of date.
      </EmptyState>,
    );
  }

  switch (load.status) {
    case "loading":
      return shell(loading);
    case "unverified":
      return shell(
        <EmptyState title="Verify your email to see member profiles" headingLevel={1} titleRef={headingRef} mark={false}>
          {load.message} Check your inbox for the confirmation email from Sheltüh.
        </EmptyState>,
      );
    case "session":
      return shell(
        <EmptyState
          title="Your session has expired"
          headingLevel={1}
          titleRef={headingRef}
          mark={false}
          action={
            <ButtonLink size="lg" href={withNext("/login", returnTo)}>
              Sign in again
            </ButtonLink>
          }
        />,
      );
    case "rate-limited":
    case "error":
      return shell(
        <div className="flex flex-col items-start gap-4">
          <h1 ref={headingRef} tabIndex={-1} className="display-md outline-offset-2">
            Couldn&rsquo;t load this profile
          </h1>
          <Notice tone="danger" role="alert">
            {load.status === "rate-limited"
              ? "You’ve looked at a lot of profiles in a short time. Try again in a few minutes."
              : "Something went wrong on our side. Try again in a moment."}
          </Notice>
          <Button variant="outline" size="lg" onClick={retry}>
            Try again
          </Button>
        </div>,
      );
    case "loaded":
      return shell(
        <MemberProfileView
          profile={load.profile}
          events={load.profile.upcomingEvents.map(adaptPublicEvent)}
          headingRef={headingRef}
          live={{
            getToken,
            onGone: () => {
              focusHeading.current = true;
              setAfter({ kind: "gone" });
            },
            onBlocked: (name) => {
              focusHeading.current = true;
              setAfter({ kind: "blocked", name });
            },
          }}
        />,
      );
  }
}
