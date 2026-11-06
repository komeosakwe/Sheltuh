import { expect, test } from "@playwright/test";
import { fixtures, mockMapNetwork } from "./map-network";

/**
 * An organiser's photo focus point on /map (docs/architecture.md, "Photo focus"). The pins and
 * cluster stacks sit inside Leaflet's marker pane, where leaflet.css gives every `img` `width: auto`
 * (more specific than a utility class), so a photo that isn't square stopped filling its box: it
 * kept its own proportions, was cut off at the left edge, and `object-position` had nothing to move.
 * These check the box the photo actually fills, not just the style attribute.
 */

const FOCUS = { x: 15, y: 70 };

test.use({ viewport: { width: 1280, height: 800 }, permissions: [] });

test("map pins, cluster stacks and list thumbnails fill their box and keep the focus point", async ({ page }) => {
  await mockMapNetwork(page);
  // Every event has a 3:2 photo with a focus point, so whatever the map draws (pins or stacks) shows one.
  await page.route("**/api/events?*", (route) =>
    route.fulfill({
      json: {
        items: fixtures(Date.now()).map((event) => ({
          ...event,
          imageUrl: "/events/dj-crate-digging.jpg",
          imageFocus: FOCUS,
        })),
        nextCursor: undefined,
      },
    }),
  );
  await page.goto("/map");
  await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
  const photos = page.locator(".leaflet-marker-pane img[style*='object-position']");
  await expect(photos.first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("img[style*='object-position']").first()).toBeVisible();

  const geometry = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>("img[style*='object-position']")).map((img) => {
      const box = img.parentElement!.getBoundingClientRect();
      const rect = img.getBoundingClientRect();
      return {
        inMap: Boolean(img.closest(".leaflet-marker-pane")),
        objectPosition: getComputedStyle(img).objectPosition,
        objectFit: getComputedStyle(img).objectFit,
        widthGap: Math.abs(rect.width - box.width),
        heightGap: Math.abs(rect.height - box.height),
      };
    }),
  );
  expect(geometry.some((entry) => entry.inMap)).toBe(true);
  expect(geometry.some((entry) => !entry.inMap)).toBe(true);
  for (const entry of geometry) {
    expect(entry.objectPosition).toBe("15% 70%");
    expect(entry.objectFit).toBe("cover");
    expect(entry.widthGap).toBeLessThan(1);
    expect(entry.heightGap).toBeLessThan(1);
  }
});
