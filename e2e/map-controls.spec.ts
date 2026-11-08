import { expect, test, type Page } from "@playwright/test";
import { mockMapNetwork } from "./map-network";

/** The four chips the mockup shows at 390px, in order. */
const MOCKUP_CHIPS = (page: Page) => [
  page.getByRole("button", { name: "Tonight" }),
  page.getByRole("button", { name: "This weekend" }),
  page.locator("[data-date-chip]"),
  page.getByRole("combobox", { name: "Category" }).locator(".."),
];

/** Each chip is 32px, after the one before it, and the last ends at or before `right`. */
async function expectChipsInView(page: Page, right: number) {
  let previousRight = 0;
  for (const chip of MOCKUP_CHIPS(page)) {
    const box = await chip.boundingBox();
    if (!box) throw new Error("chip not laid out");
    expect(box.height).toBe(32);
    expect(box.x).toBeGreaterThan(previousRight);
    previousRight = box.x + box.width;
  }
  expect(previousRight).toBeLessThanOrEqual(right);
  await expect(MOCKUP_CHIPS(page)[3]).toContainText("All scenes");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
}

/*
 * /map's controls on a 390px phone, as the owner's mockup (8 Nov 2026): two 40px rounded fields, a
 * row of 32px pill chips (Tonight, This weekend, Date, All scenes all in view), a hairline, then the
 * count beside the Map | List switch. Live mode, /api/* and tiles answered here (e2e/map-network.ts).
 */
test.describe("/map's controls at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: [] });

  test.beforeEach(async ({ page }) => {
    await mockMapNetwork(page);
    await page.goto("/map?view=map");
    await expect(page.locator("[data-map-count]")).toBeVisible({ timeout: 20_000 });
  });

  test("the fields and chips are the mockup's sizes, all four chips in view, nothing sideways", async ({ page }) => {
    const search = page.getByRole("searchbox", { name: "Search events, venues or suburbs" });
    await expect(search).toHaveAttribute("placeholder", "Search events, venues or suburbs");
    const searchBox = await search.boundingBox();
    const location = page.locator("[data-location-field]");
    await expect(location).toContainText("All of Australia");
    const locationBox = await location.boundingBox();
    expect(searchBox?.height).toBe(40);
    expect(locationBox?.height).toBe(40);
    expect(searchBox?.width).toBe(350);
    expect(await search.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("16px");
    // Typed text stays 16px (iOS zooms into a smaller field); the native select under the location is 16px too.
    expect(await search.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect(await page.getByRole("combobox", { name: "Location" }).evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");

    // In Instrument Sans (loaded, not its fallback), the four end at least 8px short of the screen's edge:
    // room for another machine's text rendering.
    await page.evaluate(async () => {
      await document.fonts.load('500 10.5px "Instrument Sans"');
      await document.fonts.load('700 10.5px "Instrument Sans"');
      await document.fonts.ready;
    });
    await expectChipsInView(page, 390 - 8);
  });

  test("Tonight is off by default; pressing it chooses it (peach, in the address) and again clears it", async ({ page }) => {
    const tonight = page.getByRole("button", { name: "Tonight" });
    await expect(tonight).toHaveAttribute("aria-pressed", "false");
    await tonight.click();
    await expect(tonight).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/[?&]time=tonight\b/);
    expect(await tonight.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(252, 212, 187)");
    await tonight.click();
    await expect(tonight).toHaveAttribute("aria-pressed", "false");
    await expect(page).not.toHaveURL(/time=/);
  });

  test("the count sits beside the Map | List switch, which switches the view", async ({ page }) => {
    const count = page.locator("[data-map-count]");
    await expect(count).toHaveText(/^\d+ upcoming events?$/);
    const group = page.getByRole("group", { name: "Show events as" });
    const [countBox, groupBox] = await Promise.all([count.boundingBox(), group.boundingBox()]);
    if (!countBox || !groupBox) throw new Error("not laid out");
    expect(groupBox.x).toBeGreaterThan(countBox.x + countBox.width);
    expect(groupBox.x + groupBox.width).toBe(370);
    expect(Math.abs(groupBox.y + groupBox.height / 2 - (countBox.y + countBox.height / 2))).toBeLessThanOrEqual(8);

    const map = group.getByRole("button", { name: "Map" });
    const list = group.getByRole("button", { name: "List" });
    await expect(map).toHaveAttribute("aria-pressed", "true");
    expect(await map.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(0, 0, 0)");
    await list.click();
    await expect(list).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/[?&]view=list\b/);
    await expect(page.getByRole("region", { name: "Events list" })).toBeVisible();
    await map.click();
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await expect(page).not.toHaveURL(/view=/);
  });
});

// Before the web font arrives (a cold dev server in CI), the chips are set in the fallback: on a Linux runner
// without Arial that's a wider face (DejaVu Sans). All four must still be in view.
test.describe("/map's chips at 390×844 in the fallback font", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: [] });

  test("all four of the mockup's chips are still in view", async ({ page }) => {
    await page.route(/\.woff2?(?:$|\?)/, (route) => route.abort());
    await mockMapNetwork(page);
    await page.goto("/map?view=map");
    await expect(page.locator("[data-map-count]")).toBeVisible({ timeout: 20_000 });
    expect(await page.getByRole("button", { name: "Tonight" }).evaluate(() => document.fonts.check('500 10.5px "Instrument Sans"'))).toBe(
      false,
    );
    await expectChipsInView(page, 390);
  });
});
