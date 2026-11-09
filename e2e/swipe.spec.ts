import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The /swipe feed (and that the phone home no longer links to it) in a real browser. The e2e server runs in live mode with every /api/* request
 * intercepted here, so the events are the sample events served as the live list
 * API would, re-timed relative to the real clock (two inside this weekend's
 * window), as e2e/home.spec.ts does.
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
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The article that fills the feed's visible screen: its box overlaps the middle of the viewport. */
async function visibleTitle(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const middle = window.innerHeight / 2;
    for (const article of document.querySelectorAll("main article")) {
      const box = article.getBoundingClientRect();
      if (box.top <= middle && box.bottom > middle) return article.getAttribute("aria-label");
    }
    return null;
  });
}

test.describe("on a phone (375×667)", () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });

  test("the home shows its sections as grids of cards (This weekend's rail aside), with no event screens and no link to /swipe", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator("[data-home-section]").first()).toBeVisible();
    await expect(page.locator("[data-home-grid]").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByText("Swipe through events")).toHaveCount(0);
    await expect(page.getByRole("article")).toHaveCount(0);
    // The one rail is This weekend's (owner's mockup, 8 Nov 2026: a sideways row on phones too).
    await expect(page.locator("[data-rail-layout]")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "This weekend" }).locator("[data-rail-layout]")).toHaveCount(1);
    await expect(page.locator("a[href='/swipe']")).toHaveCount(0);
    // No snapping: the page scrolls freely.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType)).toBe("none");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("an events error shows Try again, not the grids or the rails", async ({ page }) => {
    await mockApi(page, { fail: true });
    await page.goto("/");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t load events");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.locator("[data-home-grid]")).toHaveCount(0);
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.locator("[data-home-section]")).toHaveCount(0);
  });


  test("growing the window to desktop width swaps the grids for the rails", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator("[data-home-grid]").first()).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator("[data-rail-layout]").first()).toBeVisible();
    await expect(page.locator("[data-home-grid]")).toHaveCount(0);
  });

  test("/swipe still opens on the first event; a screen down is the second; Close goes home", async ({ page }) => {
    await mockApi(page);
    await page.goto("/swipe");
    await expect(page).toHaveTitle("Swipe events | Sheltüh");

    // A full-screen page: no site header or footer, one main with a hidden h1.
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeAttached();

    const articles = page.getByRole("article");
    await expect(articles.first()).toBeVisible();
    const count = await articles.count();
    expect(count).toBeGreaterThan(2);
    const first = (await articles.nth(0).getAttribute("aria-label")) ?? "";
    const second = (await articles.nth(1).getAttribute("aria-label")) ?? "";
    expect(first).not.toBe(second);
    expect(await visibleTitle(page)).toBe(first);

    // One event a screen: the first screen's content.
    const screenOne = articles.nth(0);
    await expect(screenOne.getByRole("heading", { level: 2, name: first })).toBeInViewport();
    await expect(screenOne.getByRole("link", { name: "View event" })).toHaveAttribute("href", /^\/events\/[^/?#]+$/);
    // Signed out (live mode), Save is the link that signs in and comes back to save.
    await expect(screenOne.getByRole("link", { name: `Sign in to save ${first}` })).toBeVisible();
    await expect(page.locator("[data-swipe-hint]")).toBeVisible();
    await expect(page.locator("[data-swipe-hint]")).toHaveText("Swipe up");
    const box = await screenOne.boundingBox();
    expect(box?.height).toBe(667);
    expect(box?.width).toBe(375);
    // Tall enough for a whole event: the snap is mandatory.
    expect(await page.getByRole("main").evaluate((el) => getComputedStyle(el).scrollSnapType)).toBe("y mandatory");

    // The Close target is 44px.
    const close = page.getByRole("link", { name: "Close, back to home" });
    const closeBox = await close.boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height).toBeGreaterThanOrEqual(44);

    // Scroll one screen down: the second event.
    await page.getByRole("main").evaluate((el) => el.scrollBy({ top: el.clientHeight, behavior: "instant" }));
    await expect.poll(() => visibleTitle(page)).toBe(second);
    await expect(articles.nth(1).getByRole("heading", { level: 2, name: second })).toBeInViewport();
    await expect(page.locator("[data-swipe-hint]")).not.toBeInViewport();
    // Close stays in the corner of every screen.
    await expect(close).toBeInViewport();

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await page.getByRole("main").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

    await close.tap();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("[data-home-grid]").first()).toBeVisible();
    // The header is back.
    await expect(page.getByRole("banner")).toBeVisible();
  });

  test("View event opens the event page", async ({ page }) => {
    await mockApi(page);
    await page.goto("/swipe");
    const link = page.getByRole("article").first().getByRole("link", { name: "View event" });
    const href = await link.getAttribute("href");
    await link.tap();
    // The first visit compiles the event page in dev.
    await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 30_000 });
  });

  test("the keyboard scrolls the feed a screen at a time (focus arrives on the feed)", async ({ page }) => {
    await mockApi(page);
    await page.goto("/swipe");
    const articles = page.getByRole("article");
    await expect(articles.first()).toBeVisible();
    const second = (await articles.nth(1).getAttribute("aria-label")) ?? "";
    await expect(page.getByRole("main")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => visibleTitle(page)).toBe(second);
    await page.keyboard.press("PageUp");
    await expect.poll(() => visibleTitle(page)).toBe((await articles.nth(0).getAttribute("aria-label")) ?? "");
  });

  test("each screen names its group; the feed is a feed of numbered articles; the link names say which event", async ({ page }) => {
    await mockApi(page);
    await page.goto("/swipe");
    const articles = page.getByRole("article");
    await expect(articles.first()).toBeVisible();
    const count = await articles.count();
    await expect(page.getByRole("feed")).toHaveAttribute("aria-busy", "false");
    await expect(page.getByRole("main")).toHaveAccessibleName("Events");
    await expect(page.getByRole("status").filter({ hasText: `${count} events` })).toHaveCount(1);
    for (const [i, expected] of [[0, "1"], [count - 1, String(count)]] as const) {
      await expect(articles.nth(i)).toHaveAttribute("aria-posinset", expected);
      await expect(articles.nth(i)).toHaveAttribute("aria-setsize", String(count));
    }
    await expect(articles.first().locator("[data-swipe-section]")).toHaveText("This weekend");
    const title = (await articles.first().getAttribute("aria-label")) ?? "";
    await expect(articles.first().getByRole("link", { name: `View event ${title}` })).toBeVisible();
  });

  test("the last screen says that's everything, links to all events and goes back to the top", async ({ page }) => {
    await mockApi(page);
    await page.goto("/swipe");
    const articles = page.getByRole("article");
    await expect(articles.first()).toBeVisible();
    const first = (await articles.first().getAttribute("aria-label")) ?? "";
    const end = page.locator("[data-swipe-end]");
    await end.scrollIntoViewIfNeeded();
    await expect(end.getByText("That’s everything")).toBeInViewport({ ratio: 1 });
    await expect(end.getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    await end.getByRole("button", { name: "Back to top" }).tap();
    // The feed scrolls smoothly (motion-safe:scroll-smooth), so the first screen is "in view" (past the middle line, under 334px)
    // a while before the scroll arrives; wait for it to land, or this reads scrollTop part-way down on a slower machine.
    await expect.poll(() => page.getByRole("main").evaluate((el) => el.scrollTop)).toBe(0);
    await expect.poll(() => visibleTitle(page)).toBe(first);
  });

  test("Back from an event lands on the screen you left", async ({ page }) => {
    await mockApi(page);
    await page.goto("/swipe");
    const articles = page.getByRole("article");
    await expect(articles.first()).toBeVisible();
    const second = (await articles.nth(1).getAttribute("aria-label")) ?? "";
    await page.getByRole("main").evaluate((el) => el.scrollBy({ top: el.clientHeight, behavior: "instant" }));
    await expect.poll(() => visibleTitle(page)).toBe(second);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("sheltuh:swipe-position"))).not.toBeNull();

    await articles.nth(1).getByRole("link", { name: /^View event/ }).tap();
    // The first visit compiles the event page in dev.
    await expect(page).toHaveURL(/\/events\/[^/]+$/, { timeout: 30_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/swipe$/);
    await expect(articles.nth(1)).toBeInViewport({ ratio: 0.9 });
    await expect.poll(() => visibleTitle(page)).toBe(second);

    // Close starts the feed over next time.
    await page.getByRole("link", { name: "Close, back to home" }).tap();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/swipe");
    await expect(articles.first()).toBeVisible();
    await expect.poll(() => visibleTitle(page)).toBe((await articles.first().getAttribute("aria-label")) ?? "");
  });

  test("the page behind the feed is black, and only there", async ({ page }) => {
    await mockApi(page);
    await page.goto("/swipe");
    await expect(page.getByRole("article").first()).toBeVisible();
    const background = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(await background()).toBe("rgb(0, 0, 0)");
    await page.getByRole("link", { name: "Close, back to home" }).tap();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(background).not.toBe("rgb(0, 0, 0)");
  });

  test("reduced motion: no smooth scrolling in the feed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi(page);
    await page.goto("/swipe");
    await expect(page.getByRole("article").first()).toBeVisible();
    expect(await page.getByRole("main").evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe("auto");
  });

  test("a failed load shows the error with Try again, and Close", async ({ page }) => {
    await mockApi(page, { fail: true });
    await page.goto("/swipe");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t load events");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Close, back to home" })).toBeVisible();
  });
});

test.describe("on a desktop (1280×800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the home keeps its rails and has no grids, event screens or snapping", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator("[data-home-section]").first()).toBeVisible();
    await expect(page.locator("[data-home-grid]")).toHaveCount(0);
    await expect(page.getByRole("article")).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollSnapType)).toBe("none");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("/swipe is a centred phone-width column, with the home's first event first", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const firstCard = page.locator("[data-home-section]").first().locator("[data-event-card] h3").first();
    await expect(firstCard).toBeVisible();
    const homeFirst = (await firstCard.textContent())?.trim();

    await page.goto("/swipe");
    const article = page.getByRole("article").first();
    await expect(article).toBeVisible();
    await expect(article).toHaveAttribute("aria-label", homeFirst ?? "");

    const main = await page.getByRole("main").boundingBox();
    expect(main?.width).toBeLessThanOrEqual(448);
    expect(main?.width).toBeGreaterThanOrEqual(375);
    expect((main?.x ?? 0) + (main?.width ?? 0) / 2).toBeCloseTo(640, 0);
    expect(main?.height).toBe(800);
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // The page itself never scrolls: the feed does.
    expect(await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)).toBeLessThanOrEqual(0);
  });
});

test.describe("in a 320×256 window (WCAG 1.4.10 reflow)", () => {
  test.use({ viewport: { width: 320, height: 256 }, hasTouch: true });

  test("nothing is clipped: View event and Save are reachable by scrolling, Close never covers the text, no sideways scroll", async ({ page }) => {
    await mockApi(page);
    await page.goto("/swipe");
    const articles = page.getByRole("article");
    await expect(articles.first()).toBeVisible();
    const main = page.getByRole("main");

    // Proximity snap (the default, so it computes as plain "y"), not mandatory, when there is no room for a whole event.
    expect(await main.evaluate((el) => getComputedStyle(el).scrollSnapType)).toBe("y");

    // The screen grows with its text; at the top, the text starts below Close.
    const screenOne = articles.first();
    expect((await screenOne.boundingBox())?.height).toBeGreaterThan(256);
    const closeBottom = (await page.getByRole("link", { name: "Close, back to home" }).boundingBox())?.y;
    const closeEnd = (closeBottom ?? 0) + 44;
    const sectionTop = (await screenOne.locator("[data-swipe-section]").boundingBox())?.y ?? 0;
    expect(sectionTop).toBeGreaterThanOrEqual(closeEnd);

    // Scroll to the foot of the first screen: its two actions are fully visible.
    const title = (await screenOne.getAttribute("aria-label")) ?? "";
    await screenOne.getByRole("link", { name: `View event ${title}` }).scrollIntoViewIfNeeded();
    const view = screenOne.getByRole("link", { name: /^View event/ });
    const save = screenOne.getByRole("link", { name: `Sign in to save ${title}` });
    await expect(view).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await main.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe("in a short landscape phone (667×320)", () => {
  test.use({ viewport: { width: 667, height: 320 }, hasTouch: true });

  test("the text is whole and the actions are reachable", async ({ page }) => {
    await mockApi(page);
    await page.goto("/swipe");
    const first = page.getByRole("article").first();
    await expect(first).toBeVisible();
    await first.getByRole("link", { name: /^View event/ }).scrollIntoViewIfNeeded();
    await expect(first.getByRole("link", { name: /^View event/ })).toBeInViewport({ ratio: 1 });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
