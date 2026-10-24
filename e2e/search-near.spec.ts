import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { findLocality } from "@/lib/location";
import { NEAR_STORAGE_KEY } from "@/lib/near-storage";
import { sampleEvents } from "@/lib/sample-events";

/**
 * "Near you" search (owner round of 24 Oct 2026: "our search bar similar [to
 * Eventbrite] and a close location, ask them"), in a real browser, live mode
 * with every /api/* request answered here. The browser's position is asked
 * for only on "Use my current location", turned into a suburb and dropped:
 * only the suburb reaches the address and storage, and the API never sees
 * either.
 */

const HOUR = 3600_000;
const FITZROY = findLocality("Fitzroy");
if (!FITZROY) throw new Error("Fitzroy is not in the suburb table");
// A position a little off Fitzroy's centre: the page must never show or store it.
const HERE = { latitude: FITZROY.lat + 0.0012, longitude: FITZROY.lng - 0.0007 };

function fixtures(now: number): PublicEvent[] {
  return sampleEvents.map((event, i) => ({
    organiserId: "org-demo",
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    suburb: event.suburb,
    startsAt: new Date(now + (i + 1) * 26 * HOUR).toISOString(),
    endsAt: new Date(now + (i + 1) * 26 * HOUR + 3 * HOUR).toISOString(),
    organiserName: event.organiserName,
    imageUrl: event.imageUrl,
    ticketTypes: event.ticketTypes,
    ticketingMode: event.ticketingMode ?? "sheltuh",
    externalTicketUrl: event.externalTicketUrl,
    externalFree: event.externalFree ?? false,
    externalProvider: event.externalProvider ?? null,
  }));
}

/** Answers /api/*, and returns every API URL the page asked for. */
async function mockApi(page: Page): Promise<string[]> {
  const requested: string[] = [];
  const events = fixtures(Date.now());
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    requested.push(url.pathname + url.search);
    if (url.pathname === "/api/events") return route.fulfill({ json: { items: events, nextCursor: undefined } });
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    if (/\/going(\/|$)/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  await page.route("https://server.arcgisonline.com/**", (route) => route.abort());
  return requested;
}

/** Counts every call to the Geolocation API from the first script on. */
async function countGeolocation(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __geoCalls: number };
    w.__geoCalls = 0;
    const proto = Geolocation.prototype;
    const get = proto.getCurrentPosition;
    const watch = proto.watchPosition;
    proto.getCurrentPosition = function (...args: Parameters<Geolocation["getCurrentPosition"]>) {
      w.__geoCalls += 1;
      return get.apply(this, args);
    };
    proto.watchPosition = function (...args: Parameters<Geolocation["watchPosition"]>) {
      w.__geoCalls += 1;
      return watch.apply(this, args);
    };
  });
}

const geoCalls = (page: Page) => page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls);

/** Opens the hero's location panel, pressing until the page has hydrated. */
async function openPanel(page: Page) {
  const search = page.getByRole("search", { name: "Search events" });
  const location = search.getByRole("button", { name: /^Location: / });
  const panel = page.getByRole("dialog", { name: "Find events near you" });
  await expect(async () => {
    if (!(await panel.isVisible())) await location.click();
    await expect(panel).toBeVisible({ timeout: 1_000 });
    await expect(panel.getByRole("button", { name: "Use my current location" })).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  return { search, location, panel };
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    test.describe(`search bar at ${viewport.width}px in ${theme === "light" ? "Light" : "Dark"}`, () => {
      test.use({ viewport });

      test("an orange round submit with a black icon, a pill bar 52px tall, and the global focus ring inset", async ({ page }) => {
        if (theme === "dark") await page.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
        await mockApi(page);
        await page.goto("/");
        const search = page.getByRole("search", { name: "Search events" });
        const submit = search.getByRole("button", { name: "Search" });
        await expect(submit).toBeVisible({ timeout: 30_000 });
        const look = await submit.evaluate((el) => {
          const s = getComputedStyle(el);
          const icon = el.querySelector("svg");
          return {
            bg: s.backgroundColor,
            icon: icon ? getComputedStyle(icon).color : "",
            round: parseFloat(s.borderTopLeftRadius) >= el.getBoundingClientRect().height / 2,
            size: Math.round(el.getBoundingClientRect().width),
          };
        });
        // Never a white icon on orange.
        expect(look).toEqual({ bg: "rgb(255, 72, 0)", icon: "rgb(0, 0, 0)", round: true, size: 44 });
        const bar = search.locator("[data-search-bar]");
        expect(Math.round((await bar.boundingBox())?.height ?? 0)).toBe(52);
        expect(await bar.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) >= 26)).toBe(true);
        // 44px targets: the location segment and the submit.
        expect((await search.getByRole("button", { name: /^Location: / }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        // The query field's ring is the global one (never orange), drawn inside the bar.
        const field = search.getByRole("searchbox", { name: "Search events" });
        await field.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        const ring = await field.evaluate((el) => ({ offset: getComputedStyle(el).outlineOffset, color: getComputedStyle(el).outlineColor }));
        expect(ring.offset).toBe("-2px");
        expect(ring.color).toBe(theme === "dark" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)");
      });
    });
  }
}

test.describe("near you, from the home at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 }, permissions: ["geolocation"], geolocation: HERE });

  test("asks for the position only on the click, keeps only the suburb, and the API never sees either", async ({ page }) => {
    await countGeolocation(page);
    const requested = await mockApi(page);
    await page.goto("/");
    await expect(page.locator("[data-home-section]").first()).toBeVisible({ timeout: 30_000 });
    // Never on load.
    expect(await geoCalls(page)).toBe(0);

    const { search, location, panel } = await openPanel(page);
    expect(await geoCalls(page)).toBe(0);
    await expect(panel.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy#location");
    await panel.getByRole("button", { name: "Use my current location" }).click();

    // The nearest suburb, shown on the segment; the panel closes and focus comes back to it.
    await expect(search.getByRole("button", { name: "Location: Fitzroy" })).toBeVisible({ timeout: 10_000 });
    await expect(panel).toBeHidden();
    await expect(location).toBeFocused();
    expect(await geoCalls(page)).toBe(1);
    // Nothing submitted by itself (WCAG 3.2.2).
    expect(new URL(page.url()).pathname).toBe("/");
    const stored = await page.evaluate((key) => localStorage.getItem(key), NEAR_STORAGE_KEY);
    expect(JSON.parse(stored ?? "null")).toEqual({ suburb: "Fitzroy" });
    const lat = String(HERE.latitude).slice(0, 7);
    const lng = String(HERE.longitude).slice(0, 7);
    const everything = await page.evaluate(() => JSON.stringify({ ...localStorage }) + document.documentElement.outerHTML);
    expect(everything).not.toContain(lat);
    expect(everything).not.toContain(lng);

    await search.getByRole("searchbox", { name: "Search events" }).fill("a");
    await search.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search\?q=a&near=Fitzroy$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("“a” near Fitzroy");
    expect(page.url()).not.toContain(lat.slice(1));

    // Bands, nearest first; the note says the distances are approximate.
    await expect(page.getByText(/Closest to Fitzroy first\. Distances are between suburb centres, so they’re approximate\./)).toBeVisible({
      timeout: 30_000,
    });
    const bands = await page.locator("[data-near-band] h2").allTextContents();
    const order = ["In Fitzroy", "Within 5 km", "5–15 km", "Further away", "Location not on file"];
    expect(bands[0]).toBe("In Fitzroy");
    expect(bands.map((b) => order.indexOf(b))).toEqual([...bands.map((b) => order.indexOf(b))].sort((a, b) => a - b));
    expect(bands).toContain("Location not on file");

    // The API was asked for events and filters only: no suburb, no position.
    const eventsCalls = requested.filter((u) => u.startsWith("/api/events?"));
    expect(eventsCalls.length).toBeGreaterThan(0);
    for (const call of requested) {
      expect(call).not.toMatch(/near|fitzroy|lat|lng|latitude|longitude/i);
      expect(call).not.toContain(lat);
    }

    // The header leaves its bar out on /search: one search, one location.
    await expect(page.getByRole("search")).toHaveCount(1);
  });

  test("remembers the suburb after a reload, and Anywhere in Melbourne forgets it", async ({ page }) => {
    await page.addInitScript(
      ([key]) => {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem(key, JSON.stringify({ suburb: "Carlton" }));
          sessionStorage.setItem("seeded", "1");
        }
      },
      [NEAR_STORAGE_KEY],
    );
    await mockApi(page);
    await page.goto("/");
    const search = page.getByRole("search", { name: "Search events" });
    await expect(search.getByRole("button", { name: "Location: Carlton" })).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(search.getByRole("button", { name: "Location: Carlton" })).toBeVisible({ timeout: 30_000 });

    const { panel, location } = await openPanel(page);
    await panel.getByRole("button", { name: "Anywhere in Melbourne" }).click();
    await expect(panel).toBeHidden();
    await expect(location).toBeFocused();
    await expect(search.getByRole("button", { name: "Location: Your suburb" })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), NEAR_STORAGE_KEY)).toBeNull();
    // An empty location stays out of the address.
    await search.getByRole("searchbox", { name: "Search events" }).fill("jazz");
    await search.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search\?q=jazz$/, { timeout: 30_000 });
  });

  test("a typed suburb submits as near=, and Enter in the field searches", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const { panel } = await openPanel(page);
    const field = panel.getByLabel("Your suburb");
    // 16px, so iOS doesn't zoom in on it.
    expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    await field.fill("St Kilda");
    await field.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=&near=St\+Kilda$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Events near St Kilda");
    await expect(page.getByRole("search", { name: "Search events" }).getByRole("button", { name: "Location: St Kilda" })).toBeVisible();
  });

  test("permission denied: says so and asks for the suburb, storing nothing", async ({ page }) => {
    await page.addInitScript(() => {
      Geolocation.prototype.getCurrentPosition = function (_success, failure) {
        failure?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      };
    });
    await mockApi(page);
    await page.goto("/");
    const { panel } = await openPanel(page);
    await panel.getByRole("button", { name: "Use my current location" }).click();
    await expect(panel.getByRole("status")).toHaveText("Location is off for this site. Type your suburb instead.");
    await expect(panel).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), NEAR_STORAGE_KEY)).toBeNull();
  });

  test("keyboard: Enter opens the panel with focus inside; Escape closes it and returns focus", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const search = page.getByRole("search", { name: "Search events" });
    const field = search.getByRole("searchbox", { name: "Search events" });
    const location = search.getByRole("button", { name: /^Location: / });
    const panel = page.getByRole("dialog", { name: "Find events near you" });
    await expect(async () => {
      await field.focus();
      await page.keyboard.press("Tab");
      await expect(location).toBeFocused({ timeout: 1_000 });
      await page.keyboard.press("Enter");
      await expect(panel.getByRole("button", { name: "Use my current location" })).toBeFocused({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    // Tab moves on inside the panel.
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("link", { name: "Privacy" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(location).toBeFocused();
    // Then on to the submit.
    await page.keyboard.press("Tab");
    await expect(search.getByRole("button", { name: "Search" })).toBeFocused();
  });
});

test.describe("near you at 320px", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the bar and its open panel fit: no sideways scroll", async ({ page }) => {
    await page.addInitScript(([key]) => localStorage.setItem(key, JSON.stringify({ suburb: "Brunswick East" })), [NEAR_STORAGE_KEY]);
    await mockApi(page);
    await page.goto("/");
    const { search, panel } = await openPanel(page);
    const barBox = await search.locator("[data-search-bar]").boundingBox();
    const panelBox = await panel.boundingBox();
    if (!barBox || !panelBox) throw new Error("not laid out");
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(320);
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(320);
    // Under the bar.
    expect(panelBox.y).toBeGreaterThan(barBox.y + barBox.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe("the header's bar at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("on /events: a black submit, orange on hover; the panel opens under the segment", async ({ page }) => {
    await mockApi(page);
    await page.goto("/events");
    const search = page.getByRole("search", { name: "Search the site" });
    const submit = search.getByRole("button", { name: "Search" });
    await expect(submit).toBeVisible({ timeout: 30_000 });
    expect(await submit.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(0, 0, 0)");
    await submit.hover();
    await expect.poll(() => submit.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 72, 0)");
    expect(Math.round((await search.locator("[data-search-bar]").boundingBox())?.height ?? 0)).toBe(44);

    const location = search.getByRole("button", { name: /^Location: / });
    const panel = page.getByRole("dialog", { name: "Find events near you" });
    await expect(async () => {
      if (!(await panel.isVisible())) await location.click();
      await expect(panel).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    const segment = await location.boundingBox();
    const box = await panel.boundingBox();
    if (!segment || !box) throw new Error("not laid out");
    expect(Math.round(box.width)).toBe(320);
    expect(box.y).toBeGreaterThan(segment.y + segment.height);
    expect(Math.abs(box.x - segment.x)).toBeLessThanOrEqual(1);
  });
});
