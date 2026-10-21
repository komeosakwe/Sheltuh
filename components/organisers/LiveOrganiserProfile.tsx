"use client";

import { useEffect, useRef, useState } from "react";
import OrganiserProfileView from "@/components/organisers/OrganiserProfileView";
import OrganiserUnavailable from "@/components/organisers/OrganiserUnavailable";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { getOrganiserProfile } from "@/lib/api/organisers";
import type { PublicOrganiserProfile } from "@/lib/api/types";
import { ORGANISER_PAGE_TITLE, ORGANISER_UNAVAILABLE_TITLE, organiserPageTitle } from "@/lib/organiser-profile";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "loaded"; profile: PublicOrganiserProfile };

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
  const focusHeadingWhenSettled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getOrganiserProfile(organiserId)
      .then((profile) => {
        if (!cancelled) setState({ status: "loaded", profile });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: loadErrorMessage(err) });
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
    if (state.status === "loading" || !focusHeadingWhenSettled.current) return;
    focusHeadingWhenSettled.current = false;
    headingRef.current?.focus();
  }, [state.status]);

  function retry() {
    focusHeadingWhenSettled.current = true;
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  if (state.status === "loading") {
    return (
      <p role="status" className="px-4 py-10 text-center text-sm text-muted sm:px-6">
        Loading organiser…
      </p>
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
