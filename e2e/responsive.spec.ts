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
const WIDTHS = [320, 375, 390, 430, 768, 1280, 1440];
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

for (const width of [375, 390, 768, 1280, 1440]) {
  test.describe(`home hero at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("short copy, search as the main action, the page's only search, and no orange button", async ({ page }) => {
      await mockApi(page);
      await page.goto("/");
      const hero = page.getByRole("region", { name: "Find your next thing." });
      await expect(hero.getByRole("heading", { level: 1 })).toHaveAccessibleName("Find your next thing.");
      await expect(hero.getByText("Less scrolling. More going.")).toBeVisible();
      // No intro sentence (owner, 28 Oct 2026, less helper text): the search follows the headline.
      await expect(hero.getByText("Music, art and pop-ups")).toHaveCount(0);
      const h1Box = await hero.getByRole("heading", { level: 1 }).boundingBox();
      const searchBox = await hero.getByRole("search", { name: "Search events" }).boundingBox();
      if (!h1Box || !searchBox) throw new Error("hero not laid out");
      expect(searchBox.y).toBeGreaterThan(h1Box.y + h1Box.height - 1);
      await expect(hero.getByRole("search", { name: "Search events" })).toBeVisible();
      // Owner round of 24 Oct 2026 (the Eventbrite-style bar): the hero's one orange button is the search submit.
      await expect(hero.locator(".btn-signal")).toHaveCount(1);
      await expect(hero.locator(".btn-signal")).toHaveAccessibleName("Search");
      // Refinement (22 Oct 2026): browsing is the category row under the hero; the hero has no links.
      await expect(hero.getByRole("link")).toHaveCount(0);
      // One search on the home: no header field (desktop) or search icon (phones), and the hero's bar
      // has two icons, the location pin and one magnifier (its submit button; owner round of 24 Oct 2026).
      await expect(page.getByRole("search")).toHaveCount(1);
      await expect(page.locator("header a[href='/search']")).toHaveCount(0);
      await expect(hero.getByRole("search").locator("svg")).toHaveCount(2);
      await expect(hero.getByRole("search").getByRole("button", { name: "Search" }).locator("svg")).toHaveCount(1);
      // The h1 is two lines at 100% text size, never more.
      const lines = await hero.getByRole("heading", { level: 1 }).evaluate((h1) => {
        const lineHeight = parseFloat(getComputedStyle(h1).lineHeight);
        return Math.round(h1.getBoundingClientRect().height / lineHeight);
      });
      expect(lines).toBe(2);
    });
  });
}

// Owner (24 Oct 2026, the phone hero's empty space): "little image should be there". Below 1024px the
// collage's lead photo is a small tile beside the eyebrow and the h1; from 1024px the collage instead.
const THUMB_SIZES: Record<number, number | null> = { 320: 72, 375: 88, 390: 88, 768: 112, 1024: null, 1440: null };
for (const [width, size] of Object.entries(THUMB_SIZES).map(([w, s]) => [Number(w), s] as const)) {
  test.describe(`home hero thumbnail at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 844 : 900 } });

    test(size ? "a small decorative photo beside the headline, which keeps its two lines" : "no thumbnail: the collage shows", async ({ page }) => {
      await mockApi(page);
      await page.goto("/");
      const hero = page.getByRole("region", { name: "Find your next thing." });
      const h1 = hero.getByRole("heading", { level: 1 });
      await expect(h1).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const thumb = hero.locator("[data-hero-thumb]");
      const collage = hero.locator("[data-hero-collage]");

      if (!size) {
        await expect(thumb).toBeHidden();
        await expect(collage).toBeVisible();
        return;
      }

      await expect(thumb).toBeVisible();
      await expect(collage).toBeHidden();
      await expect(thumb).toHaveAttribute("aria-hidden", "true");
      const img = thumb.locator("img");
      await expect(img).toHaveAttribute("src", "/events/gallery-opening.jpg");
      await expect(img).toHaveAttribute("alt", "");
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      // Its badge is still and never a control (too small for a 44px Pause/Play target).
      await expect(page.getByRole("button", { name: /badge animation/ })).toHaveCount(0);
      expect(await thumb.locator("[data-hero-badge-art]").evaluate((svg) => getComputedStyle(svg).animationName)).toBe("none");

      const t = await thumb.boundingBox();
      const h = await h1.boundingBox();
      if (!t || !h) throw new Error("hero not laid out");
      expect(Math.round(t.width)).toBe(size);
      expect(Math.round(t.height)).toBe(size);
      // Top right of the column, no taller than the eyebrow and the h1, so the hero is no taller.
      const gutter = width < 640 ? 20 : 32;
      expect(Math.round(t.x + t.width)).toBe(width - gutter);
      expect(t.y + t.height).toBeLessThanOrEqual(h.y + h.height + 0.5);
      const badgeRight = await thumb.locator("[data-hero-badge]").evaluate((el) => el.getBoundingClientRect().right);
      expect(badgeRight).toBeLessThanOrEqual(width);
      // The h1 keeps its two lines, each clear of the tile.
      const layout = await h1.evaluate((el) => {
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
        const rights = [...el.querySelectorAll(":scope > span")].map((line) => {
          const range = document.createRange();
          range.selectNodeContents(line);
          return Math.max(...[...range.getClientRects()].map((r) => r.right));
        });
        return { lines: Math.round(el.getBoundingClientRect().height / lineHeight), rights };
      });
      expect(layout.lines).toBe(2);
      for (const right of layout.rights) expect(right).toBeLessThan(t.x);
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
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
    // A still rail: the auto-scroll (e2e/home-autoscroll.spec.ts) would loop it back to the start.
    await page.emulateMedia({ reducedMotion: "reduce" });
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

// Owner feedback (22 Oct 2026), the top priority: rails behave as carousels on every phone width.
for (const width of [320, 375, 390, 430]) {
  test.describe(`home rails at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("snap to each card's start at the page gutter, show the next card, never move up and down, and keep the page still", async ({ page }) => {
      // A still rail, with its own snapping: the auto-scroll's drift turns snapping off and moves it
      // from the first frame on screen (e2e/home-autoscroll.spec.ts covers that).
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mockApi(page);
      await page.goto("/");
      // A rail with at least three cards, so it can scroll a whole card's width. Late on a
      // Sunday (Melbourne) "This weekend" holds only two, which can't.
      const rail = page
        .locator("[data-home-section] ul")
        .filter({ has: page.locator("li:nth-of-type(3) [data-event-card]") })
        .first();
      await expect(rail).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);

      const style = await rail.evaluate((ul) => {
        const s = getComputedStyle(ul);
        const first = ul.querySelector("li");
        return {
          snapType: s.scrollSnapType,
          snapAlign: first ? getComputedStyle(first).scrollSnapAlign : "",
          overflowX: s.overflowX,
          overflowY: s.overflowY,
          // Nothing to scroll vertically inside the rail: no jitter on a diagonal swipe.
          verticalSlack: ul.scrollHeight - ul.clientHeight,
        };
      });
      expect(style.snapType).toMatch(/^x mandatory/);
      expect(style.snapAlign).toMatch(/start/);
      expect(style.overflowX).toBe("auto");
      expect(style.overflowY).toBe("hidden");
      expect(style.verticalSlack).toBeLessThanOrEqual(0);

      // The first card starts on the page gutter (20px), like the heading above it.
      const cards = rail.locator("[data-event-card]");
      const heading = await page.locator("[data-home-section]").first().getByRole("heading", { level: 2 }).boundingBox();
      const first = await cards.nth(0).boundingBox();
      const second = await cards.nth(1).boundingBox();
      if (!first || !second || !heading) throw new Error("rail not laid out");
      expect(Math.round(first.x)).toBe(20);
      expect(Math.abs(first.x - heading.x)).toBeLessThanOrEqual(1);
      // The next card peeks in: some of it is on screen, not all.
      expect(second.x).toBeLessThan(width);
      expect(second.x + second.width).toBeGreaterThan(width);
      // Every card in the rail is the same height (equal-height cards: the prices and buttons line up).
      const heights = await cards.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
      expect(new Set(heights).size).toBe(1);

      // Scrolling most of the way to the next card settles with it on the gutter (start-aligned snap),
      // and the page never scrolls sideways.
      const step = second.x - first.x;
      await rail.evaluate((ul, left) => ul.scrollTo({ left, behavior: "instant" }), step - 30);
      await expect
        .poll(async () => Math.round((await cards.nth(1).boundingBox())?.x ?? -1))
        .toBe(20);
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
}

// Owner (23 Oct 2026): "keep using the horizontal scrolling". From 640px too, the rails scroll sideways:
// fixed 256px cards from the page column's edge, running off the right edge, with Previous/Next buttons.
for (const width of [390, 768, 1280, 1440]) {
  test.describe(`home rails at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 844 : 900 } });

    test("scroll sideways from the column's edge, with fixed-width cards, a peek, working arrows, and a still page", async ({ page }) => {
      test.skip(width < 640, "the 640px-and-up rail (the phone rails are checked above)");
      // A still rail, so the positions measured below hold: the auto-scroll is e2e/home-autoscroll.spec.ts's.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mockApi(page);
      await page.goto("/");
      const section = page.locator("[data-home-section]").filter({ has: page.getByRole("heading", { name: "Coming up", exact: true }) });
      const rail = section.getByRole("list");
      await expect(rail).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);

      const style = await rail.evaluate((ul) => {
        const s = getComputedStyle(ul);
        return { snapType: s.scrollSnapType, overflowX: s.overflowX, overflowY: s.overflowY, display: s.display, scrolls: ul.scrollWidth > ul.clientWidth };
      });
      expect(style.display).toBe("flex");
      expect(style.snapType).toMatch(/^x mandatory/);
      expect(style.overflowX).toBe("auto");
      expect(style.overflowY).toBe("hidden");
      expect(style.scrolls).toBe(true);

      // The rail runs edge to edge; its first card starts level with the section's heading.
      const railBox = await rail.boundingBox();
      const heading = await section.getByRole("heading", { level: 2 }).boundingBox();
      const cards = rail.locator("[data-event-card]");
      const first = await cards.first().boundingBox();
      if (!railBox || !heading || !first) throw new Error("rail not laid out");
      expect(Math.round(railBox.x)).toBe(0);
      expect(Math.round(railBox.width)).toBe(width);
      expect(Math.abs(first.x - heading.x)).toBeLessThanOrEqual(1);
      const inset = width >= 1152 ? (width - 1152) / 2 + 32 : 32;
      expect(Math.round(first.x)).toBe(inset);

      // Fixed-width cards (not stretched), all the same height, so prices and buttons line up.
      const sizes = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ w: Math.round(r.width), h: Math.round(r.height), x: r.x })));
      expect(new Set(sizes.map((size) => size.w))).toEqual(new Set([256]));
      expect(new Set(sizes.map((size) => size.h)).size).toBe(1);
      // A card is cut by the right edge: there's more.
      expect(sizes.some((size) => size.x < width && size.x + size.w > width)).toBe(true);
      const prices = await cards.evaluateAll((els) => els.map((el) => Math.round(el.querySelector("[id$='-price']")?.getBoundingClientRect().top ?? -1)));
      expect(new Set(prices).size).toBe(1);

      // Previous is disabled at the start (still focusable); Next pages so the peeking card lands on the inset line.
      const prev = section.getByRole("button", { name: "Previous events: Coming up" });
      const next = section.getByRole("button", { name: "Next events: Coming up" });
      await expect(prev).toHaveAttribute("aria-disabled", "true");
      await expect(next).toHaveAttribute("aria-disabled", "false");
      // (Unless the rail's end comes first: then it stops there.)
      const peeking = sizes.findIndex((size) => size.x + size.w > width);
      const max = await rail.evaluate((ul) => ul.scrollWidth - ul.clientWidth);
      const landing = Math.round(sizes[peeking].x - Math.min(sizes[peeking].x - inset, max));
      await next.focus();
      await page.keyboard.press("Enter");
      await expect.poll(async () => Math.round((await cards.nth(peeking).boundingBox())?.x ?? -1)).toBe(landing);
      await expect(prev).toHaveAttribute("aria-disabled", "false");
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

      // Scrolled to the end, the last card ends on the page column's right edge, and Next is disabled.
      await rail.evaluate((ul) => ul.scrollTo({ left: ul.scrollWidth, behavior: "instant" }));
      await expect(next).toHaveAttribute("aria-disabled", "true");
      const last = await cards.last().boundingBox();
      expect(Math.abs(width - inset - ((last?.x ?? 0) + (last?.width ?? 0)))).toBeLessThanOrEqual(1);
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    });

    // Owner (23 Oct 2026, layout polish): a rail of one or two cards left most of a desktop row empty. From
    // 1024px it's a two-column grid in the page column with landscape images; below, the same carousel.
    test(`a rail of two is ${width >= 1024 ? "a two-column grid of wide, landscape cards" : "a carousel of fixed cards"}`, async ({ page }) => {
      const two = fixtures(Date.now()).slice(0, 2);
      await page.route("**/api/**", (route) =>
        new URL(route.request().url()).pathname === "/api/events"
          ? route.fulfill({ json: { items: two, nextCursor: undefined } })
          : route.fulfill({ status: 404, json: { error: "not mocked in e2e" } }),
      );
      await page.goto("/");
      const weekend = page.getByRole("region", { name: "This weekend" });
      const cards = weekend.locator("[data-event-card]");
      await expect(cards).toHaveCount(2, { timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      const list = weekend.getByRole("list");
      await expect(list).toHaveAttribute("data-rail-layout", "pair");
      const layout = await list.evaluate((ul) => ({ display: getComputedStyle(ul).display, columns: getComputedStyle(ul).gridTemplateColumns }));
      const boxes = await cards.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          const media = el.querySelector("[data-card-media]")?.getBoundingClientRect();
          const top = (sel: string) => Math.round(el.querySelector(sel)?.getBoundingClientRect().top ?? -1);
          return { x: r.x, w: r.width, h: Math.round(r.height), mw: media?.width ?? 0, mh: media?.height ?? 0, price: top("[id$='-price']"), cta: top("[data-card-foot] > :nth-child(2)") };
        }),
      );
      const heading = await weekend.getByRole("heading", { level: 2 }).boundingBox();
      if (!heading) throw new Error("not laid out");
      const inset = width < 640 ? 20 : width >= 1152 ? (width - 1152) / 2 + 32 : 32;
      expect(Math.abs(boxes[0].x - heading.x)).toBeLessThanOrEqual(1);
      if (width >= 1024) {
        expect(layout.display).toBe("grid");
        expect(layout.columns.split(" ")).toHaveLength(2);
        // The two columns fill the page column, edge to edge, 24px apart.
        const column = Math.min(width, 1152) - 64;
        for (const box of boxes) expect(Math.abs(box.w - (column - 24) / 2)).toBeLessThanOrEqual(1);
        expect(Math.abs(boxes[1].x + boxes[1].w - (width - inset))).toBeLessThanOrEqual(1);
        // Wide landscape strips (owner, 23 Oct 2026: "the pictures still way too big"): 12:5 and never
        // taller than 200px (wider than 12:5 where the cap bites), full column width.
        for (const box of boxes) {
          expect(box.mh).toBeLessThanOrEqual(200 + 0.5);
          expect(box.mw / box.mh).toBeGreaterThanOrEqual(12 / 5 - 0.02);
          expect(Math.abs(box.mw - box.w)).toBeLessThanOrEqual(1);
        }
      } else if (width >= 640) {
        expect(layout.display).toBe("flex");
        for (const box of boxes) expect(Math.round(box.w)).toBe(256);
      } else {
        // Phones: the carousel, with the second card peeking in at the right edge, scrolling sideways.
        expect(layout.display).toBe("flex");
        expect(boxes[1].x).toBeLessThan(width);
        expect(boxes[1].x + boxes[1].w).toBeGreaterThan(width);
        expect(await list.evaluate((ul) => ul.scrollWidth > ul.clientWidth)).toBe(true);
        await list.evaluate((ul) => ul.scrollTo({ left: ul.scrollWidth, behavior: "instant" }));
        await expect.poll(async () => Math.round((await cards.nth(1).boundingBox())?.x ?? -1)).toBeLessThan(width - boxes[1].w);
      }
      // Equal heights, and the prices and buttons on one line across the pair.
      expect(boxes[0].h).toBe(boxes[1].h);
      expect(boxes[0].price).toBe(boxes[1].price);
      expect(boxes[0].cta).toBe(boxes[1].cta);
      // Nothing invented to fill the row, no arrows, and the page doesn't move sideways.
      await expect(page.locator("main [data-event-card]")).toHaveCount(2);
      await expect(weekend.getByRole("button", { name: /events: This weekend/ })).toHaveCount(0);
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("a rail that fits has no arrows (two cards), and every rail has them exactly when it overflows", async ({ page }) => {
      test.skip(width < 640, "the 640px-and-up rail (the phone rails are checked above)");
      // Only the two weekend events: This weekend's rail of two fits at every width from 640px.
      const two = fixtures(Date.now()).slice(0, 2);
      await page.route("**/api/**", (route) =>
        new URL(route.request().url()).pathname === "/api/events"
          ? route.fulfill({ json: { items: two, nextCursor: undefined } })
          : route.fulfill({ status: 404, json: { error: "not mocked in e2e" } }),
      );
      await page.goto("/");
      const weekend = page.getByRole("region", { name: "This weekend" });
      await expect(weekend.locator("[data-event-card]")).toHaveCount(2, { timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      await expect(weekend.getByRole("button", { name: /events: This weekend/ })).toHaveCount(0);
      expect(await weekend.getByRole("list").evaluate((ul) => ul.scrollWidth > ul.clientWidth)).toBe(false);

      // The full sample: whatever the day's split, arrows show exactly on the rails that overflow.
      await page.unrouteAll();
      await mockApi(page);
      await page.reload();
      await expect(page.locator("[data-home-section] [data-event-card]").first()).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      for (const section of await page.locator("[data-home-section]").all()) {
        const list = section.getByRole("list");
        if ((await list.count()) === 0) continue;
        const overflows = await list.evaluate((ul) => ul.scrollWidth > ul.clientWidth + 4);
        await expect(section.getByRole("button", { name: /^(?:Previous|Next) events: / })).toHaveCount(overflows ? 2 : 0);
      }
    });
  });
}

test.describe("home first screen at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Refinement (owner, 22 Oct 2026): the first event's image and title on a typical phone's first screen.
  test("shows the search, the category row, then This weekend's heading and its first card's image and title", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator("[data-home-section]").first()).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    const inView = async (locator: ReturnType<Page["locator"]>) => {
      const b = await locator.boundingBox();
      if (!b) throw new Error("not rendered");
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(844);
    };
    await inView(page.getByRole("search", { name: "Search events" }));
    await inView(page.getByRole("navigation", { name: "Browse by category" }).getByRole("link").first());
    const weekend = page.getByRole("region", { name: "This weekend" });
    await inView(weekend.getByRole("heading", { level: 2 }));
    const card = weekend.locator("[data-event-card]").first();
    await inView(card.locator("[data-card-media]"));
    await inView(card.getByRole("heading", { level: 3 }));
  });

  test("the category row scrolls inside its own container with 44px chips, and the page doesn't move sideways", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const row = page.getByRole("navigation", { name: "Browse by category" }).getByRole("list");
    await expect(row).toBeVisible({ timeout: 30_000 });
    const scroller = await row.evaluate((ul) => ({ overflowX: getComputedStyle(ul).overflowX, scrolls: ul.scrollWidth > ul.clientWidth }));
    expect(scroller.overflowX).toBe("auto");
    expect(scroller.scrolls).toBe(true);
    for (const link of await row.getByRole("link").all()) {
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await row.evaluate((ul) => ul.scrollTo({ left: ul.scrollWidth, behavior: "instant" }));
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    await expect(row.getByRole("link", { name: "Free" })).toHaveAttribute("href", "/events?pricing=free");
  });
});

test.describe("footer on a phone (375px)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("support and legal links are visible; Explore and Our company open and close from the keyboard", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator("[data-home-section]").first()).toBeVisible({ timeout: 30_000 });
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Help & FAQs" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Contact support" })).toBeVisible();
    await expect(footer.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy Policy" })).toBeVisible();
    const toggle = footer.getByRole("button", { name: "Explore" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(footer.getByRole("link", { name: "All events" })).toBeHidden();
    // Tab onto it from the last support link, as a keyboard user would.
    await footer.getByRole("link", { name: "Contact support" }).focus();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(footer.getByRole("link", { name: "All events" })).toBeVisible();
    // The next Tab goes into the opened group.
    await page.keyboard.press("Tab");
    await expect(footer.getByRole("link", { name: "All events" })).toBeFocused();
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(footer.getByRole("link", { name: "All events" })).toBeHidden();
    // A visible focus ring on the toggle.
    expect(await toggle.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  });
});

test.describe("event page at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // WCAG 2.4.11 (focus not obscured): the sticky buy bar never covers what has keyboard focus.
  test("the sticky buy bar never covers a control focused by keyboard", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${EVENT_SLUG}`);
    const bar = page.locator("[data-buy-bar]");
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Loading who’s going…")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    let checked = 0;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      // The page scrolls smoothly to the focused control: measure once it has settled.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let last = -1;
            let still = 0;
            const tick = () => {
              const y = window.scrollY;
              if (y === last) still += 1;
              else {
                still = 0;
                last = y;
              }
              if (still >= 5) resolve();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
      );
      const result = await page.evaluate(() => {
        const el = document.activeElement;
        const barEl = document.querySelector("[data-buy-bar]");
        if (!(el instanceof HTMLElement) || !barEl || barEl.contains(el) || !el.closest("main")) return null;
        const box = el.getBoundingClientRect();
        if (box.height === 0) return null;
        return { name: el.textContent?.trim().slice(0, 40) ?? el.tagName, bottom: box.bottom, barTop: barEl.getBoundingClientRect().top };
      });
      if (!result) continue;
      checked += 1;
      expect(result.bottom, `"${result.name}" is under the buy bar`).toBeLessThanOrEqual(result.barTop + 0.5);
    }
    expect(checked).toBeGreaterThan(5);
  });

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
