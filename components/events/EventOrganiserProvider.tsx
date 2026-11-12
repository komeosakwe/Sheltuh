"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import { getOrganiserProfile } from "@/lib/api/organisers";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { getSampleOrganiser, sampleOrganiserId } from "@/lib/sample-organisers";
import type { SheltuhEvent } from "@/lib/types";

/**
 * What the event page knows about its organiser beyond the event's own fields, from their public
 * profile: their upcoming events (this one included, soonest first), their follower count (only
 * once it's 10 or more: the API sends null below that) and whether they're a checked organiser.
 */
export type EventOrganiserLoad =
  | { status: "loading" }
  /** No public profile to read (a live organiser the API doesn't show: 404), or no sample organiser in the demo. */
  | { status: "none" }
  | { status: "error" }
  | {
      status: "ready";
      upcoming: SheltuhEvent[];
      followerCount: number | null;
      /**
       * "✓ Checked": every organiser with a public profile was approved by a person (docs/architecture.md,
       * "Organiser profiles"). Live only: the demo's organisers are made up, so nobody checked them.
       */
      checked: boolean;
    };

interface EventOrganiserValue {
  load: EventOrganiserLoad;
  retry: () => void;
  /** Try again was pressed after an error: `load` stays the error (so its button keeps focus) until the new read settles. */
  retrying: boolean;
}

const LOADING: EventOrganiserLoad = { status: "loading" };

const EventOrganiserContext = createContext<EventOrganiserValue | null>(null);

/**
 * One read of the event's organiser profile, shared by the "by {organiser}" line (its upcoming count),
 * the Organiser card (followers, "✓ Checked") and "More from {organiser}". It starts after the first
 * paint, so the page never waits for it: live, the public profile (lib/api/organisers.ts, CDN-cacheable);
 * in the demo, the sample organiser (lib/sample-organisers.ts). Never used in the editor's preview.
 */
export function EventOrganiserProvider({
  event,
  demo,
  children,
}: {
  event: Pick<SheltuhEvent, "organiserId" | "organiserName">;
  demo: boolean;
  children: ReactNode;
}) {
  const organiserId = event.organiserId;
  const organiserName = event.organiserName;
  const [attempt, setAttempt] = useState(0);
  const key = `${organiserId ?? ""}|${organiserName}|${demo}|${attempt}`;
  const [result, setResult] = useState<{ key: string; load: EventOrganiserLoad } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settle = (load: EventOrganiserLoad) => {
      if (!cancelled) setResult({ key, load });
    };
    if (!organiserId) {
      // The demo's sample organiser, worked out from the name (a live event always has an organiserId). After
      // the first paint, like the live read, so the server's render and the browser's agree.
      void Promise.resolve().then(() => {
        const sample = demo ? getSampleOrganiser(sampleOrganiserId(organiserName)) : null;
        settle(sample ? { status: "ready", upcoming: sample.upcoming, followerCount: null, checked: false } : { status: "none" });
      });
    } else {
      getOrganiserProfile(organiserId).then(
        (profile) =>
          settle({
            status: "ready",
            upcoming: profile.upcomingEvents.map(adaptPublicEvent),
            followerCount: typeof profile.followerCount === "number" ? profile.followerCount : null,
            checked: true,
          }),
        (err: unknown) => settle(err instanceof ApiError && err.status === 404 ? { status: "none" } : { status: "error" }),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [key, organiserId, organiserName, demo]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const retrying = result !== null && result.key !== key && result.load.status === "error";
  const load: EventOrganiserLoad = result?.key === key || retrying ? (result?.load ?? LOADING) : LOADING;
  const value = useMemo(() => ({ load, retry, retrying }), [load, retry, retrying]);
  return <EventOrganiserContext.Provider value={value}>{children}</EventOrganiserContext.Provider>;
}

/** The organiser's profile load; `none` outside a provider (the editor's preview has none). */
export function useEventOrganiser(): EventOrganiserValue {
  return useContext(EventOrganiserContext) ?? OUTSIDE;
}

const OUTSIDE: EventOrganiserValue = { load: { status: "none" }, retry: () => {}, retrying: false };
