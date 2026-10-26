import { expect, test, type Page } from "@playwright/test";

/**
 * The Mapbox style preview on /map (docs/mapbox-preview.md), on the demo
 * build: playwright.config.ts gives it a placeholder public token, as a
 * Vercel preview deployment with NEXT_PUBLIC_MAPBOX_TOKEN set would have.
 * Every Mapbox tile request is intercepted and answered with a small image
 * (nothing reaches mapbox.com), and the specs check which style's tiles the
 * map asked for. Runs in the "demo" project (the file name ends demo.spec.ts).
 */

const TOKEN = "pk.e2e-placeholder";

// 16px placeholder tiles, one shade per style, so a switch is visible in a screenshot.
const TILES: Record<string, Buffer> = {
  "light-v11": Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAH0lEQVR42mO4dOkMSYjh0qUzb968IB6NahjVMHQ0AABLjrZvbH5WLwAAAABJRU5ErkJggg==",
    "base64",
  ),
  "dark-v11": Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHUlEQVR42mMICAgjCTEEBISZmFgQj0Y1jGoYOhoArhKqa/H9VVEAAAAASUVORK5CYII=",
    "base64",
  ),
  "streets-v12": Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAH0lEQVR42mM4cW0fSYjhxLV9H948IB6NahjVMHQ0AADQ0bB/+1XgiAAAAABJRU5ErkJggg==",
    "base64",
  ),
};
const ESRI_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR42mM4QSJgOHHixCNSwKiGUQ1DRwMAAaucrZWSFIMAAAAASUVORK5CYII=",
  "base64",
);

const TILE_URL = /^https:\/\/api\.mapbox\.com\/styles\/v1\/mapbox\/([a-z0-9-]+)\/tiles\/512\/\d+\/\d+\/\d+@2x\?access_token=(.+)$/;

/** Answers every tile request; returns the Mapbox and Esri tile URLs the page asked for. */
async function mockTiles(page: Page) {
  const requested = { mapbox: [] as string[], esri: [] as string[] };
  await page.route("https://api.mapbox.com/**", (route) => {
    const url = route.request().url();
    requested.mapbox.push(url);
    const style = TILE_URL.exec(url)?.[1] ?? "";
    const body = TILES[style];
    return body ? route.fulfill({ contentType: "image/png", body }) : route.fulfill({ status: 404, body: "" });
  });
  await page.route("https://server.arcgisonline.com/**", (route) => {
    requested.esri.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: ESRI_TILE });
  });
  return requested;
}

/** The styles of the Mapbox tiles requested since `from`, checking each URL's shape and token. */
function stylesSince(urls: string[], from: number): Set<string> {
  const styles = new Set<string>();
  for (const url of urls.slice(from)) {
    const match = TILE_URL.exec(url);
    expect(match, url).not.toBeNull();
    expect(match?.[2]).toBe(TOKEN);
    if (match) styles.add(match[1]);
  }
  return styles;
}

/** Waits until every tile on the map is a loaded Mapbox tile in `style`. */
async function expectMapTiles(page: Page, style: string) {
  await expect
    .poll(async () => {
      const tiles = await page.locator("img.leaflet-tile").evaluateAll((imgs) =>
        imgs.map((img) => ({ src: (img as HTMLImageElement).src, loaded: img.classList.contains("leaflet-tile-loaded") })),
      );
      if (tiles.length === 0 || tiles.some((tile) => !tile.loaded)) return "loading";
      const styles = new Set(tiles.map((tile) => TILE_URL.exec(tile.src)?.[1] ?? tile.src));
      return [...styles].join(",");
    }, { timeout: 20_000 })
    .toBe(style);
}

const styleControl = (page: Page) => page.getByLabel("Map style (preview)");

for (const vp of [
  { name: "390×844", width: 390, height: 844 },
  { name: "1440×900", width: 1440, height: 900 },
]) {
  test.describe(`Mapbox preview at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("a labelled style control: Mapbox Light by default, switching re-requests tiles in the chosen style", async ({
      page,
    }) => {
      const requested = await mockTiles(page);
      await page.goto("/map");

      const control = styleControl(page);
      await expect(control).toBeVisible({ timeout: 20_000 });
      await expect(control).toHaveValue("mapbox-light");
      await expect(control.locator("option")).toHaveText([
        "Current (Esri)",
        "Mapbox Light (monochrome)",
        "Mapbox Dark",
        "Mapbox Streets",
      ]);
      expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      await expectMapTiles(page, "light-v11");
      expect(stylesSince(requested.mapbox, 0)).toEqual(new Set(["light-v11"]));
      expect(requested.esri).toEqual([]);
      const credits = page.locator(".leaflet-control-attribution");
      await expect(credits.getByRole("link", { name: "Mapbox" })).toHaveAttribute("href", "https://www.mapbox.com/about/maps/");
      await expect(credits.getByRole("link", { name: "OpenStreetMap" })).toHaveAttribute(
        "href",
        "https://www.openstreetmap.org/copyright",
      );
      await expect(credits.getByRole("link", { name: "Improve this map" })).toBeVisible();

      const before = requested.mapbox.length;
      await control.selectOption("mapbox-dark");
      await expect(page).toHaveURL(/[?&]tiles=mapbox-dark/);
      await expectMapTiles(page, "dark-v11");
      expect(stylesSince(requested.mapbox, before)).toContain("dark-v11");

      // Back to Esri: its tiles and credit.
      await control.selectOption("esri");
      await expect.poll(() => requested.esri.length).toBeGreaterThan(0);
      await expect(credits).toContainText("Esri");
      await expect(credits).not.toContainText("Improve this map");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("the choice is remembered on reload, and ?tiles= opens a shared style", async ({ page }) => {
      const requested = await mockTiles(page);
      await page.goto("/map");
      await styleControl(page).selectOption("mapbox-streets");
      await expect(page).toHaveURL(/tiles=mapbox-streets/);

      // Remembered without the parameter.
      await page.goto("/map");
      await expect(styleControl(page)).toHaveValue("mapbox-streets", { timeout: 20_000 });

      // A shared link wins over the remembered choice.
      const before = requested.mapbox.length;
      await page.goto("/map?tiles=mapbox-dark");
      await expect(styleControl(page)).toHaveValue("mapbox-dark", { timeout: 20_000 });
      await expectMapTiles(page, "dark-v11");
      expect(stylesSince(requested.mapbox, before)).toContain("dark-v11");
    });
  });
}

test.describe("Mapbox preview in the Dark theme", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("defaults to Mapbox Dark, and the control is keyboard-operable", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
    const requested = await mockTiles(page);
    await page.goto("/map");
    const control = styleControl(page);
    await expect(control).toHaveValue("mapbox-dark", { timeout: 20_000 });
    await expectMapTiles(page, "dark-v11");
    expect(stylesSince(requested.mapbox, 0)).toEqual(new Set(["dark-v11"]));

    await control.focus();
    await expect(control).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(control).toHaveValue("mapbox-streets");
  });
});
