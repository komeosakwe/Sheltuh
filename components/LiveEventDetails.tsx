"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import EventDetailsView from "@/components/EventDetailsView";
import NotFoundMessage from "@/components/NotFoundMessage";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { ApiError } from "@/lib/api/client";
import { getPublicEventBySlug } from "@/lib/api/public-events";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { SheltuhEvent } from "@/lib/types";

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "loaded"; event: SheltuhEvent };

/** The tab's title for each state; while loading, the route's own ("Sheltüh") stays. */
function documentTitle(state: State): string | null {
  if (state.status === "loaded") return `${state.event.title} — Sheltüh`;
  if (state.status === "not-found") return "Event not found — Sheltüh";
  if (state.status === "error") return "Couldn’t load event — Sheltüh";
  return null;
}

/**
 * Loads an event page client-side (live mode), with loading, not-found and
 * error states (docs/design/brand-direction-one.md §6.14). The document title
 * follows the state. "Try again" keeps the error on screen while it retries,
 * so focus stays on the button; if the retry gets the page (or a 404), focus
 * moves to its heading.
 */
export default function LiveEventDetails({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  // Bumped by "Try again" to re-run the load.
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  // Each failure renders a new alert, so a repeat failure is announced again.
  const [failures, setFailures] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusHeadingWhenSettled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getPublicEventBySlug(slug)
      .then((event) => {
        if (cancelled) return;
        setState({ status: "loaded", event: adaptPublicEvent(event) });
        setRetrying(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: err instanceof Error ? err.message : "Couldn’t load this event." });
          setFailures((n) => n + 1);
        }
        setRetrying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

  const title = documentTitle(state);
  useEffect(() => {
    if (!title) return;
    document.title = title;
    // Next streams the route's own metadata (title "Sheltüh") into <head> once
    // generateMetadata resolves, which can land after this: put ours back.
    const observer = new MutationObserver(() => {
      if (document.title !== title) document.title = title;
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);

  useEffect(() => {
    if (retrying || !focusHeadingWhenSettled.current) return;
    focusHeadingWhenSettled.current = false;
    // Failed again: focus is still on "Try again", where it should stay.
    if (state.status === "error") return;
    const heading = rootRef.current?.querySelector<HTMLHeadingElement>("h1");
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    heading.focus();
  }, [state, retrying]);

  function retry() {
    focusHeadingWhenSettled.current = true;
    setRetrying(true);
    setAttempt((n) => n + 1);
  }

  if (state.status === "loading") {
    return (
      <div className="mx-auto flex max-w-6xl justify-center px-5 py-20 sm:px-8">
        <DotsLoader announce label="Loading event" />
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      {state.status === "not-found" ? (
        <NotFoundMessage />
      ) : state.status === "error" ? (
        <div className="mx-auto flex max-w-2xl flex-col items-start gap-6 px-5 py-20 sm:px-8">
          <h1 className="display-md">Couldn&rsquo;t load this event</h1>
          <Notice key={failures} tone="danger" role="alert">
            {state.message}
          </Notice>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button variant="outline" size="lg" busy={retrying} onClick={retry}>
              {retrying ? "Trying again…" : "Try again"}
            </Button>
            <Link href="/" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
              Back to all events
            </Link>
          </div>
          <p role="status" className="sr-only">
            {retrying ? "Trying again…" : ""}
          </p>
        </div>
      ) : (
        <EventDetailsView event={state.event} demo={false} />
      )}
    </div>
  );
}
