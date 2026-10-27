import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";

/**
 * /map's basemap with NEXT_PUBLIC_MAPBOX_TOKEN unset (docs/maps.md): Esri
 * tiles only, and no map style control. Live mode, with /api/* answered here
 * from the demo sample events; Esri tiles are answered with a small image so
 * the map loads without the network. Mapbox Streets (with a token) is
 * e2e/mapbox-streets.demo.spec.ts.
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

    test("Esri tiles and credit only, and no map style control", async ({ page }) => {
      const requested = await mockNetwork(page);
      await page.goto("/map");

      await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Map couldn.t load/)).toHaveCount(0);
      expect(requested.esri.some((url) => url.includes("World_Light_Gray_Base"))).toBe(true);
      expect(requested.esri.some((url) => url.includes("World_Light_Gray_Reference"))).toBe(true);
      expect(requested.mapbox).toEqual([]);

      await expect(page.getByText(/map style/i)).toHaveCount(0);
      const credits = page.locator(".leaflet-control-attribution");
      await expect(credits).toContainText("Esri");
      await expect(credits).not.toContainText("Mapbox");
    });
  });
}

test.describe("/map is Australia-wide (owner plan S9) at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** The marker for `eventId` on the map: its own, or the cluster it's in. */
  const pin = (page: Page, eventId: string) =>
    page.locator(`.leaflet-container [data-event-id="${eventId}"], .leaflet-container [data-event-ids~="${eventId}"]`);

  test("pins Melbourne and Perth events alike, and opens on all of them", async ({ page }) => {
    await mockNetwork(page);
    await page.goto("/map");
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
    // Melbourne's (clustered at this zoom) and Perth's, both drawn in the first view.
    await expect(pin(page, "evt-neon-static")).toHaveCount(1, { timeout: 20_000 });
    await expect(pin(page, "evt-northbridge-late-sketch")).toHaveCount(1);
    await expect(pin(page, "evt-king-street-fuzz-night")).toHaveCount(1);
    for (const title of ["Neon Static", "Northbridge Late Sketch", "Valley Risograph Fair"]) {
      await expect(page.getByRole("button", { name: `Locate ${title} on the map` })).toBeEnabled();
    }
    await expect(page.getByText(/can.t be placed on the map yet/)).toHaveCount(0);
    // The location filter: All of Australia, then the suburbs by state.
    const location = page.getByRole("combobox", { name: "Location" });
    await expect(location.locator("option").first()).toHaveText("All of Australia");
    await expect(location.locator("optgroup")).toHaveCount(4);
    expect(await location.locator("optgroup").evaluateAll((groups) => groups.map((g) => (g as HTMLOptGroupElement).label))).toEqual([
      "New South Wales",
      "Queensland",
      "Victoria",
      "Western Australia",
    ]);
  });

  test("with a saved suburb, opens on the events near it (owner decision D5), the rest still listed", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Perth" })));
    await mockNetwork(page);
    await page.goto("/map");
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
    await expect(pin(page, "evt-northbridge-late-sketch")).toHaveCount(1, { timeout: 20_000 });
    // Melbourne is far outside Perth's view: not drawn.
    await expect(pin(page, "evt-neon-static")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Locate Neon Static on the map" })).toBeEnabled();
  });

  // Code review (26 Oct 2026), MEDIUM 2: from Australia (zoom 4) to a city is too big a jump to
  // animate, so that first framing's moveend fires at once. "Search this area" must already be
  // listening, or it takes the visitor's first zoom for the map's own move and stays hidden.
  // jsdom has no zoom animation, so only a browser shows this.
  test("with a saved suburb, the visitor's first zoom offers Search this area", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Fitzroy", state: "VIC" })));
    await mockNetwork(page);
    await page.goto("/map");
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
    // Framed near Fitzroy: Melbourne's events drawn, Perth's not.
    await expect(pin(page, "evt-neon-static")).toHaveCount(1, { timeout: 20_000 });
    await expect(pin(page, "evt-northbridge-late-sketch")).toHaveCount(0);
    const searchArea = page.getByRole("button", { name: "Search this area" });
    // The map's own framing never offers it.
    await expect(searchArea).toHaveCount(0);
    await page.locator(".leaflet-control-zoom-in").click();
    await expect(searchArea).toBeVisible({ timeout: 10_000 });
  });
});
