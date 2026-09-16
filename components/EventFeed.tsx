"use client";

import { useEffect, useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import EventBrowser from "@/components/EventBrowser";
import { isApiConfigured } from "@/lib/api/client";
import { listPublicEvents } from "@/lib/api/public-events";
import { getEventCategories, getEvents } from "@/lib/data";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { SheltuhEvent } from "@/lib/types";

type FeedState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; events: SheltuhEvent[] };

async function loadEvents(): Promise<SheltuhEvent[]> {
  if (isApiConfigured) {
    const page = await listPublicEvents();
    return page.items.map(adaptPublicEvent);
  }
  return getEvents();
}

export default function EventFeed() {
  const [state, setState] = useState<FeedState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const categories = getEventCategories();

  useEffect(() => {
    let cancelled = false;
    loadEvents()
      .then((events) => {
        if (!cancelled) setState({ status: "loaded", events });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Couldn't load events.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return (
    <div className="flex flex-col gap-6">
      {!isApiConfigured && (
        <DemoNotice>
          These are fictional sample listings for this local prototype — no real tickets are
          on sale.
        </DemoNotice>
      )}

      {state.status === "loading" && <p className="text-sm text-muted">Loading events…</p>}

      {state.status === "error" && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-4">
          <p role="alert" className="text-sm text-foreground">
            {state.message}
          </p>
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setReloadToken((t) => t + 1);
            }}
            className="mt-3 rounded border border-surface-border px-3 py-1.5 text-sm font-medium text-foreground hover:border-accent hover:text-accent"
          >
            Try again
          </button>
        </div>
      )}

      {state.status === "loaded" && state.events.length === 0 && (
        <p className="text-sm text-muted">No events have been published yet — check back soon.</p>
      )}

      {state.status === "loaded" && state.events.length > 0 && (
        <EventBrowser events={state.events} categories={categories} />
      )}
    </div>
  );
}
