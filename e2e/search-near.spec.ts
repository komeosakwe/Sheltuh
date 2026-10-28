import { devices, expect, test, type Page } from "@playwright/test";
import { pressFocusLikeWebKit } from "./webkit-focus";
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

/**
 * The sample events (every suburb in the table: Melbourne's, and Newtown NSW, Fortitude Valley QLD
 * and Northbridge WA), and one more in a suburb it doesn't know.
 */
function fixtures(now: number): PublicEvent[] {
  const listed = sampleEvents.map((event, i) => ({
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
  const unmapped = { ...listed[0], eventId: "e2e-unmapped", slug: "e2e-unmapped", title: "Somewhere unmapped", suburb: "Atlantis" };
  return [...listed, unmapped];
}

/** Every Referer the page sent with its /api/* requests ("" when none), by mockApi. */
const referers = new WeakMap<Page, string[]>();

/** Answers /api/*, and returns every API URL the page asked for. */
async function mockApi(page: Page): Promise<string[]> {
  const requested: string[] = [];
  const sent: string[] = [];
  referers.set(page, sent);
  const events = fixtures(Date.now());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    requested.push(url.pathname + url.search);
    sent.push((await route.request().headerValue("referer")) ?? "");
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
    await expect(panel.getByRole("link", { name: "How we use your location" })).toHaveAttribute("href", "/privacy#location");
    await panel.getByRole("button", { name: "Use my current location" }).click();

    // The nearest suburb, shown on the segment; the panel closes and focus comes back to it.
    await expect(search.getByRole("button", { name: "Location: Fitzroy" })).toBeVisible({ timeout: 10_000 });
    await expect(panel).toBeHidden();
    await expect(location).toBeFocused();
    expect(await geoCalls(page)).toBe(1);
    // Nothing submitted by itself (WCAG 3.2.2).
    expect(new URL(page.url()).pathname).toBe("/");
    const stored = await page.evaluate((key) => localStorage.getItem(key), NEAR_STORAGE_KEY);
    expect(JSON.parse(stored ?? "null")).toEqual({ suburb: "Fitzroy", state: "VIC" });
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
    await expect(page.getByText(/Closest to Fitzroy, VIC first\. Distances are approximate\./)).toBeVisible({
      timeout: 30_000,
    });
    const bands = await page.locator("[data-near-band] h2").allTextContents();
    const order = ["In Fitzroy, VIC", "Within 5 km", "5–15 km", "15–100 km", "Over 100 km", "Location not on file"];
    expect(bands[0]).toBe("In Fitzroy, VIC");
    expect(bands.map((b) => order.indexOf(b))).toEqual([...bands.map((b) => order.indexOf(b))].sort((a, b) => a - b));
    // Only the made-up suburb isn't in the table; the interstate events are over 100 km away.
    expect(bands.at(-1)).toBe("Location not on file");
    expect(bands.at(-2)).toBe("Over 100 km");
    // Soonest first (the fixtures start in the samples' order).
    await expect(page.locator("[data-near-band='distant'] h3")).toHaveText([
      "King Street Fuzz Night",
      "Valley Risograph Fair",
      "Northbridge Late Sketch",
    ]);
    await expect(page.locator("[data-near-band='unknown'] h3")).toHaveText(["Somewhere unmapped"]);

    // The API was asked for events and filters only: no suburb, no position.
    const eventsCalls = requested.filter((u) => u.startsWith("/api/events?"));
    expect(eventsCalls.length).toBeGreaterThan(0);
    for (const call of requested) {
      expect(call).not.toMatch(/near|fitzroy|lat|lng|latitude|longitude/i);
      expect(call).not.toContain(lat);
    }
    // Nor in a Referer: the API client and /search send only the origin (strict-origin).
    const sent = referers.get(page) ?? [];
    expect(sent.length).toBe(requested.length);
    for (const referer of sent) expect(referer).not.toMatch(/near|fitzroy|search/i);
    expect(sent.at(-1)).toBe(new URL("/", page.url()).href);
    // And the page itself says so for any request it makes.
    expect((await page.request.get(page.url())).headers()["referrer-policy"]).toBe("strict-origin");

    // The header leaves its bar out on /search: one search, one location.
    await expect(page.getByRole("search")).toHaveCount(1);
  });

  test("remembers the suburb after a reload, and Anywhere in Australia forgets it", async ({ page }) => {
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
    await panel.getByRole("button", { name: "Anywhere in Australia" }).click();
    await expect(panel).toBeHidden();
    await expect(location).toBeFocused();
    // The explicit choice shows, rather than the "Your suburb" prompt.
    await expect(search.getByRole("button", { name: "Location: Anywhere" })).toBeVisible();
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
    const field = panel.getByLabel("Suburb", { exact: true });
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
    const use = panel.getByRole("button", { name: "Use my current location" });
    await use.click();
    const status = panel.getByRole("status");
    await expect(status).toHaveText("Location is off for this site. Type your suburb instead.");
    await expect(panel).toBeVisible();
    // Right under the button, and focus has moved on to the suburb field, which the message describes.
    const [useBox, statusBox] = [await use.boundingBox(), await status.boundingBox()];
    if (!useBox || !statusBox) throw new Error("not laid out");
    expect(statusBox.y - (useBox.y + useBox.height)).toBeGreaterThanOrEqual(0);
    expect(statusBox.y - (useBox.y + useBox.height)).toBeLessThanOrEqual(12);
    const field = panel.getByLabel("Suburb", { exact: true });
    await expect(field).toBeFocused();
    await expect(field).toHaveAccessibleDescription("Location is off for this site. Type your suburb instead.");
    expect(await page.evaluate((key) => localStorage.getItem(key), NEAR_STORAGE_KEY)).toBeNull();
    // Typing clears the message.
    await field.fill("Carl");
    await expect(status).toHaveText("");
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
    await expect(panel.getByLabel("Suburb", { exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(location).toBeFocused();
    // Then on to the submit.
    await page.keyboard.press("Tab");
    await expect(search.getByRole("button", { name: "Search" })).toBeFocused();
  });

  test("keyboard: tabbing out of the panel closes it, and focus goes on to Search", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const { search, panel } = await openPanel(page);
    const privacy = panel.getByRole("link", { name: "How we use your location" });
    // Use my current location → Suburb → Anywhere in Australia → How we use your location → out.
    for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
    await expect(privacy).toBeFocused();
    await expect(panel).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(panel).toBeHidden();
    await expect(search.getByRole("button", { name: "Search" })).toBeFocused();
  });

  test("a short screen: opening the panel scrolls the page so all of it shows", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 560 });
    await mockApi(page);
    await page.goto("/");
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const { search, panel } = await openPanel(page);
    // The page scrolled up to make room.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const bar = await search.locator("[data-search-bar]").boundingBox();
    const box = await panel.boundingBox();
    if (!bar || !box) throw new Error("not laid out");
    expect(box.y).toBeGreaterThan(bar.y + bar.height);
    expect(box.y + box.height).toBeLessThanOrEqual(560);
    // The whole panel, not a scrolling slice of it.
    expect(await panel.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
    // The bar is still in view, below the site header.
    const header = await page.locator("body header").first().boundingBox();
    expect(bar.y).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0));
  });
});

test.describe("near you, from Perth at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 }, permissions: ["geolocation"], geolocation: { latitude: -31.9523, longitude: 115.8613 } });

  test("names the suburb anywhere in Australia; Northbridge is near, every Melbourne event over 100 km away", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const { search, panel } = await openPanel(page);
    await panel.getByRole("button", { name: "Use my current location" }).click();
    await expect(search.getByRole("button", { name: "Location: Perth" })).toBeVisible({ timeout: 10_000 });
    expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), NEAR_STORAGE_KEY)) ?? "null")).toEqual({ suburb: "Perth", state: "WA" });
    await search.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search\?q=&near=Perth$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Events near Perth");
    await expect(page.locator("[data-near-band]").first()).toBeVisible({ timeout: 30_000 });
    expect(await page.locator("[data-near-band] h2").allTextContents()).toEqual([
      "Within 5 km",
      "Over 100 km",
      "Location not on file",
    ]);
    await expect(page.locator("[data-near-band='near'] h3")).toHaveText(["Northbridge Late Sketch"]);
  });

  test("a suburb typed with its state finds that one", async ({ page }) => {
    await mockApi(page);
    await page.goto("/search?near=Richmond%2C+NSW");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Events near Richmond NSW", { timeout: 30_000 });
    await expect(page.locator("[data-near-band]").first()).toBeVisible({ timeout: 30_000 });
    // Newtown NSW is about 50 km away; Melbourne's Richmond and the rest, over 100 km.
    expect(await page.locator("[data-near-band] h2").allTextContents()).toEqual([
      "15–100 km",
      "Over 100 km",
      "Location not on file",
    ]);
    await expect(page.locator("[data-near-band='far'] h3")).toHaveText(["King Street Fuzz Night"]);
  });

  test("a city's name finds its centre: Brisbane is Brisbane City, and Fortitude Valley is near it", async ({ page }) => {
    await mockApi(page);
    await page.goto("/search?near=Brisbane");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Events near Brisbane City", { timeout: 30_000 });
    await expect(page.locator("[data-near-band]").first()).toBeVisible({ timeout: 30_000 });
    expect(await page.locator("[data-near-band] h2").allTextContents()).toEqual([
      "Within 5 km",
      "Over 100 km",
      "Location not on file",
    ]);
    await expect(page.locator("[data-near-band='near'] h3")).toHaveText(["Valley Risograph Fair"]);
  });
});

test.describe("/search without near, at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("prefills the remembered suburb without re-running the search, and says to press Search", async ({ page }) => {
    await page.addInitScript(([key]) => localStorage.setItem(key, JSON.stringify({ suburb: "Carlton" })), [NEAR_STORAGE_KEY]);
    await mockApi(page);
    await page.goto("/search?q=a");
    const search = page.getByRole("search", { name: "Search events" });
    await expect(search.getByRole("button", { name: "Location: Carlton" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("“a”");
    await expect(search.locator("[data-near-hint]")).toHaveText("Press Search to update results.");
    await expect(page.locator("[data-near-band]")).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("?q=a");
    // Search applies it.
    await search.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search\?q=a&near=Carlton$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("“a” near Carlton");
    await expect(search.locator("[data-near-hint]")).toHaveText("");
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

  test("on /events: a black submit, orange on hover; the panel opens below the header, within the bar's edges", async ({ page }) => {
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
    const bar = await search.locator("[data-search-bar]").boundingBox();
    const header = await page.locator("header").first().boundingBox();
    const box = await panel.boundingBox();
    if (!segment || !bar || !header || !box) throw new Error("not laid out");
    expect(Math.round(box.width)).toBe(320);
    // Below the header's bottom rule, not over it.
    expect(box.y).toBeGreaterThanOrEqual(header.y + header.height + 7);
    // Under the segment where it can be, never past the bar's right edge.
    expect(box.x).toBeGreaterThanOrEqual(bar.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
    expect(Math.round(box.x)).toBe(Math.round(Math.max(bar.x, Math.min(segment.x, bar.x + bar.width - 320))));
  });
});

test.describe("the hero's bar at 1024px", () => {
  test.use({ viewport: { width: 1024, height: 900 } });

  test("the panel sits under the segment, inside the bar's edges", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const { search, location, panel } = await openPanel(page);
    const segment = await location.boundingBox();
    const bar = await search.locator("[data-search-bar]").boundingBox();
    const box = await panel.boundingBox();
    if (!segment || !bar || !box) throw new Error("not laid out");
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height + 7);
    expect(box.x).toBeGreaterThanOrEqual(bar.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
    expect(Math.round(box.x)).toBe(Math.round(Math.max(bar.x, Math.min(segment.x, bar.x + bar.width - 320))));
  });
});

test.describe("near you on an iPhone-sized touch screen, as WebKit moves focus", () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPhone 13"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, permissions: ["geolocation"], geolocation: HERE });

  /** Taps the hero's location segment until the page has hydrated and the panel is open. */
  async function tapOpen(page: Page) {
    const search = page.getByRole("search", { name: "Search events" });
    const panel = page.getByRole("dialog", { name: "Find events near you" });
    await expect(async () => {
      if (!(await panel.isVisible())) await search.getByRole("button", { name: /^Location: / }).tap();
      await expect(panel.getByRole("button", { name: "Use my current location" })).toBeFocused({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    return { search, panel };
  }

  test("tapping Use my current location sets the suburb (it used to close the panel and do nothing)", async ({ page }) => {
    await pressFocusLikeWebKit(page);
    await mockApi(page);
    await page.goto("/");
    const { search, panel } = await tapOpen(page);
    // A tap on the panel's own words leaves it open.
    await panel.getByText("Find events near you").tap();
    await expect(panel).toBeVisible();
    await expect(page.locator("main")).toBeFocused();
    await panel.getByRole("button", { name: "Use my current location" }).tap();
    await expect(search.getByRole("button", { name: "Location: Fitzroy" })).toBeVisible({ timeout: 10_000 });
    await expect(panel).toBeHidden();
    const stored = await page.evaluate((key) => localStorage.getItem(key), NEAR_STORAGE_KEY);
    expect(JSON.parse(stored ?? "null")).toEqual({ suburb: "Fitzroy", state: "VIC" });

    // Anywhere in Australia, tapped, clears it.
    await tapOpen(page);
    await panel.getByRole("button", { name: "Anywhere in Australia" }).tap();
    await expect(search.getByRole("button", { name: "Location: Anywhere" })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), NEAR_STORAGE_KEY)).toBeNull();
  });

  test("permission denied: the panel stays open and says so", async ({ page }) => {
    await pressFocusLikeWebKit(page);
    await page.addInitScript(() => {
      Geolocation.prototype.getCurrentPosition = function (_success, failure) {
        failure?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      };
    });
    await mockApi(page);
    await page.goto("/");
    const { panel } = await tapOpen(page);
    await panel.getByRole("button", { name: "Use my current location" }).tap();
    await expect(panel.getByRole("status")).toHaveText("Location is off for this site. Type your suburb instead.");
    await expect(panel).toBeVisible();
  });
});
