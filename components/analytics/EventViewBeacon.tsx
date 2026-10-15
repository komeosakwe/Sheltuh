"use client";

import { useEffect } from "react";
import { recordEventView } from "@/lib/api/analytics";
import { isApiConfigured } from "@/lib/api/client";
import { parseTrackingRef, setTrackingRef } from "@/lib/tracking-ref";
import { viewSourceFrom } from "@/lib/view-source";

/** sessionStorage: ids of events whose view was already sent this session. */
export const VIEWED_KEY = "sheltuh:viewed:v1";

/** `document.prerendering` (Speculation Rules): not in this TypeScript DOM lib yet. */
type MaybePrerenderingDocument = Document & { prerendering?: boolean };

/** Fallback when sessionStorage is unavailable: once per page load instead. */
const sentThisPage = new Set<string>();

/** Marks `eventId` as viewed; false if it already was this session. */
function claimView(eventId: string): boolean {
  try {
    const store = window.sessionStorage;
    const parsed: unknown = JSON.parse(store.getItem(VIEWED_KEY) ?? "[]");
    const seen = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    if (seen.includes(eventId)) return false;
    // Bounded, so a long session can't grow it without limit.
    store.setItem(VIEWED_KEY, JSON.stringify([...seen, eventId].slice(-200)));
    return true;
  } catch {
    if (sentThisPage.has(eventId)) return false;
    sentThisPage.add(eventId);
    return true;
  }
}

function send(eventId: string) {
  const params = new URLSearchParams(window.location.search);
  const code = parseTrackingRef(params.get("ref"));
  // Kept even when the view itself was already counted, so checkout can pass it on.
  if (code) setTrackingRef(eventId, code);
  if (!claimView(eventId)) return;
  const source = viewSourceFrom({
    referrer: document.referrer,
    search: window.location.search,
    ownHost: window.location.hostname,
  });
  recordEventView(eventId, code ? { source, code } : { source });
}

/**
 * Counts one view of a live event page per event per browser session
 * (docs/architecture.md, "Organiser analytics"). Renders nothing, never
 * blocks rendering and ignores every error. No cookies or identifiers are
 * sent: only a source bucket and, from a tracking link, its code. Demo mode
 * sends nothing. Link prefetches don't run effects, and a page prerendered by
 * the browser waits until it's actually shown.
 */
export default function EventViewBeacon({ eventId }: { eventId: string }) {
  useEffect(() => {
    if (!isApiConfigured) return;
    try {
      if ((document as MaybePrerenderingDocument).prerendering) {
        const onShown = () => send(eventId);
        document.addEventListener("prerenderingchange", onShown, { once: true });
        return () => document.removeEventListener("prerenderingchange", onShown);
      }
      send(eventId);
    } catch {
      // Counting a view must never break the page.
    }
  }, [eventId]);

  return null;
}
