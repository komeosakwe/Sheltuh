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
    name: "/community",
    path: "/community",
    // The events loaded: Local discovery's cards replace its placeholders (the city links show before that).
    ready: async (page) => {
      await expect(page.locator("[data-city='Melbourne']")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("list", { name: "Local discovery" }).locator("[data-event-card]").first()).toBeVisible({ timeout: 30_000 });
    },
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

    test("the h1, the proposal's one-line lede, then the search (beside them from 1280px), the page's only search, and no links", async ({ page }) => {
      await mockApi(page);
      await page.goto("/");
      const hero = page.getByRole("region", { name: "Find your next thing." });
      const h1 = hero.getByRole("heading", { level: 1 });
      await expect(h1).toHaveAccessibleName("Find your next thing.");
      await page.evaluate(() => document.fonts.ready);
      await expect(hero.getByText("Less scrolling. More going.")).toHaveCount(0);
      const lede = hero.getByText("Curated creative events. See who’s going.");
      await expect(lede).toBeVisible();
      const h1Box = await h1.boundingBox();
      const ledeBox = await lede.boundingBox();
      const searchBox = await hero.getByRole("search", { name: "Search events" }).boundingBox();
      if (!h1Box || !ledeBox || !searchBox) throw new Error("hero not laid out");
      expect(ledeBox.y).toBeGreaterThan(h1Box.y + h1Box.height - 1);
      // The lede is one line.
      expect(await lede.evaluate((p) => Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)))).toBe(1);
      if (width >= 1280) {
        // One row, as drawn: the search beside the headline.
        expect(searchBox.x).toBeGreaterThan(h1Box.x + h1Box.width);
        expect(searchBox.y).toBeLessThan(ledeBox.y + ledeBox.height);
      } else {
        expect(searchBox.y).toBeGreaterThan(ledeBox.y + ledeBox.height - 1);
      }
      // The hero's one orange button is the search submit; below 768px it's inside the search sheet.
      await expect(hero.locator(".btn-signal")).toHaveCount(1);
      if (width < 768) {
        await expect(hero.locator("[data-search-trigger]")).toHaveAccessibleName("Search events");
        await expect(hero.locator(".btn-signal")).toBeHidden();
      } else {
        await expect(hero.locator(".btn-signal")).toHaveAccessibleName("Search");
      }
      await expect(hero.getByRole("link")).toHaveCount(0);
      // One search on the home: no header field (desktop) or search icon (phones).
      await expect(page.getByRole("search")).toHaveCount(1);
      await expect(page.locator("header a[href='/search']")).toHaveCount(0);
      await expect(hero.getByRole("search").locator("svg:visible")).toHaveCount(width >= 768 ? 4 : 1);
      // No photos in the hero any more (the collage and the phone tile are gone).
      await expect(hero.locator("img, [data-hero-collage], [data-hero-thumb]")).toHaveCount(0);
      // FIND YOÜR / NEXT THING. is two lines at most at 100% text size (one where it fits).
      const lines = await h1.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
      expect(lines).toBeLessThanOrEqual(2);
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
    // The grids' sections and cards, and the sections below them.
    expect(opacities.length).toBeGreaterThan(2);
    for (const opacity of opacities) expect(opacity).toBe("1");
    // The sections below the fold are there, not blank: For organisers included.
    await expect(page.getByRole("region", { name: "Bring your event to life" })).toBeAttached();
    expect(await page.getByRole("region", { name: "Bring your event to life" }).evaluate((el) => getComputedStyle(el).opacity)).toBe(
      "1",
    );
  });
});

// This weekend (redesign PR 3): the one EventCard in a sideways row on phones, the grid from 640px.
for (const width of [375, 640, 1024]) {
  test.describe(`This weekend at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test(width < 640 ? "a sideways row of 288px cards from the page's edge, the next one peeking in, and a still page" : "a grid of cards, no sideways scrolling", async ({ page }) => {
      await mockApi(page);
      await page.goto("/");
      const list = page.getByRole("list", { name: "This weekend" });
      await expect(list.locator("[data-event-card]").first()).toBeVisible({ timeout: 30_000 });
      const style = await list.evaluate((ul) => ({ display: getComputedStyle(ul).display, overflowX: getComputedStyle(ul).overflowX }));
      if (width < 640) {
        expect(style).toEqual({ display: "flex", overflowX: "auto" });
        const first = await list.locator("li").first().boundingBox();
        if (!first) throw new Error("not laid out");
        expect(first.width).toBe(288);
        expect(first.x).toBe(16);
        // The page itself never moves sideways, even with the row scrolled to its end.
        await list.evaluate((ul) => ul.scrollTo({ left: ul.scrollWidth, behavior: "instant" }));
      } else {
        expect(style.display).toBe("grid");
      }
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("home first screen at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // The owner's 390 mock: the hero, the search, then the featured carousel's first slide, whole.
  test("shows the search, then the carousel's first slide with its title and actions", async ({ page }) => {
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
    const slide = page.locator("[data-featured-carousel] [data-slide][data-current]");
    await inView(slide);
    await inView(slide.getByRole("heading", { level: 3 }));
    await inView(slide.getByRole("link", { name: /^Details: / }));
  });

  test("the category chips scroll inside their own container, 48px tall, and the page doesn't move sideways", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const row = page.getByRole("group", { name: "Browse by category" }).getByRole("list");
    await expect(row).toBeVisible({ timeout: 30_000 });
    const scroller = await row.evaluate((ul) => ({ overflowX: getComputedStyle(ul).overflowX, scrolls: ul.scrollWidth > ul.clientWidth }));
    expect(scroller.overflowX).toBe("auto");
    expect(scroller.scrolls).toBe(true);
    for (const chip of await row.getByRole("button").all()) {
      expect((await chip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    }
    await row.evaluate((ul) => ul.scrollTo({ left: ul.scrollWidth, behavior: "instant" }));
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    await expect(row.getByRole("button", { name: "Free" })).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("footer on a phone (375px)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("every column's links are visible at once, stacked, 48px tall, with the legal links and no sideways scroll", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator("[data-home-section]").first()).toBeVisible({ timeout: 30_000 });
    const footer = page.locator("footer");
    // No disclosures any more (redesign PR 2, the proposal's footer): everything shows.
    await expect(footer.getByRole("button", { name: "Explore" })).toHaveCount(0);
    for (const name of ["Help & FAQs", "Contact support", "All events", "Nearby", "For organisers", "About Sheltüh", "Become a partner"]) {
      const link = footer.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      expect(Math.round((await link.boundingBox())?.height ?? 0), name).toBeGreaterThanOrEqual(48);
    }
    await expect(footer.getByRole("link", { name: "Email support@sheltuh.com.au" })).toBeVisible();
    await expect(footer.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy Policy" })).toBeVisible();
    // Stacked below 640px (the rules' Layout board): Explore under Fan support, the socials last.
    const [support, explore, contact] = [
      await footer.getByRole("navigation", { name: "Fan support" }).boundingBox(),
      await footer.getByRole("navigation", { name: "Explore" }).boundingBox(),
      await footer.getByRole("navigation", { name: "Contact Sheltüh" }).boundingBox(),
    ];
    if (!support || !explore || !contact) throw new Error("footer not laid out");
    expect(Math.round(explore.x)).toBe(Math.round(support.x));
    expect(explore.y).toBeGreaterThan(support.y + support.height - 1);
    expect(contact.y).toBeGreaterThan(explore.y);
    // A visible focus ring on a footer link.
    const help = footer.getByRole("link", { name: "Help & FAQs" });
    await help.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(help).toBeFocused();
    expect(await help.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
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

// Community is its own page (redesign PR 3): the nav goes there from the desktop row and from the
// phone menu once it has closed, and marks it as the current page.
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`Community in the nav at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("opens /community, its h1 in view, with Community marked as the current page", async ({ page }) => {
      await mockApi(page);
      await page.goto("/");
      await expect(page.locator("[data-home-section]").first()).toBeVisible({ timeout: 30_000 });
      if (viewport.width < 1024) {
        const menu = page.locator("#site-menu");
        await expect(async () => {
          if (!(await menu.isVisible())) await page.getByRole("button", { name: "Menu" }).click();
          await expect(menu).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 30_000 });
        await page.getByRole("navigation", { name: "Site menu" }).getByRole("link", { name: "Community" }).click();
        await expect(menu).toBeHidden();
      } else {
        await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Community" }).click();
      }
      await expect(page).toHaveURL(/\/community$/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Find your people.", { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
      if (viewport.width >= 1024) {
        await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Community" })).toHaveAttribute("aria-current", "page");
      }
    });
  });
}
