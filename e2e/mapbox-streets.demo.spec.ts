import { expect, test, type Page } from "@playwright/test";

/**
 * Mapbox Streets on every map (docs/maps.md), on the demo build:
 * playwright.config.ts gives it a placeholder public token, as a deployment
 * with NEXT_PUBLIC_MAPBOX_TOKEN set would have. Every tile request is
 * intercepted and answered with a small image (nothing reaches mapbox.com or
 * Esri), and the specs check which tiles the maps asked for. Runs in the
 * "demo" project (the file name ends demo.spec.ts). Without a token the maps
 * are Esri's: e2e/map-tiles.spec.ts and e2e/event-page.spec.ts.
 */

const TOKEN = "pk.e2e-placeholder";

const MAPBOX_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAH0lEQVR42mM4cW0fSYjhxLV9H948IB6NahjVMHQ0AADQ0bB/+1XgiAAAAABJRU5ErkJggg==",
  "base64",
);
const ESRI_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR42mM4QSJgOHHixCNSwKiGUQ1DRwMAAaucrZWSFIMAAAAASUVORK5CYII=",
  "base64",
);

const TILE_URL = /^https:\/\/api\.mapbox\.com\/styles\/v1\/mapbox\/([a-z0-9-]+)\/tiles\/512\/\d+\/\d+\/\d+@2x\?access_token=(.+)$/;

/** Answers every tile request; returns the Mapbox and Esri tile URLs the page asked for. */
async function mockTiles(page: Page) {
  const requested = { mapbox: [] as string[], esri: [] as string[] };
  await page.route("https://api.mapbox.com/**", (route) => {
    requested.mapbox.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: MAPBOX_TILE });
  });
  await page.route("https://server.arcgisonline.com/**", (route) => {
    requested.esri.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: ESRI_TILE });
  });
  return requested;
}

/** Every Mapbox tile URL is a Streets tile carrying the public token. */
function expectStreetsUrls(urls: string[]) {
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    const match = TILE_URL.exec(url);
    expect(match, url).not.toBeNull();
    expect(match?.[1]).toBe("streets-v12");
    expect(match?.[2]).toBe(TOKEN);
  }
}

/** Waits until the map in `scope` has tiles, all loaded, all Mapbox Streets. */
async function expectStreetsTiles(page: Page, scope = "body") {
  await expect
    .poll(
      async () => {
        const tiles = await page.locator(`${scope} img.leaflet-tile`).evaluateAll((imgs) =>
          imgs.map((img) => ({ src: (img as HTMLImageElement).src, loaded: img.classList.contains("leaflet-tile-loaded") })),
        );
        if (tiles.length === 0 || tiles.some((tile) => !tile.loaded)) return "loading";
        return [...new Set(tiles.map((tile) => TILE_URL.exec(tile.src)?.[1] ?? tile.src))].join(",");
      },
      { timeout: 20_000 },
    )
    .toBe("streets-v12");
}

/** By href, not role: the event page's map is aria-hidden (its two map links are the named controls). */
async function expectMapboxCredits(page: Page, scope = "body") {
  const credits = page.locator(`${scope} .leaflet-control-attribution`);
  await expect(credits.locator('a[href="https://www.mapbox.com/about/maps/"]')).toHaveText("Mapbox");
  await expect(credits.locator('a[href="https://www.openstreetmap.org/copyright"]')).toHaveText("OpenStreetMap");
  await expect(credits.locator('a[href="https://www.mapbox.com/map-feedback/"]')).toHaveText("Improve this map");
  await expect(credits).toBeVisible();
  await expect(credits).not.toContainText("Esri");
}

for (const vp of [
  { name: "390×844", width: 390, height: 844 },
  { name: "1440×900", width: 1440, height: 900 },
]) {
  test.describe(`Mapbox Streets on /map at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("Streets tiles with the token and Mapbox's credit, no Esri, no map style control", async ({ page }) => {
      const requested = await mockTiles(page);
      await page.goto("/map");

      await expectStreetsTiles(page);
      expectStreetsUrls(requested.mapbox);
      expect(requested.esri).toEqual([]);
      await expectMapboxCredits(page);
      await expect(page.getByText(/map style/i)).toHaveCount(0);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("Mapbox Streets in the Dark theme", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("/map stays on Streets", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
    const requested = await mockTiles(page);
    await page.goto("/map");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectStreetsTiles(page);
    expectStreetsUrls(requested.mapbox);
    expect(requested.esri).toEqual([]);
  });
});

test.describe("Mapbox Streets on the event page's Location map", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("loads Streets tiles as the section nears the screen, with Mapbox's credit", async ({ page }) => {
    const requested = await mockTiles(page);
    await page.goto("/events/neon-static");
    await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
    const location = page.getByRole("region", { name: "Location" });
    await location.locator("[data-event-map]").scrollIntoViewIfNeeded();
    await expect(location.locator(".leaflet-container")).toBeVisible({ timeout: 20_000 });
    const scope = "[data-event-map]";
    await expectStreetsTiles(page, scope);
    expectStreetsUrls(requested.mapbox);
    expect(requested.esri).toEqual([]);
    await expectMapboxCredits(page, scope);
  });
});

// The owner's report (27 Oct 2026): a 1px hairline between tiles in Chromium on Windows. Here every
// tile is one flat colour and everything Leaflet draws over the tiles is hidden, so any other colour
// inside the map is a seam (components/map/MapStyles.tsx). /map sits at a fractional offset on the
// page, so a seam shows at a devicePixelRatio of 1 too without the fix.
const FLAT_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGOYteMaSYhhVMOohuGrAQA4kygfO9+cnQAAAABJRU5ErkJggg==",
  "base64",
);

for (const deviceScaleFactor of [1, 1.25, 1.5]) {
  test.describe(`no seams between tiles at devicePixelRatio ${deviceScaleFactor}`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor });

    test("/map's tiles meet without a hairline", async ({ page }) => {
      await page.route("https://api.mapbox.com/**", (route) => route.fulfill({ contentType: "image/png", body: FLAT_TILE }));
      await page.goto("/map");
      await expectStreetsTiles(page);
      await page.addStyleTag({
        content:
          ".leaflet-marker-pane, .leaflet-shadow-pane, .leaflet-overlay-pane, .leaflet-popup-pane, .leaflet-control-container { display: none !important; }",
      });
      const shot = await page.locator(".leaflet-container").first().screenshot();
      // Pixels unlike the map's first inner one, skipping the rounded corners and any overlay along the top and bottom.
      const odd = await page.evaluate(
        async ({ src, inset }) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("no 2d context");
          context.drawImage(img, 0, 0);
          const data = context.getImageData(0, 0, img.width, img.height).data;
          const at = (x: number, y: number) => (y * img.width + x) * 4;
          const ref = at(inset, inset);
          let count = 0;
          for (let y = inset; y < img.height - inset; y++) {
            for (let x = 4; x < img.width - 4; x++) {
              const i = at(x, y);
              const diff = Math.abs(data[i] - data[ref]) + Math.abs(data[i + 1] - data[ref + 1]) + Math.abs(data[i + 2] - data[ref + 2]);
              if (diff > 12) count += 1;
            }
          }
          return count;
        },
        { src: `data:image/png;base64,${shot.toString("base64")}`, inset: Math.ceil(64 * deviceScaleFactor) },
      );
      expect(odd).toBe(0);
    });
  });
}
