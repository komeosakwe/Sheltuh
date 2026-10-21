import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The home page in a real browser (docs/design/home.md, owner decision 7:
 * the compact hero). The e2e server runs in live mode with every /api/*
 * request intercepted here, so the events are the demo sample events served
 * as the live list API would, re-timed relative to the real clock (so the
 * spec never goes stale), two of them inside this weekend's window.
 */

const HOUR = 3600_000;

function fixtures(now: number): PublicEvent[] {
  const window = weekendWindow(new Date(now));
  // Two events open during this weekend, whatever day the suite runs. Late on Sunday, when
  // there's no room left to start one, they're in progress (which still counts).
  const roomy = window.end - Math.max(window.start, now) > 4 * HOUR;
  const weekendSlots = roomy
    ? [Math.max(window.start, now) + HOUR, Math.max(window.start, now) + 2 * HOUR].map((s) => [s, s + HOUR])
    : [[now - HOUR, now + 3 * HOUR], [now - 2 * HOUR, now + 3 * HOUR]];
  return sampleEvents.map((event, i) => {
    const [start, end] =
      i < 2 ? weekendSlots[i] : [now + 30 * 60_000 + (i - 2) * 26 * HOUR, now + 30 * 60_000 + (i - 2) * 26 * HOUR + 3 * HOUR];
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
      endsAt: new Date(end).toISOString(),
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
  const events = fixtures(Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/events") {
      expect(url.searchParams.get("upcoming")).toBe("1");
      return route.fulfill({ json: { items: events, nextCursor: undefined } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

async function openHome(page: Page) {
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("[data-home-section]").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const VIEWPORTS = [
  { name: "desktop 1440×900", width: 1440, height: 900, phone: false },
  { name: "desktop 1280×800", width: 1280, height: 800, phone: false },
  { name: "phone 390×844", width: 390, height: 844, phone: true },
];

for (const vp of VIEWPORTS) {
  test.describe(`home at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("one h1, Up next, events visible without scrolling, each event once, no sideways scroll", async ({ page }) => {
      await openHome(page);

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Where is your Sheltüh?");

      const upNext = page.getByRole("region", { name: "Up next" });
      await expect(upNext).toBeVisible();
      const upNextCard = upNext.getByRole("link").first();
      const upNextTitle = upNext.getByRole("heading", { level: 3 });
      await expect(upNextTitle).toBeVisible();

      const fold = vp.height;
      const box = async (locator: ReturnType<Page["locator"]>) => {
        const b = await locator.boundingBox();
        if (!b) throw new Error("not rendered");
        return b;
      };

      // Up next's image (the card) and title are on screen without scrolling.
      expect((await box(upNextCard)).y).toBeLessThan(fold);
      expect((await box(upNextTitle)).y + (await box(upNextTitle)).height).toBeLessThanOrEqual(fold);

      const firstSection = page.locator("[data-home-section]").first();
      if (vp.phone) {
        // The next section's heading is visible too.
        const heading = firstSection.getByRole("heading", { level: 2 });
        const h = await box(heading);
        expect(h.y + h.height).toBeLessThanOrEqual(fold);
      } else {
        // The first section's first card starts above the fold.
        const firstCard = firstSection.getByRole("listitem").first();
        expect((await box(firstCard)).y).toBeLessThan(fold);
      }

      // Each event at most once across every section, Up next included.
      const hrefs = await page
        .locator("main a[href^='/events/']")
        .evaluateAll((links) =>
          links.map((a) => a.getAttribute("href") ?? "").filter((href) => /^\/events\/[^?#/]+$/.test(href)),
        );
      expect(hrefs.length).toBeGreaterThan(5);
      expect(new Set(hrefs).size).toBe(hrefs.length);

      // No horizontal overflow.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // Live mode: no trending API yet, so no Trending section (never made-up data).
      await expect(page.getByRole("heading", { name: "Trending" })).toHaveCount(0);
    });
  });
}

test.describe("the photo push-in", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("runs one cycle of 5s or less", async ({ page }) => {
    await openHome(page);
    const animation = await page.locator("img.ken-burns").first().evaluate((img) => {
      const style = getComputedStyle(img);
      return { name: style.animationName, count: style.animationIterationCount, duration: style.animationDuration };
    });
    expect(animation.name).toBe("push-in");
    expect(animation.count).toBe("1");
    expect(parseFloat(animation.duration)).toBeLessThanOrEqual(5);
  });

  test("is off under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    const names = await page
      .locator("img.ken-burns")
      .evaluateAll((imgs) => imgs.map((img) => getComputedStyle(img).animationName));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toBe("none");
  });
});

test("a card's Get tickets lands on the event page with focus on the tickets", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const events = fixtures(Date.now());
  await mockApi(page);
  await page.route("**/api/events/slug/**", (route) => {
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const event = events.find((e) => e.slug === slug);
    return event ? route.fulfill({ json: event }) : route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.goto("/");
  const section = page.locator("[data-home-section]").first();
  const quickBuy = section.getByRole("link", { name: /^Get (free )?tickets for / }).first();
  const href = await quickBuy.getAttribute("href");
  expect(href).toMatch(/^\/events\/[^/]+#tickets$/);
  await quickBuy.click();
  // The dev server compiles the event route on first visit, which can take a while under load.
  await expect(page).toHaveURL(/#tickets$/, { timeout: 30_000 });
  await expect(page.locator("#tickets")).toBeFocused({ timeout: 30_000 });
});
