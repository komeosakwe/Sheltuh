import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockMapNetwork } from "./map-network";

/**
 * /map centred on the visitor (owner request, creator call). Live mode, /api/* and tiles answered
 * here (e2e/map-network.ts). The map publishes its centre and zoom as data attributes on its
 * container (components/SceneMapPanel.tsx), which these specs read. The browser's position is
 * Playwright's (grantPermissions / setGeolocation).
 */

/** Zoomed in to a suburb and its neighbours (lib/map-layout.ts MAP_NEAR_ZOOM). */
const NEAR_ZOOM = 13;
const MELBOURNE = { latitude: -37.8136, longitude: 144.9631 };
const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };

const mapContainer = (page: Page) => page.locator(".leaflet-container");

async function readView(map: Locator) {
  return {
    lat: Number(await map.getAttribute("data-center-lat")),
    lng: Number(await map.getAttribute("data-center-lng")),
    zoom: Number(await map.getAttribute("data-zoom")),
  };
}

/** Waits for the map to be at `place`, zoomed in. */
async function expectCentredOn(page: Page, place: { latitude: number; longitude: number }) {
  await expect
    .poll(
      async () => {
        const view = await readView(mapContainer(page));
        return view.zoom === NEAR_ZOOM && Math.abs(view.lat - place.latitude) < 0.03 && Math.abs(view.lng - place.longitude) < 0.03;
      },
      { timeout: 20_000, message: `map centred on ${place.latitude}, ${place.longitude} at zoom ${NEAR_ZOOM}` },
    )
    .toBe(true);
}

/** Opens /map with the tiles in; resolves once a marker is drawn. */
async function openMap(page: Page, path = "/map") {
  await mockMapNetwork(page);
  await page.goto(path);
  await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Locate .+ on the map$/ }).first()).toBeVisible({ timeout: 20_000 });
}

/** Counts, in this browser session, how often the page asks for the position (read with `asks`). */
async function countAsks(page: Page) {
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (...args) => {
      sessionStorage.setItem("test:asks", String(Number(sessionStorage.getItem("test:asks") ?? "0") + 1));
      original(...args);
    };
  });
}

const asks = (page: Page) => page.evaluate(() => Number(sessionStorage.getItem("test:asks") ?? "0"));

test.describe("/map centres on the visitor at 1280×800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.describe("with location allowed", () => {
    test.use({ permissions: ["geolocation"], geolocation: MELBOURNE });

    test("asks on open, centres there zoomed in, and keeps only the suburb", async ({ page }) => {
      const sent: string[] = [];
      page.on("request", (request) => sent.push(`${request.url()} ${request.postData() ?? ""}`));
      await openMap(page);

      await expectCentredOn(page, MELBOURNE);
      expect(JSON.parse((await page.evaluate(() => localStorage.getItem("sheltuh:near:v1"))) ?? "null")).toEqual({
        suburb: "Melbourne",
        state: "VIC",
      });
      // Not the visitor's pan: no "Search this area".
      await expect(page.getByRole("button", { name: "Search this area" })).toHaveCount(0);
      // The position is in no address, no storage, no request.
      expect(page.url()).not.toMatch(/37\.8|144\.9/);
      const stored = await page.evaluate(() =>
        [localStorage, sessionStorage].map((store) => JSON.stringify(Object.entries(store))).join(""),
      );
      expect(stored).not.toMatch(/-?\d{2,3}\.\d{3,}/);
      expect(sent.filter((entry) => /-37\.8|144\.96/.test(entry))).toEqual([]);

      // The next visit has a suburb saved: it opens there without asking again.
      await page.context().clearPermissions();
      await page.goto("/map");
      await expectCentredOn(page, MELBOURNE);
    });

    test("picking a suburb in the location filter centres on it", async ({ page }) => {
      await openMap(page);
      await expectCentredOn(page, MELBOURNE);
      const location = page.getByRole("combobox", { name: "Location" });
      await location.selectOption({ label: "Footscray, VIC" });
      await expectCentredOn(page, { latitude: -37.8, longitude: 144.9 });
      await expect(page.getByRole("button", { name: "Search this area" })).toHaveCount(0);
    });
  });

  test.describe("with location refused", () => {
    test.use({ permissions: [] });

    test("keeps the default view, doesn't ask again this session, and Near me says it couldn't", async ({ page }) => {
      await countAsks(page);
      await openMap(page);
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("sheltuh:map-locate-refused:v1"))).toBe("1");
      const view = await readView(mapContainer(page));
      expect(view.zoom).toBeLessThan(NEAR_ZOOM);
      expect(await page.evaluate(() => localStorage.getItem("sheltuh:near:v1"))).toBeNull();
      await expect(page.getByText("Couldn’t find your location.")).toHaveCount(0);

      expect(await asks(page)).toBe(1);
      await page.goto("/map");
      await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
      expect(await asks(page)).toBe(1);

      await page.getByRole("button", { name: "Near me" }).click();
      await expect(page.getByText("Couldn’t find your location.")).toBeVisible();
      expect((await readView(mapContainer(page))).zoom).toBeLessThan(NEAR_ZOOM);
    });

    test("Near me works once location is allowed, centring on the visitor", async ({ page, context }) => {
      await openMap(page);
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("sheltuh:map-locate-refused:v1"))).toBe("1");
      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation(SYDNEY);

      const button = page.getByRole("button", { name: "Near me" });
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await button.click();
      await expectCentredOn(page, SYDNEY);
      expect(JSON.parse((await page.evaluate(() => localStorage.getItem("sheltuh:near:v1"))) ?? "null")).toMatchObject({
        state: "NSW",
      });
    });
  });

  test("a selected event in the address wins: no ask", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(SYDNEY);
    await countAsks(page);
    await openMap(page, "/map?sel=evt-neon-static");
    expect(await asks(page)).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("sheltuh:near:v1"))).toBeNull();
  });
});
