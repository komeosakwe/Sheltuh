import type { Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";

/**
 * /map's network in live mode, answered here: /api/events from the demo sample events, and Esri
 * tiles with a small image, so the map loads without the network. Returns the tile URLs the page
 * asked for, by provider.
 */

const HOUR = 3600_000;
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR42mM4QSJgOHHixCNSwKiGUQ1DRwMAAaucrZWSFIMAAAAASUVORK5CYII=",
  "base64",
);

function fixtures(now: number): PublicEvent[] {
  return sampleEvents.map((event, i) => {
    const start = now + HOUR + i * 26 * HOUR;
    return {
      organiserId: "org-demo",
      eventId: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description,
      category: event.category,
      venueName: event.venueName,
      venueAddress: event.venueAddress,
      suburb: event.suburb,
      // The API always sends the place (absent on a demo sample: Victoria, on Melbourne time).
      state: event.state ?? "VIC",
      timeZone: event.timeZone ?? "Australia/Melbourne",
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 3 * HOUR).toISOString(),
      organiserName: event.organiserName,
      imageUrl: event.imageUrl,
      ticketTypes: event.ticketTypes,
      ticketingMode: event.ticketingMode ?? "sheltuh",
      externalTicketUrl: event.externalTicketUrl,
      externalFree: event.externalFree ?? false,
      externalProvider: event.externalProvider ?? null,
    };
  });
}

export async function mockMapNetwork(page: Page) {
  const events = fixtures(Date.now());
  const requested = { esri: [] as string[], mapbox: [] as string[] };
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/events") return route.fulfill({ json: { items: events, nextCursor: undefined } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  await page.route("https://server.arcgisonline.com/**", (route) => {
    requested.esri.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: TILE });
  });
  await page.route("https://api.mapbox.com/**", (route) => {
    requested.mapbox.push(route.request().url());
    return route.abort();
  });
  return requested;
}
