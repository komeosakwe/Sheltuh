import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtures, mockMapNetwork } from "./map-network";

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

    test("a suburb typed in Where (Enter) is remembered and Nearby measures from it", async ({ page }) => {
      await openMap(page);
      await expectCentredOn(page, MELBOURNE);
      await page.getByRole("button", { name: "Where: Melbourne" }).click();
      const field = page.getByRole("combobox", { name: "Suburb" });
      await field.fill("Footscray");
      await field.press("Enter");
      await expect(page.getByRole("button", { name: "Where: Footscray" })).toBeFocused();
      await expect(page.locator("[data-map-count]")).toHaveText(/within 25 km of Footscray$/);
      expect(JSON.parse((await page.evaluate(() => localStorage.getItem("sheltuh:near:v1"))) ?? "null")).toEqual({
        suburb: "Footscray",
        state: "VIC",
      });
      await expect(page.getByRole("button", { name: "Search this area" })).toHaveCount(0);
    });

    test("a place far from every event in Where: centred on it, and Nearby says nothing is near", async ({ page }) => {
      await openMap(page);
      await expectCentredOn(page, MELBOURNE);
      await page.getByRole("button", { name: "Where: Melbourne" }).click();
      const field = page.getByRole("combobox", { name: "Suburb" });
      await field.fill("Darwin");
      await field.press("Enter");
      // Darwin is the suburb table's Darwin City.
      await expect(page.getByRole("heading", { level: 2, name: "No events found near Darwin City." })).toBeVisible();
      await expect
        .poll(async () => {
          const view = await readView(mapContainer(page));
          return view.zoom === NEAR_ZOOM && Math.abs(view.lat + 12.46) < 0.05 && Math.abs(view.lng - 130.84) < 0.05;
        })
        .toBe(true);
      await expect(page.getByRole("button", { name: "Search this area" })).toHaveCount(0);
    });
  });

  test.describe("with location refused", () => {
    test.use({ permissions: [] });

    test("keeps the default view, doesn't ask again this session, and Near me asks to share it", async ({ page }) => {
      await countAsks(page);
      await openMap(page);
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("sheltuh:map-locate-refused:v1"))).toBe("1");
      const view = await readView(mapContainer(page));
      expect(view.zoom).toBeLessThan(NEAR_ZOOM);
      expect(await page.evaluate(() => localStorage.getItem("sheltuh:near:v1"))).toBeNull();
      await expect(page.locator("[data-location-card]")).toHaveCount(0);

      expect(await asks(page)).toBe(1);
      await page.goto("/map");
      await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
      expect(await asks(page)).toBe(1);

      await page.getByRole("button", { name: "Near me" }).click();
      const card = page.locator("[data-location-card]");
      await expect(card).toBeVisible();
      await expect(card.getByRole("status")).toHaveText(
        "Share your location?To see events near you, allow location access in your browser settings.",
      );
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

test.describe("/map puts the events nearest the visitor first", () => {
  test.use({ viewport: { width: 1280, height: 800 }, permissions: ["geolocation"], geolocation: MELBOURNE });

  /** The sample events, with the soonest moved to Sydney (it used to head a Melbourne visitor's list). */
  async function openWithSydneySoonest(page: Page) {
    await mockMapNetwork(page);
    await page.route("**/api/events?*", (route) =>
      route.fulfill({
        json: {
          items: fixtures(Date.now()).map((event, i) => ({
            ...event,
            ...(i === 0 ? { title: "Sydney Soonest", suburb: "Surry Hills", state: "NSW", timeZone: "Australia/Sydney" } : {}),
          })),
          nextCursor: undefined,
        },
      }),
    );
    await page.goto("/map");
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Locate .+ on the map$/ }).first()).toBeVisible({ timeout: 20_000 });
  }

  const rows = (page: Page) => page.locator("[data-scene-row]");

  test("the list runs nearest first with distances, the map frames the nearest few, and a later pan stays", async ({ page }) => {
    await openWithSydneySoonest(page);
    // Soonest first until located; the ask on open then orders it, within 25 km.
    await expect(rows(page).first()).toContainText(/\d+(\.\d)? km away|< 1 km away/, { timeout: 20_000 });
    await expect(rows(page).filter({ hasText: "Sydney Soonest" })).toHaveCount(0);
    await expect(page.locator("[data-further-away]")).toContainText(/\d+ more events outside 25 km — [^.]*Surry Hills/);
    const distances = await rows(page).evaluateAll((els) =>
      els.map((el) => {
        const match = /([\d,.]+|< 1) km away/.exec(el.textContent ?? "");
        return match ? Number(match[1].replace(/[^\d.]/g, "") || 0) : Number.POSITIVE_INFINITY;
      }),
    );
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    const order = await rows(page).evaluateAll((els) => els.map((el) => el.querySelector("a")?.textContent ?? ""));

    // The visitor and the nearest events are in view, and it stays local (not all of Australia).
    await expect
      .poll(async () => {
        const view = await readView(mapContainer(page));
        return view.zoom >= 10 && view.zoom <= NEAR_ZOOM && Math.abs(view.lat - MELBOURNE.latitude) < 0.1 && Math.abs(view.lng - MELBOURNE.longitude) < 0.1;
      })
      .toBe(true);
    await expect(page.locator(".scene-visitor")).toBeVisible();
    await expect(page.getByRole("button", { name: "Search this area" })).toHaveCount(0);

    // The visitor pans: the map stays where they put it, "Search this area" is offered, the order stays.
    const before = await readView(mapContainer(page));
    const box = (await mapContainer(page).boundingBox())!;
    // A grab on the map itself (a tile), not on a marker or the visitor's dot: the nearest events
    // are framed around the middle.
    const start = await page.evaluate(({ x, y, width, height }) => {
      for (const fy of [0.5, 0.7, 0.3, 0.85, 0.15]) {
        for (const fx of [0.5, 0.65, 0.35, 0.8, 0.2]) {
          const [px, py] = [x + width * fx, y + height * fy];
          const hit = document.elementFromPoint(px, py);
          if (hit?.closest(".leaflet-tile-pane") || hit?.classList.contains("leaflet-container")) return { px, py };
        }
      }
      return { px: x + width / 2, py: y + height / 2 };
    }, box);
    await page.mouse.move(start.px, start.py);
    await page.mouse.down();
    await page.mouse.move(start.px + 160, start.py + 60, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "Search this area" })).toBeVisible();
    await page.waitForTimeout(1500);
    const after = await readView(mapContainer(page));
    expect(after.lng).toBeLessThan(before.lng);
    expect(after.zoom).toBe(before.zoom);
    expect(await rows(page).evaluateAll((els) => els.map((el) => el.querySelector("a")?.textContent ?? ""))).toEqual(order);
  });

  test("no coordinate reaches storage, the address or a request", async ({ page }) => {
    const sent: string[] = [];
    page.on("request", (request) => sent.push(`${request.url()} ${request.postData() ?? ""}`));
    await openWithSydneySoonest(page);
    await expect(rows(page).first()).toContainText(/km away/, { timeout: 20_000 });
    expect(page.url()).not.toMatch(/37\.8|144\.9/);
    const stored = await page.evaluate(() => [localStorage, sessionStorage].map((store) => JSON.stringify(Object.entries(store))).join(""));
    expect(stored).not.toMatch(/-?\d{2,3}\.\d{3,}/);
    expect(sent.filter((entry) => /-37\.8|144\.96/.test(entry))).toEqual([]);
  });
});

test.describe("Near me opens the nearest event", () => {
  const rows = (page: Page) => page.locator("[data-scene-row]");
  const firstRowTitle = async (page: Page) => (await rows(page).first().locator("a").first().textContent())?.trim() ?? "";
  const selectedCard = (page: Page) => page.getByRole("region", { name: "Selected event" });

  test.describe("at 1280×800", () => {
    test.use({ viewport: { width: 1280, height: 800 }, permissions: ["geolocation"], geolocation: MELBOURNE });

    test("the ask on open opens nothing; pressing Near me shows the nearest event's card, still framed on the visitor", async ({ page }) => {
      await openMap(page);
      await expect(rows(page).first()).toContainText(/km away/, { timeout: 20_000 });
      // The silent ask on open orders the list but doesn't open an event.
      await expect(selectedCard(page)).toHaveCount(0);

      await page.getByRole("button", { name: "Near me" }).click();
      const nearest = await firstRowTitle(page);
      await expect(selectedCard(page)).toBeVisible();
      await expect(selectedCard(page)).toContainText(nearest);
      await expect(page.getByRole("button", { name: "Dismiss selected event" })).toBeVisible();
      // Announced for screen readers, without a coordinate.
      await expect(page.getByRole("status").filter({ hasText: "Showing events nearest you." })).toContainText(`Nearest: ${nearest},`);
      // The address names the event only.
      await expect.poll(() => new URL(page.url()).searchParams.get("sel")).not.toBeNull();
      expect(page.url()).not.toMatch(/-?\d{2,3}\.\d{3,}|37\.8|144\.9/);
      // Not flown in on the one event: the visitor is still in view at a local zoom.
      await page.waitForTimeout(1500);
      const view = await readView(mapContainer(page));
      expect(view.zoom).toBeGreaterThanOrEqual(10);
      expect(view.zoom).toBeLessThanOrEqual(NEAR_ZOOM);
      expect(Math.abs(view.lat - MELBOURNE.latitude)).toBeLessThan(0.1);
      await expect(page.locator(".scene-visitor")).toBeVisible();
      await expect(page.getByRole("button", { name: "Near me" })).toBeFocused();
    });
  });

  test.describe("on a 390px phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, permissions: [] });

    test("opens the same bottom sheet a pin tap does, and Dismiss returns to Near me", async ({ page, context }) => {
      await mockMapNetwork(page);
      await page.goto(`/map?cat=${fixtures(Date.now())[0].category}&view=map`);
      await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation(MELBOURNE);
      await expect(selectedCard(page)).toHaveCount(0);

      await page.getByRole("button", { name: "Near me" }).click();
      await expect(selectedCard(page)).toBeVisible({ timeout: 20_000 });
      const nearest = (await rows(page).first().locator("a").first().textContent())?.trim() ?? "";
      await expect(selectedCard(page)).toContainText(nearest);
      await expect(page.locator(".leaflet-container")).toBeVisible();
      await expect(page.locator(".scene-visitor")).toBeVisible();
      await expect(page.getByRole("button", { name: "Near me" })).toBeFocused();
      const view = await readView(mapContainer(page));
      expect(view.zoom).toBeLessThanOrEqual(NEAR_ZOOM);

      await page.getByRole("button", { name: "Dismiss selected event" }).click();
      await expect(selectedCard(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Near me" })).toBeFocused();
    });
  });
});

test.describe("/map when every event has a venue pin", () => {
  test.use({ viewport: { width: 1280, height: 800 }, permissions: [] });

  // With pins and no saved suburb, nothing needs the suburb table, so /map hasn't loaded it when a
  // place is picked: the pick has to load it, not fall back to the Melbourne-only list.
  test("picking a place outside Melbourne in Where centres on it before the suburb table was ever loaded", async ({ page }) => {
    await mockMapNetwork(page);
    await page.route("**/api/events?*", (route) =>
      route.fulfill({
        json: {
          items: fixtures(Date.now()).map((event, i) => ({
            ...event,
            // The first is in Surry Hills; the rest are spread around inner Melbourne.
            ...(i === 0 ? { suburb: "Surry Hills", state: "NSW", timeZone: "Australia/Sydney" } : {}),
            location: {
              source: "manual_pin",
              pin: i === 0 ? { lat: -33.8861, lng: 151.2111 } : { lat: -37.8 + i * 0.01, lng: 144.96 },
            },
          })),
          nextCursor: undefined,
        },
      }),
    );
    await page.goto("/map");
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Where: Your suburb" }).click();
    await page.locator("[data-location-panel]").getByRole("button", { name: /^Sydney/ }).click();
    // Framed with the one event near it (Surry Hills, 2 km from the city's centre).
    await expectCentredOn(page, { latitude: -33.8775, longitude: 151.21 });
    await expect(page.getByRole("link", { name: fixtures(Date.now())[0].title, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Search this area" })).toHaveCount(0);
  });
});

test.describe("/map on a 375px phone", () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, permissions: [] });

  test("Near me, then List, then Map: the map keeps the visitor's location", async ({ page, context }) => {
    // The list is hidden on a phone's Map tab, so there are no Locate buttons to wait for: the tiles will do.
    // A filter in the address means no ask on open, and a view that would fit the events.
    await mockMapNetwork(page);
    await page.goto(`/map?cat=${fixtures(Date.now())[0].category}&view=map`);
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(SYDNEY);
    await page.getByRole("button", { name: "Near me" }).click();
    await expectCentredOn(page, SYDNEY);
    const before = await readView(mapContainer(page));

    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(mapContainer(page)).toBeHidden();
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(mapContainer(page)).toBeVisible();
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
    // Past the reveal's deferred framing (a frame) and any animation it would start.
    await page.waitForTimeout(1500);

    expect(await readView(mapContainer(page))).toEqual(before);
    await expectCentredOn(page, SYDNEY);
    await expect(page.getByRole("button", { name: "Search this area" })).toHaveCount(0);
  });
});

/*
 * The location card on a phone (owner's mockup, 8 Nov 2026): over the map's lower-left corner, above
 * Near me, when the browser won't share the position. In Instagram's iOS browser "Open in Safari"
 * can't open Safari (it ignores x-safari-https:, owner tested), so it copies the page's https address
 * and says where the app's own "Open in external browser" is. (This server is http, so there's no
 * address to copy here; copying the https one is covered in tests/SceneMapLocate.test.tsx and
 * tests/MapLocationCard.test.tsx.)
 */
test.describe("/map's location card at 390×844", () => {
  const INSTAGRAM_IOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.26.108 (iPhone15,2; iOS 18_1; en_AU)";
  test.use({ viewport: { width: 390, height: 844 }, permissions: [], userAgent: INSTAGRAM_IOS, isMobile: true, hasTouch: true });

  /** The phone's map view (its list, and so the rows' Locate buttons, are hidden): tiles and a marker drawn. */
  async function openPhoneMap(page: Page) {
    await mockMapNetwork(page);
    await page.goto("/map?view=map");
    await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".leaflet-marker-pane [data-event-id], .leaflet-marker-pane [data-event-ids]").first()).toBeVisible({
      timeout: 20_000,
    });
  }

  test("sits over the map's lower-left corner above Near me, asks in Safari, and its ✕ closes it", async ({ page }) => {
    await openPhoneMap(page);
    const nearMe = page.getByRole("button", { name: "Near me" });
    await nearMe.click();
    const card = page.locator("[data-location-card]");
    await expect(card.getByRole("status")).toHaveText("Share your location?To see events near you, allow location access in Safari.");
    await expect(page.locator('a[href^="x-safari"]')).toHaveCount(0);

    const [cardBox, nearBox, mapBox] = await Promise.all([card.boundingBox(), nearMe.boundingBox(), mapContainer(page).boundingBox()]);
    if (!cardBox || !nearBox || !mapBox) throw new Error("not laid out");
    expect(cardBox.width).toBe(200);
    expect(cardBox.x).toBeCloseTo(nearBox.x, 0);
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(nearBox.y);
    expect(nearBox.y + nearBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 1);
    expect(nearBox.y).toBeGreaterThan(mapBox.y + mapBox.height / 2);
    expect(nearBox.x - mapBox.x).toBeLessThanOrEqual(12);

    await card.getByRole("button", { name: "Dismiss location message" }).click();
    await expect(card).toHaveCount(0);
    await expect(nearMe).toBeFocused();
  });

  test("on http there's no https address to copy: Open in Safari gives the steps only", async ({ page }) => {
    await openPhoneMap(page);
    await page.getByRole("button", { name: "Near me" }).click();
    const card = page.locator("[data-location-card]");
    await card.getByRole("button", { name: "Open in Safari" }).click();
    await expect(card.getByRole("status")).toHaveText("Share your location?Tap ••• at the top, then Open in external browser.");
  });
});
