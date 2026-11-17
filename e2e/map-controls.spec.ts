import { expect, test, type Page } from "@playwright/test";
import { fixtures, mockMapNetwork } from "./map-network";

/*
 * Nearby's controls on a 390px phone (redesign PR 5: the owner's 390 mock and the rules' Tags &
 * chips board): the site's search bar (one 48px field opening the search sheet, with Where, the one
 * location control, inside); a "Filters" button beside the List | Map switch; the filters (48px
 * chips, radius 8) behind it, wrapping, never sideways; then the count. Live mode, /api/* and
 * tiles answered here (e2e/map-network.ts).
 */

async function openNearby(page: Page, path = "/map") {
  await mockMapNetwork(page);
  await page.goto(path);
  await expect(page.locator("[data-map-count]")).toBeVisible({ timeout: 20_000 });
}

async function openFilters(page: Page) {
  const button = page.getByRole("button", { name: /^Filters/ });
  // The dev server may still be hydrating the page: press until it opens (never twice once it has).
  await expect(async () => {
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole("form", { name: "Filter events" })).toBeVisible();
}

/** The filters, in order: Tonight, This weekend, Date, All scenes, Any price (and Distance once there's a place). */
const FILTERS = (page: Page) => [
  page.getByRole("button", { name: "Tonight" }),
  page.getByRole("button", { name: "This weekend" }),
  page.locator("[data-date-chip]"),
  page.locator("[data-select-filter]").filter({ has: page.getByRole("combobox", { name: "Category" }) }),
  page.locator("[data-select-filter]").filter({ has: page.getByRole("combobox", { name: "Price" }) }),
];

async function expectFiltersInView(page: Page) {
  for (const filter of FILTERS(page)) {
    const box = await filter.boundingBox();
    if (!box) throw new Error("filter not laid out");
    expect(box.height).toBe(48);
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(390 - 16 + 0.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
}

test.describe("Nearby's controls at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: [] });

  test("the search is one 48px field that opens the search sheet, as on the home, with Where inside; one location control", async ({ page }) => {
    await openNearby(page);
    const trigger = page.locator("[data-location-field] [data-search-trigger]");
    await expect(trigger).toHaveAccessibleName("Search events");
    const box = await trigger.boundingBox();
    expect(box?.height).toBe(48);
    expect(box?.width).toBe(358);
    expect(await trigger.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("8px");
    // The 1.5px stroke (drawn as 1px on a 1x screen).
    expect(await trigger.evaluate((el) => getComputedStyle(el).borderTopWidth)).toMatch(/^1(\.5)?px$/);
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Search events" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Where: Your suburb" })).toBeVisible();
    // Typed text stays 16px (iOS zooms into a smaller field).
    expect(await sheet.getByRole("combobox", { name: "Search events" }).evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    // No second location control (the audit: "the header says Caulfield East, the page filter says All of Australia").
    await expect(page.getByRole("combobox", { name: "Location" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Where:/ })).toHaveCount(1);
  });

  test("the filters sit behind Filters, beside List | Map; opened, they're 48px, wrapping, nothing sideways", async ({ page }) => {
    await openNearby(page);
    const filtersButton = page.getByRole("button", { name: /^Filters/ });
    const group = page.getByRole("group", { name: "Show events as" });
    const [buttonBox, groupBox] = await Promise.all([filtersButton.boundingBox(), group.boundingBox()]);
    if (!buttonBox || !groupBox) throw new Error("not laid out");
    expect(buttonBox.x).toBe(16);
    expect(groupBox.x + groupBox.width).toBe(374);
    expect(Math.abs(buttonBox.y + buttonBox.height / 2 - (groupBox.y + groupBox.height / 2))).toBeLessThanOrEqual(1);
    await expect(page.getByRole("form", { name: "Filter events" })).toHaveCount(0);

    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await openFilters(page);
    await expectFiltersInView(page);
  });

  test("Tonight is off by default; pressing it chooses it (black, in the address, counted on Filters) and again clears it", async ({ page }) => {
    await openNearby(page);
    await openFilters(page);
    const tonight = page.getByRole("button", { name: "Tonight" });
    await expect(tonight).toHaveAttribute("aria-pressed", "false");
    await tonight.click();
    await expect(tonight).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/[?&]time=tonight\b/);
    await expect(tonight).toHaveCSS("background-color", "rgb(0, 0, 0)"); // retries: the colour eases in
    await expect(page.getByRole("button", { name: /^Filters/ })).toHaveAccessibleName("Filters, 1 active");
    await tonight.click();
    await expect(tonight).toHaveAttribute("aria-pressed", "false");
    await expect(page).not.toHaveURL(/time=/);
  });

  test("the list is the default; Map switches the view and is written to the address", async ({ page }) => {
    await openNearby(page);
    await expect(page.locator("[data-map-count]")).toHaveText(/^\d+ upcoming events?$/);
    const group = page.getByRole("group", { name: "Show events as" });
    const map = group.getByRole("button", { name: "Map" });
    const list = group.getByRole("button", { name: "List" });
    await expect(list).toHaveAttribute("aria-pressed", "true");
    await expect(list).toHaveCSS("background-color", "rgb(0, 0, 0)"); // retries: the colour eases in
    await expect(page.getByRole("region", { name: "Events list" })).toBeVisible();
    await expect(page.locator(".leaflet-container")).toBeHidden();
    await map.click();
    await expect(map).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/[?&]view=map\b/);
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await list.click();
    await expect(page.getByRole("region", { name: "Events list" })).toBeVisible();
    await expect(page).not.toHaveURL(/view=/);
  });
});

test.describe("Nearby at 320×640", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, permissions: [] });

  test("Filters and List | Map wrap or fit, nothing sideways; Escape closes the filters and returns to Filters", async ({ page }) => {
    await openNearby(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const group = page.getByRole("group", { name: "Show events as" });
    const groupBox = await group.boundingBox();
    expect((groupBox?.x ?? 0) + (groupBox?.width ?? 0)).toBeLessThanOrEqual(304);
    await openFilters(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.getByRole("button", { name: "Tonight" }).focus();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("form", { name: "Filter events" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Filters/ })).toBeFocused();
  });
});

// Before the web font arrives (a cold dev server in CI), the filters are set in the fallback: on a Linux runner
// without Arial that's a wider face (DejaVu Sans). They must still wrap inside the screen.
test.describe("Nearby's filters at 390×844 in the fallback font", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: [] });

  test("every filter is still in view", async ({ page }) => {
    await page.route(/\.woff2?(?:$|\?)/, (route) => route.abort());
    await openNearby(page);
    expect(await page.getByRole("button", { name: /^Filters/ }).evaluate(() => document.fonts.check('500 16px "Instrument Sans"'))).toBe(
      false,
    );
    await openFilters(page);
    await expectFiltersInView(page);
  });
});

/*
 * The radius in a real browser (the audit's P1): a place in Where, the list and count within 25 km
 * of it, the rest under Further away, and the empty state far from everything.
 */
test.describe("Nearby within a radius at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 }, permissions: [] });

  test("a saved place: 'N upcoming events within 25 km of …', Distance black, the rest further away", async ({ page }) => {
    await mockMapNetwork(page);
    // The sample events are all in inner Melbourne; one is moved to Brisbane.
    await page.route("**/api/events?*", (route) =>
      route.fulfill({
        json: {
          items: fixtures(Date.now()).map((event, i) =>
            i === 0 ? { ...event, title: "Valley Show", suburb: "Fortitude Valley", state: "QLD", timeZone: "Australia/Brisbane" } : event,
          ),
          nextCursor: undefined,
        },
      }),
    );
    await page.addInitScript(() => localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Caulfield East", state: "VIC" })));
    await page.goto("/map");
    const count = page.locator("[data-map-count]");
    await expect(count).toHaveText(/^\d+ upcoming events? within 25 km of Caulfield East$/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Where: Caulfield East" })).toBeVisible();
    const distance = page.getByRole("combobox", { name: "Distance" });
    const distanceChip = page.locator("[data-select-filter]").filter({ has: distance });
    await expect(distance).toHaveValue("25");
    await expect(distanceChip).toContainText("Within 25 km");
    // The default radius is not "active": outlined, not filled (one rule with the other filters).
    await expect(distanceChip).toHaveCSS("background-color", "rgb(255, 255, 255)"); // retries: the colour eases in
    await expect(page.getByRole("link", { name: "Valley Show", exact: true })).toHaveCount(0);
    const further = page.locator("[data-further-away]");
    await expect(further).toContainText("Further away");
    await expect(further).toContainText(/\d+ more events? outside 25 km — [^.]*Fortitude Valley/);

    // The rows say how far each is, nearest first, none past 25 km.
    const distances = await page.locator("[data-scene-row]").evaluateAll((els) =>
      els.map((el) => {
        const match = /([\d,.]+|< 1) km away/.exec(el.textContent ?? "");
        return match ? Number(match[1].replace(/[^\d.]/g, "") || 0) : Number.POSITIVE_INFINITY;
      }),
    );
    expect(distances.length).toBeGreaterThan(0);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(Math.max(...distances)).toBeLessThanOrEqual(25);

    await further.getByRole("button", { name: "Show all of Australia" }).click();
    await expect(page.getByRole("link", { name: "Valley Show", exact: true })).toBeVisible();
    await expect(distance).toHaveValue("all");
    await expect(distance).toBeFocused();
    await expect(distanceChip).toHaveCSS("background-color", "rgb(0, 0, 0)"); // retries: the colour eases in
    await expect(page).toHaveURL(/[?&]within=all\b/);
    await expect(further).toHaveCount(0);
  });

  test("nothing near: the audit's empty state, and a wider radius from it", async ({ page }) => {
    await mockMapNetwork(page);
    await page.addInitScript(() => localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Geelong", state: "VIC" })));
    await page.goto("/map");
    const empty = page.locator("[data-nearby-empty]");
    await expect(empty.getByRole("heading", { level: 3 })).toHaveText("No events found near Geelong.", { timeout: 30_000 });
    await expect(empty).toContainText("Try expanding your search area.");
    await expect(empty.getByRole("button", { name: "Within 25 km" })).toHaveAttribute("aria-pressed", "true");
    await empty.getByRole("button", { name: "50 km" }).click();
    await expect(page.getByRole("combobox", { name: "Distance" })).toHaveValue("50");
    await expect(page.locator("[data-map-count]")).toHaveText(/within 50 km of Geelong$/);
  });
});
