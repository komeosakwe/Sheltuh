"use client";

import { useCallback, useEffect, useState } from "react";
import { ensureQrTrackingLink } from "@/lib/api/analytics";
import { ApiError, type GetToken } from "@/lib/api/client";
import { getMyEvent } from "@/lib/api/events";
import type { EventRecord } from "@/lib/api/types";
import { accountKey } from "@/lib/auth/account";
import { AccountMismatchError, SessionExpiredError, useAuth } from "@/lib/auth/AuthContext";
import { useAccountToken } from "@/lib/auth/useAccountToken";
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
 * - `error`: `reauth` when the session has ended (sign in again, not Try
 *   again); `permanent` when trying again can't help (the address can't be
 *   made into a QR code).
 */
export type EventQrState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string; reauth?: boolean; permanent?: boolean }
  | { status: "unpublished"; event: EventRecord }
  | { status: "ready"; event: EventRecord; url: string; matrix: boolean[][]; tracked: boolean };

const SESSION_ENDED = "Your session has ended. Sign in again to get the QR code.";
const NOT_READY = "Couldn’t get the QR code ready. Try again.";
const NO_CODE = "This event’s address can’t be made into a QR code.";

async function loadEventQr(eventId: string, getToken: GetToken): Promise<EventQrState> {
  const event = await getMyEvent(eventId, getToken);
  if (event.status !== "published") return { status: "unpublished", event };
  const link = await ensureQrTrackingLink(eventId, getToken);
  const url = link?.url ?? publicEventUrl(event.slug, siteOrigin() ?? window.location.origin);
  const matrix = linkQrMatrix(url);
  if (!matrix) return { status: "error", message: NO_CODE, permanent: true };
  return { status: "ready", event, url, matrix, tracked: link !== null };
}

/**
 * The load in flight for each account and event, so the effect running twice
 * (React's development double run) shares one request instead of racing to
 * make the tracking link twice. Keyed by the account (accountKey) as well as
 * the event, never by the token getter, which is the same function for every
 * account: so one account never receives another's unfinished load after a
 * switch. Each entry goes once it settles, so Try again always loads afresh.
 */
const inFlight = new Map<string, Promise<EventQrState>>();

function sharedLoad(account: string, eventId: string, getToken: GetToken): Promise<EventQrState> {
  const key = `${account}\u0000${eventId}`;
  const running = inFlight.get(key);
  if (running) return running;
  const load = loadEventQr(eventId, getToken).finally(() => inFlight.delete(key));
  inFlight.set(key, load);
  return load;
}

/**
 * The QR code of the signed-in organiser's event. Its token getter is for
 * that account only (useAccountToken): if the session becomes someone else's
 * mid-load, the load is dropped (AccountMismatchError) and the page stays
 * loading until it re-renders for the new account, which loads its own.
 * Only an answer for the account now signed in is ever returned.
 */
export function useEventQr(eventId: string): { state: EventQrState; retry: () => void } {
  const auth = useAuth();
  const account = accountKey(auth);
  const getToken = useAccountToken(auth);
  const [loaded, setLoaded] = useState<{ account: string; state: EventQrState } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (account === null) return;
    let cancelled = false;
    sharedLoad(account, eventId, getToken).then(
      (next) => {
        if (!cancelled) setLoaded({ account, state: next });
      },
      (err: unknown) => {
        // Another account's session by now: its own load follows the re-render.
        if (cancelled || err instanceof AccountMismatchError) return;
        let next: EventQrState;
        if (err instanceof ApiError && err.status === 404) next = { status: "not-found" };
        else if (err instanceof SessionExpiredError || (err instanceof ApiError && err.status === 401)) {
          next = { status: "error", message: SESSION_ENDED, reauth: true };
        } else next = { status: "error", message: NOT_READY };
        setLoaded({ account, state: next });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [account, eventId, getToken, attempt]);

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((n) => n + 1);
  }, []);

  const state: EventQrState = loaded !== null && loaded.account === account ? loaded.state : { status: "loading" };
  return { state, retry };
}
