"use client";

import { useEffect, useRef, useState } from "react";
import OrganiserProfileView from "@/components/organisers/OrganiserProfileView";
import OrganiserUnavailable from "@/components/organisers/OrganiserUnavailable";
import { Button } from "@/components/ui/Button";
import { LoadingIndicator } from "@/components/ui/ProgressLoader";
import { ApiError } from "@/lib/api/client";
import { getOrganiserProfile } from "@/lib/api/organisers";
import type { PublicOrganiserProfile } from "@/lib/api/types";
import { ORGANISER_PAGE_TITLE, ORGANISER_UNAVAILABLE_TITLE, organiserPageTitle } from "@/lib/organiser-profile";

/** A settled state remembers which load (`attempt`) it came from, so a retry focuses only on its own result. */
type State =
  | { status: "loading" }
  | { status: "not-found"; attempt: number }
  | { status: "error"; message: string; attempt: number }
  | { status: "loaded"; profile: PublicOrganiserProfile; attempt: number };

const SERVER_TROUBLE = "Something went wrong on our side. Try again in a moment.";
/** lib/api/client's fallback when an error response has no JSON message (a proxy's HTML 502, say). */
const NO_MESSAGE = /^Request failed \(\d+\)\.$/;

/**
 * What to say when the profile couldn't be loaded. The server's own wording
 * for a 4xx, and the client's for no connection (status 0); a 5xx, or a
 * response with no message of its own, gets plain friendly copy instead of
 * a status code.
 */
function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status < 500 && !NO_MESSAGE.test(err.message)) return err.message;
  return SERVER_TROUBLE;
}

function titleFor(state: State): string {
  if (state.status === "loaded") return organiserPageTitle(state.profile.displayName);
  if (state.status === "not-found") return ORGANISER_UNAVAILABLE_TITLE;
  return ORGANISER_PAGE_TITLE;
}

/**
 * Loads an organiser's public profile client-side (live mode), with loading,
 * 404 and error states. The document title follows the state (the organiser's
 * name once loaded). After "Try again", focus goes to whichever heading the
 * new state shows, instead of being lost with the button.
 */
export default function LiveOrganiserProfile({ organiserId }: { organiserId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  // Bumped by "Try again" to re-run the load.
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The retry whose result should get focus (null: none). Tied to the attempt number, so a
  // stale effect or a late result from an earlier load can't consume it.
  const focusAfterAttempt = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOrganiserProfile(organiserId)
      .then((profile) => {
        if (!cancelled) setState({ status: "loaded", profile, attempt });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "not-found", attempt });
        } else {
          setState({ status: "error", message: loadErrorMessage(err), attempt });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [organiserId, attempt]);

  const title = titleFor(state);
  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    if (state.status === "loading" || focusAfterAttempt.current === null) return;
    if (state.attempt !== focusAfterAttempt.current) return;
    focusAfterAttempt.current = null;
    headingRef.current?.focus();
  }, [state]);

  function retry() {
    focusAfterAttempt.current = attempt + 1;
    setState({ status: "loading" });
    setAttempt(attempt + 1);
  }

  if (state.status === "loading") {
    return (
      <div className="mx-auto flex max-w-6xl flex-col items-center px-5 py-20 sm:px-8">
        <p role="status" className="sr-only">
          Loading organiser…
        </p>
        <LoadingIndicator label="Loading organiser" />
      </div>
    );
  }

  if (state.status === "not-found") return <OrganiserUnavailable headingRef={headingRef} />;

  if (state.status === "error") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-6 px-5 py-20 sm:px-8">
        <h1 ref={headingRef} tabIndex={-1} className="display-lg outline-offset-2">
          Couldn&rsquo;t load this organiser
        </h1>
        <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
          {state.message}
        </p>
        <Button variant="outline" size="lg" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  return <OrganiserProfileView profile={state.profile} headingRef={headingRef} />;
}
