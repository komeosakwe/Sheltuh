/**
 * The tracking-link code (`?ref=`) someone arrived with, kept for this tab's
 * session so checkout can pass it on later and the sale counts under that
 * link (docs/architecture.md, "Tracking links").
 *
 * Stored in sessionStorage under `TRACKING_REF_KEY` as `{ [eventId]: code }`:
 * one code per event, so a code from one event's link is never sent with
 * another event's checkout. Nothing else is kept: no referrer, no visitor id,
 * and it's gone when the tab closes. Storage can be unavailable (private mode,
 * blocked storage); then nothing is remembered and nothing throws.
 */

export const TRACKING_REF_KEY = "sheltuh:ref:v1";

/** Mirrors lib/server/tracking-codes.ts: 6–10 characters, no 0/1/i/l/o. */
const CODE_PATTERN = /^[2-9a-hjkmnp-z]{6,10}$/;

/** A well-formed code (trimmed, lower-cased), or null. */
export function parseTrackingRef(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  return CODE_PATTERN.test(code) ? code : null;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readAll(store: Storage): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(store.getItem(TRACKING_REF_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [eventId, value] of Object.entries(parsed)) {
      const code = parseTrackingRef(value);
      if (code) out[eventId] = code;
    }
    return out;
  } catch {
    return {};
  }
}

/** Remembers `code` for `eventId` for this session. Ignores a malformed code. */
export function setTrackingRef(eventId: string, raw: unknown): void {
  const code = parseTrackingRef(raw);
  const store = storage();
  if (!code || !eventId || !store) return;
  try {
    store.setItem(TRACKING_REF_KEY, JSON.stringify({ ...readAll(store), [eventId]: code }));
  } catch {
    // Storage full or blocked: the sale just won't be attributed.
  }
}

/** The code remembered for `eventId` this session, if any. */
export function getTrackingRef(eventId: string): string | undefined {
  const store = storage();
  if (!store || !eventId) return undefined;
  return readAll(store)[eventId];
}
