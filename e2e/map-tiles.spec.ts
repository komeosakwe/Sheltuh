import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";

/**
 * /map's basemap with NEXT_PUBLIC_MAPBOX_TOKEN unset, as production runs
 * today (docs/mapbox-preview.md): Esri tiles only, no "Map style (preview)"
 * control, and ?tiles= ignored. Live mode, with /api/* answered here from
 * the demo sample events; Esri tiles are answered with a small image so the
 * map loads without the network. The preview itself (with a token) is
 * e2e/mapbox-preview.demo.spec.ts.
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

/** Answers the API and every tile request; returns the tile URLs the page asked for, by provider. */
async function mockNetwork(page: Page) {
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

for (const vp of [
  { name: "390×844", width: 390, height: 844 },
  { name: "1440×900", width: 1440, height: 900 },
]) {
  test.describe(`/map basemap without a Mapbox token at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("Esri tiles and credit only, no style control, and ?tiles= is ignored", async ({ page }) => {
      const requested = await mockNetwork(page);
      await page.goto("/map?tiles=mapbox-dark");

      await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Map couldn.t load/)).toHaveCount(0);
      expect(requested.esri.some((url) => url.includes("World_Light_Gray_Base"))).toBe(true);
      expect(requested.esri.some((url) => url.includes("World_Light_Gray_Reference"))).toBe(true);
      expect(requested.mapbox).toEqual([]);

      await expect(page.getByLabel("Map style (preview)")).toHaveCount(0);
      const credits = page.locator(".leaflet-control-attribution");
      await expect(credits).toContainText("Esri");
      await expect(credits).not.toContainText("Mapbox");

      // The page's own URL sync drops the unused parameter.
      await expect(page).not.toHaveURL(/tiles=/);
    });
  });
}
