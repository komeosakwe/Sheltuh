import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The responsive audit (docs/design/mobile-redesign.md §8) in a real
 * browser: no sideways scroll at any width on the home, /events and an event
 * page, with nothing in globals.css hiding it (body has no overflow-x:
 * hidden); nothing on the home hidden at load; the hero's copy and its one
 * orange action; the rails' end gutter; the event page's buy bar settling
 * below the tickets. Live mode, with every /api/* request answered here from
 * the demo samples re-timed to the real clock, so the spec never goes stale.
 */

const HOUR = 3600_000;
const WIDTHS = [320, 375, 390, 430, 768, 1280];
/** A Sheltüh-ticketed, paid sample event, for the event page. */
const EVENT_SLUG = "fitzroy-poetry-and-noise";

function fixtures(now: number): PublicEvent[] {
  const window = weekendWindow(new Date(now));
  // Two events open this weekend, whatever day it runs (in progress late on a Sunday).
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
    if (url.pathname === "/api/events") return route.fulfill({ json: { items: events, nextCursor: undefined } });
    const slug = /^\/api\/events\/slug\/([^/]+)$/.exec(url.pathname)?.[1];
    if (slug) {
      const event = events.find((e) => e.slug === decodeURIComponent(slug));
      return event ? route.fulfill({ json: event }) : route.fulfill({ status: 404, json: { error: "Event not found." } });
    }
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    if (/\/going(\/|$)/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

const PAGES: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  {
    name: "home",
    path: "/",
    ready: (page) => expect(page.locator("[data-home-section]").first()).toBeVisible({ timeout: 30_000 }),
  },
  {
    name: "/events",
    path: "/events",
    ready: (page) =>
      expect(page.getByRole("list", { name: "Events" }).getByRole("listitem").first()).toBeVisible({ timeout: 30_000 }),
  },
  {
    name: "an event page",
    path: `/events/${EVENT_SLUG}`,
    ready: (page) => expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 }),
  },
];

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("globals.css no longer hides sideways overflow on the body", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowX)).toBe("visible");
});

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 800 : 900 } });

    for (const target of PAGES) {
      test(`${target.name}: no horizontal overflow`, async ({ page }) => {
        await mockApi(page);
        await page.goto(target.path);
        await target.ready(page);
        await page.evaluate(() => document.fonts.ready);
        expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
        // And at the very end of the page (the footer, the buy bar settled).
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
      });
    }
  });
}

for (const width of [375, 1280]) {
  test.describe(`home hero at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("the brief's copy and one orange action", async ({ page }) => {
      await mockApi(page);
      await page.goto("/");
      const hero = page.getByRole("region", { name: "Find your next thing." });
      await expect(hero.getByRole("heading", { level: 1 })).toHaveAccessibleName("Find your next thing.");
      await expect(hero.getByText("Melbourne • What’s on")).toBeVisible();
      await expect(
        hero.getByText("Discover Melbourne’s music, art, workshops and pop-ups. See who’s going before you book."),
      ).toBeVisible();
      // One primary CTA: the hero's only orange button, and its only link.
      const orange = hero.locator(".btn-signal");
      await expect(orange).toHaveCount(1);
      await expect(orange).toHaveAccessibleName("Explore events");
      await expect(orange).toHaveAttribute("href", "/events");
      await expect(hero.getByRole("link")).toHaveCount(1);
      // The h1 is two lines at 100% text size, never more.
      const lines = await hero.getByRole("heading", { level: 1 }).evaluate((h1) => {
        const lineHeight = parseFloat(getComputedStyle(h1).lineHeight);
        return Math.round(h1.getBoundingClientRect().height / lineHeight);
      });
      expect(lines).toBe(2);
    });
  });
}

test.describe("home at 375px, without scrolling", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("nothing is hidden at load: every section and card is fully opaque, and nothing waits for a scroll", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator("[data-home-section]").first()).toBeVisible({ timeout: 30_000 });
    expect(await page.locator("main .reveal-pending, main [data-reveal], main [data-reveal-stagger]").count()).toBe(0);
    const opacities = await page
      .locator("main section, main [data-event-card]")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
    expect(opacities.length).toBeGreaterThan(8);
    for (const opacity of opacities) expect(opacity).toBe("1");
    // The sections below the fold are there, not blank: For organisers included.
    await expect(page.getByRole("region", { name: "Bring your event to life" })).toBeAttached();
    expect(await page.getByRole("region", { name: "Bring your event to life" }).evaluate((el) => getComputedStyle(el).opacity)).toBe(
      "1",
    );
  });

  test("a rail scrolled to its end leaves its last card 20px or more from the screen's edge", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const rail = page.locator("[data-home-section] ul").filter({ has: page.locator("[data-event-card]") }).last();
    await expect(rail).toBeVisible({ timeout: 30_000 });
    await rail.evaluate((ul) => {
      ul.scrollLeft = ul.scrollWidth;
    });
    const right = await rail.locator("[data-event-card]").last().evaluate((card) => card.getBoundingClientRect().right);
    expect(375 - right).toBeGreaterThanOrEqual(20 - 0.5);
  });
});

test.describe("event page at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the buy bar settles below the Tickets panel at the end of the page", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${EVENT_SLUG}`);
    const bar = page.locator("[data-buy-bar]");
    await expect(bar).toBeVisible({ timeout: 30_000 });
    // Who's Going settles first, so the page's height is final.
    await expect(page.getByText("Loading who’s going…")).toHaveCount(0);
    await expect
      .poll(async () => {
        // Instant: html is smooth-scrolling, which would leave a measurement mid-way.
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        const tickets = await page.locator("#tickets").boundingBox();
        const barBox = await bar.boundingBox();
        if (!tickets || !barBox) return "not rendered";
        return barBox.y >= tickets.y + tickets.height - 0.5 ? "below the tickets" : `bar ${barBox.y}, tickets end ${tickets.y + tickets.height}`;
      })
      .toBe("below the tickets");
  });
});
