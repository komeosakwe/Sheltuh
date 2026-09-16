"use client";

import { useEffect, useState } from "react";
import EventDetailsView from "@/components/EventDetailsView";
import NotFoundMessage from "@/components/NotFoundMessage";
import { ApiError } from "@/lib/api/client";
import { getPublicEventBySlug } from "@/lib/api/public-events";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { SheltuhEvent } from "@/lib/types";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "loaded"; event: SheltuhEvent };

export default function LiveEventDetails({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getPublicEventBySlug(slug)
      .then((event) => {
        if (!cancelled) setState({ status: "loaded", event: adaptPublicEvent(event) });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: err instanceof Error ? err.message : "Couldn't load this event." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.status === "loading") {
    return <p className="px-4 py-10 text-center text-sm text-muted sm:px-6">Loading event…</p>;
  }

  if (state.status === "not-found") {
    return <NotFoundMessage />;
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
          {state.message}
        </p>
      </div>
    );
  }

  return <EventDetailsView event={state.event} demo={false} />;
}
