"use client";

import { useEffect, useState } from "react";
import OrganiserProfileView from "@/components/organisers/OrganiserProfileView";
import OrganiserUnavailable from "@/components/organisers/OrganiserUnavailable";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { getOrganiserProfile } from "@/lib/api/organisers";
import type { PublicOrganiserProfile } from "@/lib/api/types";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "loaded"; profile: PublicOrganiserProfile };

/** Loads an organiser's public profile client-side (live mode), with loading, 404 and error states. */
export default function LiveOrganiserProfile({ organiserId }: { organiserId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  // Bumped by "Try again" to re-run the load.
  const [attempt, setAttempt] = useState(0);

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
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Couldn't load this organiser.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [organiserId, attempt]);

  function retry() {
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

  if (state.status === "not-found") return <OrganiserUnavailable />;

  if (state.status === "error") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-6 px-5 py-20 sm:px-8">
        <h1 className="display-lg">Couldn&rsquo;t load this organiser</h1>
        <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
          {state.message}
        </p>
        <Button variant="outline" size="lg" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  return <OrganiserProfileView profile={state.profile} />;
}
