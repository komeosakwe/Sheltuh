import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The phone home's two-column grids in a real browser (owner, 3 Nov 2026): under 640px each
 * home section is a grid of the /events cards, below the hero's h1 and the category row; from
 * 640px the rails are unchanged. The e2e server runs in live mode with every /api/* request
 * intercepted here, so the events are the sample events served as the live list API would,
 * re-timed relative to the real clock (two inside this weekend's window).
 */

const HOUR = 3600_000;

function fixtures(now: number): PublicEvent[] {
  const window = weekendWindow(new Date(now));
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

/** The list API (upcoming events); trending, following and "Recently on" have nothing. */
async function mockApi(page: Page, { fail = false }: { fail?: boolean } = {}) {
  const events = fixtures(Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/events") {
      if (fail) return route.fulfill({ status: 500, json: { error: "down" } });
      if (url.searchParams.get("recent") === "only") return route.fulfill({ json: { items: [], nextCursor: undefined } });
      return route.fulfill({ json: { items: events, nextCursor: undefined } });
    }
    // The event page a tapped card opens.
    const slug = /^\/api\/events\/slug\/([^/]+)$/.exec(url.pathname)?.[1];
    if (slug) {
      const event = events.find((e) => e.slug === decodeURIComponent(slug));
      return event ? route.fulfill({ json: event }) : route.fulfill({ status: 404, json: { error: "Event not found." } });
    }
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const vp of [
  { width: 375, height: 667 },
  { width: 320, height: 568 },
]) {
  test.describe(`the home's grids at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: true });

    test("the hero, then a section heading, then two cards side by side, each about half the width", async ({ page }) => {
      await mockApi(page);
      await page.goto("/");
      const section = page.locator("[data-home-section]").first();
      await expect(section).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const h1 = page.getByRole("heading", { level: 1 });
      const heading = section.getByRole("heading", { level: 2 });
      await expect(h1).toHaveCount(1);
      await expect(heading).toHaveText("This weekend");
      const cards = section.locator("[data-event-card]");
      // This weekend holds a few events whichever day the suite runs: the first two make the first row.
      expect(await cards.count()).toBeGreaterThanOrEqual(2);
      const [hero, head, a, b] = [await h1.boundingBox(), await heading.boundingBox(), await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
      if (!hero || !head || !a || !b) throw new Error("home not laid out");
      // In order down the page.
      expect(hero.y).toBeLessThan(head.y);
      expect(head.y + head.height).toBeLessThanOrEqual(a.y);
      // Two columns: side by side on one row, each about half the 16-20px-gutter column, 12px apart.
      expect(a.y).toBe(b.y);
      expect(b.x).toBeGreaterThan(a.x + a.width);
      expect(Math.round(b.x - (a.x + a.width))).toBe(12);
      const column = vp.width - 40;
      for (const card of [a, b]) {
        expect(card.width).toBeGreaterThan(column * 0.45);
        expect(card.width).toBeLessThan(column * 0.55);
      }
      expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
      await expect(page.locator("[data-rail-layout]")).toHaveCount(0);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });

    test("every section is a grid in the rails' order, titles are h2s, and the first row's photos load at once", async ({ page }) => {
      await mockApi(page);
      await page.goto("/");
      await expect(page.locator("[data-home-section]").first()).toBeVisible();
      const titles = await page.locator("[data-home-section]").getByRole("heading", { level: 2 }).allTextContents();
      expect(titles).toEqual(["This weekend", "Coming up"]);
      const columns = await page
        .locator("[data-home-section] ul")
        .evaluateAll((lists) => lists.map((ul) => getComputedStyle(ul).gridTemplateColumns.split(" ").length));
      expect(columns).toEqual([2, 2]);
      const loading = await page.locator("[data-home-section] [data-event-card]").evaluateAll((cards) =>
        cards.map((card) => card.querySelector("img")?.getAttribute("loading") ?? "none"),
      );
      expect(loading.slice(0, 2)).toEqual(["eager", "eager"]);
      expect(loading.slice(2).filter((l) => l === "eager")).toEqual([]);
      // 44px targets: Save, and the section links.
      const first = page.locator("[data-home-section] [data-event-card]").first();
      const save = await first.getByRole("link", { name: /^Sign in to save / }).boundingBox();
      expect(save?.width).toBeGreaterThanOrEqual(44);
      expect(save?.height).toBeGreaterThanOrEqual(44);
      expect((await page.locator("[data-home-section]").first().getByRole("link", { name: "All events" }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });

    test("tapping a card opens its event", async ({ page }) => {
      await mockApi(page);
      await page.goto("/");
      const card = page.locator("[data-home-section] [data-event-card]").first();
      await expect(card).toBeVisible();
      const href = await card.locator("[data-card-link]").getAttribute("href");
      const title = (await card.locator("h3").textContent())?.trim() ?? "";
      expect(href).toMatch(/^\/events\/[^/#?]+$/);
      // The picture, not the title: the whole card opens the event (the title's link stretches over it).
      const media = card.locator("[data-card-media]");
      await media.scrollIntoViewIfNeeded();
      const box = await media.boundingBox();
      if (!box) throw new Error("card not laid out");
      await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);
      await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title, { timeout: 30_000 });
    });

    test("the loading skeleton is two columns of placeholders, then the grids replace it", async ({ page }) => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const events = fixtures(Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/events") {
          await gate;
          return route.fulfill({ json: { items: url.searchParams.get("recent") === "only" ? [] : events, nextCursor: undefined } });
        }
        return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
      });
      await page.goto("/");
      const skeleton = page.locator("[data-home-grid-loading]");
      await expect(skeleton).toBeVisible();
      await expect(page.getByText("Loading events…")).toHaveCount(1);
      const [a, b] = [await skeleton.locator(".aspect-square").nth(0).boundingBox(), await skeleton.locator(".aspect-square").nth(1).boundingBox()];
      expect(a?.y).toBe(b?.y);
      expect(b?.x).toBeGreaterThan((a?.x ?? 0) + (a?.width ?? 0));
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      release();
      await expect(page.locator("[data-home-section]").first()).toBeVisible();
      await expect(skeleton).toHaveCount(0);
    });
  });
}

test.describe("the home at 1280×800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("keeps its rails of rail cards, with no grids", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator("[data-home-section]").first()).toBeVisible();
    await expect(page.locator("[data-home-grid]")).toHaveCount(0);
    await expect(page.locator("[data-rail-layout]").first()).toBeVisible();
    await expect(page.locator("[data-event-card][data-variant='grid']")).toHaveCount(0);
    expect(await page.locator("[data-home-section] [data-event-card][data-variant='rail']").count()).toBeGreaterThan(2);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
