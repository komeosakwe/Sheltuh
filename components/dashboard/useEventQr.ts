"use client";

import { useCallback, useEffect, useState } from "react";
import { ensureQrTrackingLink } from "@/lib/api/analytics";
import { ApiError, type GetToken } from "@/lib/api/client";
import { getMyEvent } from "@/lib/api/events";
import type { EventRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { publicEventUrl } from "@/lib/event-url";
import { linkQrMatrix } from "@/lib/link-qr";
import { siteOrigin } from "@/lib/share-metadata";

/**
 * One event's QR code, as the QR page and the printable sign need it
 * (docs/architecture.md, "Event QR codes"): the organiser's event, and for a
 * published one the URL its code opens and the code's modules.
 *
 * - `ready`, `tracked`: the URL is the event's "QR code" tracking link
 *   (ensureQrTrackingLink, made the first time), so its views count under it.
 * - `ready`, not `tracked`: the event already has the most tracking links it
 *   can, so the code opens the plain event page.
 * - `unpublished`: no code (the page it would open isn't public), and no
 *   tracking link is made.
 * - `not-found`: not one of the organiser's events (the API's 404).
 */
export type EventQrState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "unpublished"; event: EventRecord }
  | { status: "ready"; event: EventRecord; url: string; matrix: boolean[][]; tracked: boolean };

/** Why the code couldn't be loaded, in the organiser's words. */
export function eventQrErrorMessage(err: unknown): string {
  if (err instanceof SessionExpiredError || (err instanceof ApiError && err.status === 401)) {
    return "Your session has ended. Sign in again to get the QR code.";
  }
  return "Couldn’t get the QR code ready. Try again.";
}

const NO_CODE = "This event’s address can’t be made into a QR code. Contact Sheltüh.";

async function loadEventQr(eventId: string, getToken: GetToken): Promise<EventQrState> {
  const event = await getMyEvent(eventId, getToken);
  if (event.status !== "published") return { status: "unpublished", event };
  const link = await ensureQrTrackingLink(eventId, getToken);
  const url = link?.url ?? publicEventUrl(event.slug, siteOrigin() ?? window.location.origin);
  const matrix = linkQrMatrix(url);
  if (!matrix) return { status: "error", message: NO_CODE };
  return { status: "ready", event, url, matrix, tracked: link !== null };
}

/**
 * The load in flight for each token getter (an account) and event, so the
 * effect running twice (React's development double run, or the token getter
 * settling) shares one request instead of racing to make the link twice.
 * Each entry goes once it settles, so Try again always loads afresh.
 */
const inFlight = new WeakMap<GetToken, Map<string, Promise<EventQrState>>>();

function sharedLoad(eventId: string, getToken: GetToken): Promise<EventQrState> {
  let byEvent = inFlight.get(getToken);
  if (!byEvent) {
    byEvent = new Map();
    inFlight.set(getToken, byEvent);
  }
  const running = byEvent.get(eventId);
  if (running) return running;
  const load = loadEventQr(eventId, getToken).finally(() => byEvent.delete(eventId));
  byEvent.set(eventId, load);
  return load;
}

export function useEventQr(eventId: string, getToken: GetToken): { state: EventQrState; retry: () => void } {
  const [state, setState] = useState<EventQrState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    sharedLoad(eventId, getToken).then(
      (next) => {
        if (!cancelled) setState(next);
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setState({ status: "not-found" });
        else setState({ status: "error", message: eventQrErrorMessage(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, getToken, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}
