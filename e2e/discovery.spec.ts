import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";

/**
 * /events and /map in a real browser (docs/design/brand-direction-one.md §7;
 * owner decisions 1 and 6, and the owner's requests of 21 Oct 2026): the
 * brand h1, image-first cards and list rows with the orange "Buy tickets",
 * the map first on phones, and no sideways scrolling. Live mode, with every
 * /api/* request answered here from the demo sample events, re-timed to the
 * real clock so the spec never goes stale. Map tiles are refused (no network
 * in CI either); the page must still work without them.
 */

const HOUR = 3600_000;

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

async function mockApi(page: Page) {
  const events = fixtures(Date.now());
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/events") return route.fulfill({ json: { items: events, nextCursor: undefined } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  await page.route("https://server.arcgisonline.com/**", (route) => route.abort());
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const VIEWPORTS = [
  { name: "phone 390×844", width: 390, height: 844, phone: true },
  { name: "desktop 1440×900", width: 1440, height: 900, phone: false },
];

for (const vp of VIEWPORTS) {
  test.describe(`discovery at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("/events: the brand h1, a grid of image-first cards, each with an orange Buy tickets", async ({ page }) => {
      await mockApi(page);
      await page.goto("/events");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("What’s on.");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

      const grid = page.getByRole("list", { name: "Events" });
      await expect(grid.getByRole("listitem")).toHaveCount(sampleEvents.length);
      // Two columns on phones, four on desktop.
      const columns = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(vp.phone ? 2 : 4);

      const quickBuys = grid.getByRole("link", { name: /^(?:Buy tickets|Get free tickets) for / });
      expect(await quickBuys.count()).toBeGreaterThanOrEqual(sampleEvents.length - 2);
      const first = quickBuys.first();
      await expect(first).toBeVisible();
      await expect(first).toHaveAttribute("href", /^\/events\/[^/]+#tickets$/);
      // Signal Orange with a black label, at least 44px tall on phones.
      const style = await first.evaluate((el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, color: s.color, height: el.getBoundingClientRect().height };
      });
      expect(style.bg).toBe("rgb(255, 72, 0)");
      expect(style.color).toBe("rgb(0, 0, 0)");
      expect(style.height).toBeGreaterThanOrEqual(vp.phone ? 44 : 40);

      await noSidewaysScroll(page);
    });

    test("/map: the brand h1, map first on phones, list rows with Buy tickets", async ({ page }) => {
      await mockApi(page);
      await page.goto("/map");
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveAccessibleName("Sheltüh near you.");
      await expect(h1).toContainText("NEAR Ü.", { ignoreCase: true });

      const group = page.getByRole("group", { name: "Show events as" });
      if (vp.phone) {
        await expect(group.getByRole("button").first()).toHaveAccessibleName("Map");
        await expect(group.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "true");
        // The map leaves page to scroll by: at most 60% of the screen's height.
        const mapBox = await page.locator(".leaflet-container").first().boundingBox();
        expect(mapBox?.height ?? 0).toBeLessThanOrEqual(vp.height * 0.6 + 1);
        await page.getByRole("button", { name: /^Show the list of \d+ events?$/ }).click();
        await expect(group.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
        await expect(page).toHaveURL(/[?&]view=list\b/);
      } else {
        await expect(group).toBeHidden();
      }

      const rowBuy = page.getByRole("link", { name: /^(?:Buy tickets|Get free tickets) for / }).first();
      await expect(rowBuy).toBeVisible();
      await expect(rowBuy).toHaveAttribute("href", /#tickets$/);
      await noSidewaysScroll(page);
    });

    test("/map?view=list opens the list", async ({ page }) => {
      test.skip(!vp.phone, "the view switch is for phones; both show from 1024px");
      await mockApi(page);
      await page.goto("/map?view=list");
      await expect(page.getByRole("group", { name: "Show events as" }).getByRole("button", { name: "List" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });
}

test.describe("discovery at 320×640", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const path of ["/events", "/map", "/login", "/no-such-page"]) {
    test(`${path}: no sideways scrolling`, async ({ page }) => {
      await mockApi(page);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path === "/events") await expect(page.getByRole("list", { name: "Events" }).getByRole("listitem").first()).toBeVisible();
      await noSidewaysScroll(page);
    });
  }
});
