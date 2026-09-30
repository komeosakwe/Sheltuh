import { isApiConfigured } from "@/lib/api/client";
import { listPublicEvents } from "@/lib/api/public-events";
import { getEvents } from "@/lib/data";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { SheltuhEvent } from "@/lib/types";

/** Enough to fill the desktop home's drifting carousel and every phone home rail. */
export const HOME_EVENT_LIMIT = 24;

async function load(): Promise<SheltuhEvent[]> {
  if (!isApiConfigured) {
    const all = await getEvents();
    return [...all].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, HOME_EVENT_LIMIT);
  }
  // Pages of 10: fetch enough to fill the wide carousel.
  const items: SheltuhEvent[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 3 && items.length < HOME_EVENT_LIMIT; i++) {
    const page = await listPublicEvents({ cursor });
    items.push(...page.items.map(adaptPublicEvent));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return items.slice(0, HOME_EVENT_LIMIT);
}

let inflight: Promise<SheltuhEvent[]> | null = null;

/**
 * The home page's events, soonest first. The desktop preview and the phone
 * sections both mount on every viewport, so concurrent callers share one
 * request set; once it settles the next call (a retry, a later visit) loads afresh.
 */
export function loadHomeEvents(): Promise<SheltuhEvent[]> {
  inflight ??= load().finally(() => {
    inflight = null;
  });
  return inflight;
}
