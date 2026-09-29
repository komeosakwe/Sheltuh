"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, isApiConfigured, type GetToken } from "@/lib/api/client";
import { getGoingSummary, getMyGoingStatus, listGoingAttendees } from "@/lib/api/going";
import type { GoingAttendee, MyGoingStatus, ProfileRecord } from "@/lib/api/types";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { fetchMyProfile } from "@/lib/auth/useProfile";
import { getSampleGoing } from "@/lib/sample-going";

/** Below this many people, no number is shown anywhere (honest at small numbers). */
export const COUNT_THRESHOLD = 3;

export type GoingViewer =
  | { kind: "signed-out" }
  | {
      kind: "signed-in";
      email?: string;
      me: MyGoingStatus;
      profile: ProfileRecord | null;
      /** The API won't show this member names (403: e.g. their email isn't verified). */
      namesDenied: boolean;
      /** The viewer's own entry from the list, if they're going. */
      self?: GoingAttendee;
    };

export interface GoingData {
  /** Ended, or switched off for this event: nothing is shown. */
  closed: boolean;
  /** Everyone opted in, the viewer included. */
  count: number;
  /** Other people going, loaded so far (the viewer's own entry is kept in `viewer.self`). null = no names for this viewer. */
  attendees: GoingAttendee[] | null;
  nextCursor?: string;
  viewer: GoingViewer;
}

export type GoingLoadState = { status: "loading" } | { status: "error" } | { status: "ready"; data: GoingData };

export interface WhosGoingEvent {
  id: string;
  slug: string;
  title: string;
}

interface WhosGoingContextValue {
  mode: "demo" | "live";
  event: WhosGoingEvent;
  state: GoingLoadState;
  /** Reloads everything (after a load error). */
  retry: () => void;
  /** Applies a local change after a successful mutation or "Show more" (live only). */
  update: (change: (data: GoingData) => GoingData) => void;
  getToken?: GetToken;
}

const LOADING: GoingLoadState = { status: "loading" };

const WhosGoingContext = createContext<WhosGoingContextValue | undefined>(undefined);

function isStatus(err: unknown, status: number) {
  return err instanceof ApiError && err.status === status;
}

/** Splits the viewer's own entry out of a page of attendees. */
export function splitSelf(items: GoingAttendee[]) {
  return { self: items.find((a) => a.isYou), others: items.filter((a) => !a.isYou) };
}

async function loadGoing(eventId: string, getToken: GetToken | undefined, email: string | undefined): Promise<GoingData> {
  if (!getToken) {
    const summary = await getGoingSummary(eventId);
    return { closed: summary.closed, count: summary.count, attendees: null, viewer: { kind: "signed-out" } };
  }

  const [summary, me, page, profile] = await Promise.allSettled([
    getGoingSummary(eventId),
    getMyGoingStatus(eventId, getToken),
    listGoingAttendees(eventId, getToken),
    fetchMyProfile(getToken),
  ]);
  if (summary.status === "rejected") throw summary.reason;
  if (summary.value.closed) {
    return { closed: true, count: 0, attendees: null, viewer: { kind: "signed-out" } };
  }
  if (profile.status === "rejected") throw profile.reason;

  // A 403 from the member-only endpoints means this member can't see names or
  // opt in yet (unverified email): show the count, not an error.
  let status: MyGoingStatus;
  if (me.status === "fulfilled") status = me.value;
  else if (isStatus(me.reason, 403)) status = { going: false, eligible: false, hasProfile: profile.value !== null };
  else throw me.reason;

  let namesDenied = false;
  let attendees: GoingAttendee[] | null = null;
  let self: GoingAttendee | undefined;
  let nextCursor: string | undefined;
  if (page.status === "fulfilled") {
    const split = splitSelf(page.value.items);
    attendees = split.others;
    self = split.self;
    nextCursor = page.value.nextCursor;
  } else if (isStatus(page.reason, 403)) {
    namesDenied = true;
  } else {
    throw page.reason;
  }

  return {
    closed: false,
    count: summary.value.count,
    attendees,
    nextCursor,
    viewer: { kind: "signed-in", email, me: status, profile: profile.value, namesDenied, self },
  };
}

/**
 * Loads Who's Going once per event page and shares it between the panel in
 * the aside and the phone summary link under the title (no second request).
 * Demo mode (no API, or a sample event with no organiser, the same gate as
 * TicketSelector) uses fixed sample names and never calls the API.
 */
export function WhosGoingProvider({
  event,
  children,
}: {
  event: { id: string; slug: string; title: string; organiserId?: string };
  children: ReactNode;
}) {
  const live = isApiConfigured && Boolean(event.organiserId);
  const auth = useOptionalAuth();
  const authStatus = auth?.configured ? auth.status : "signed-out";
  const email = auth?.email;
  const getToken = authStatus === "signed-in" ? auth?.getAccessToken : undefined;

  const [attempt, setAttempt] = useState(0);
  // Results are tagged with the request they answer, so a sign-in, sign-out
  // or retry reads as "loading" at once, without resetting state in an effect.
  const key = `${event.id}|${authStatus}|${email ?? ""}|${attempt}`;
  const [result, setResult] = useState<{ key: string; state: GoingLoadState } | null>(null);

  useEffect(() => {
    if (!live || authStatus === "loading") return;
    let cancelled = false;
    loadGoing(event.id, getToken, email).then(
      (data) => {
        if (!cancelled) setResult({ key, state: { status: "ready", data } });
      },
      () => {
        if (!cancelled) setResult({ key, state: { status: "error" } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [live, authStatus, key, event.id, getToken, email]);

  const demoState = useMemo<GoingLoadState>(() => {
    const sample = getSampleGoing(event.id);
    return {
      status: "ready",
      data: { closed: false, count: sample.count, attendees: sample.attendees, viewer: { kind: "signed-out" } },
    };
  }, [event.id]);

  const state: GoingLoadState = !live ? demoState : result?.key === key ? result.state : LOADING;

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const update = useCallback(
    (change: (data: GoingData) => GoingData) =>
      setResult((current) =>
        current && current.key === key && current.state.status === "ready"
          ? { key, state: { status: "ready", data: change(current.state.data) } }
          : current,
      ),
    [key],
  );

  const value = useMemo<WhosGoingContextValue>(
    () => ({
      mode: live ? "live" : "demo",
      event: { id: event.id, slug: event.slug, title: event.title },
      state,
      retry,
      update,
      getToken,
    }),
    [live, event.id, event.slug, event.title, state, retry, update, getToken],
  );

  return <WhosGoingContext.Provider value={value}>{children}</WhosGoingContext.Provider>;
}

export function useWhosGoing(): WhosGoingContextValue {
  const ctx = useContext(WhosGoingContext);
  if (!ctx) throw new Error("useWhosGoing must be used within a WhosGoingProvider.");
  return ctx;
}
