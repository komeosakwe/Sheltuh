import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The phone home's "Swipe through events" entry card and the /swipe feed in a
 * real browser. The e2e server runs in live mode with every /api/* request
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

  test("the home shows the Swipe through events card and no rails", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const entry = page.locator("[data-swipe-entry]");
    await expect(entry).toBeVisible();
    // Title and count are on the phone's first screen, with the photo behind them.
    await expect(entry.getByRole("heading", { level: 2, name: "Swipe through events" })).toBeInViewport({ ratio: 1 });
    await expect(entry.locator("[data-swipe-count]")).toBeInViewport({ ratio: 1 });
    await expect(entry.locator("[data-swipe-count]")).toHaveText(/^\d+ events$/);
    await expect(entry.locator("img")).toBeVisible();
    await expect(page.locator("[data-home-section]")).toHaveCount(0);
    await expect(page.locator("[data-event-card]")).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("an events error shows Try again, not the card or the rails", async ({ page }) => {
    await mockApi(page, { fail: true });
    await page.goto("/");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t load events");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.locator("[data-swipe-entry]")).toHaveCount(0);
    await expect(page.locator("[data-home-section]")).toHaveCount(0);
  });

  test("tapping the card opens /swipe on the first event; a screen down is the second; Close goes home", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await page.locator("[data-swipe-entry]").getByRole("link", { name: "Swipe through events" }).tap();
    await expect(page).toHaveURL(/\/swipe$/);
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

    // The Close target is 44px.
    const close = page.getByRole("link", { name: "Close" });
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
    await expect(page.locator("[data-swipe-entry]")).toBeVisible();
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
    await expect(page.getByRole("link", { name: "Close" })).toBeVisible();
  });
});

test.describe("on a desktop (1280×800)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the home keeps its rails and has no swipe card", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator("[data-home-section]").first()).toBeVisible();
    await expect(page.locator("[data-swipe-entry]")).toHaveCount(0);
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
