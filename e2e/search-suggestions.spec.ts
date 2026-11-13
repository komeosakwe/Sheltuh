import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The owner's requests of Nov 2026, in a real browser (live mode, every /api/* request answered
 * here from the demo samples re-timed to the real clock):
 *
 * - "Suggest events to search up": the hero's empty search field opens a list of the categories
 *   and the first events coming up (a WAI-ARIA combobox), on desktop and in the phone's sheet.
 * - "Lists across the website should be rounded": an open select's list is the customizable select
 *   (globals.css, "Dropdown lists") where Chromium has it.
 */

const HOUR = 3600_000;

function fixtures(now: number): PublicEvent[] {
  return sampleEvents.map((event, i) => ({
    organiserId: "org-demo",
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    suburb: event.suburb,
    state: event.state ?? "VIC",
    timeZone: event.timeZone ?? "Australia/Melbourne",
    startsAt: new Date(now + (i + 1) * 26 * HOUR).toISOString(),
    endsAt: new Date(now + (i + 1) * 26 * HOUR + 3 * HOUR).toISOString(),
    organiserName: event.organiserName,
    imageUrl: event.imageUrl,
    ticketTypes: event.ticketTypes,
    ticketingMode: event.ticketingMode ?? "sheltuh",
    externalTicketUrl: event.externalTicketUrl,
    externalFree: event.externalFree ?? false,
    externalProvider: event.externalProvider ?? null,
  }));
}

/** Answers /api/*; returns the events, soonest first. */
async function mockApi(page: Page): Promise<PublicEvent[]> {
  const events = fixtures(Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/events") {
      const category = url.searchParams.get("category");
      const items = category ? events.filter((e) => e.category === category) : events;
      return route.fulfill({ json: { items, nextCursor: undefined } });
    }
    const slug = /^\/api\/events\/slug\/([^/]+)$/.exec(url.pathname)?.[1];
    if (slug) {
      const event = events.find((e) => e.slug === decodeURIComponent(slug));
      return event ? route.fulfill({ json: event }) : route.fulfill({ status: 404, json: { error: "Event not found." } });
    }
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    if (/\/going(\/|$)/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  await page.route("https://server.arcgisonline.com/**", (route) => route.abort());
  return events;
}

test.describe("search suggestions on the home, desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the empty field opens categories and events coming up over the page; arrows and Enter open one", async ({ page }) => {
    const events = await mockApi(page);
    await page.goto("/");
    const search = page.getByRole("search", { name: "Search events" });
    const field = search.getByRole("combobox", { name: "Search events" });
    const list = page.getByRole("listbox", { name: "Search suggestions" });
    // The home's events have loaded (they're suggested from what's already there).
    await expect(page.locator("[data-event-card]").first()).toBeVisible({ timeout: 30_000 });
    // The category row, under the carousel (which may advance on its own).
    const below = page.getByRole("group", { name: "Browse by category" });
    const before = await below.boundingBox();

    await field.click();
    await expect(field).toHaveAttribute("aria-expanded", "true");
    await expect(list).toBeVisible();
    await expect(list.getByRole("group", { name: "Categories" }).getByRole("option")).toHaveText([
      "Live music",
      "Art",
      "Workshops",
      "Pop-ups",
      "Theatre",
    ]);
    const coming = list.getByRole("group", { name: "Coming up" }).getByRole("option");
    await expect(coming).toHaveCount(3);
    await expect(coming.first()).toContainText(events[0].title);
    // It lies over the page: nothing under the bar moved.
    expect(await below.boundingBox()).toEqual(before);
    // Rounded (16px) on the soft shadow.
    const look = await list.locator("..").evaluate((el) => ({ radius: getComputedStyle(el).borderTopLeftRadius, shadow: getComputedStyle(el).boxShadow }));
    expect(look.radius).toBe("16px");
    expect(look.shadow).not.toBe("none");

    // Typing closes it; clearing opens it again.
    await field.fill("j");
    await expect(field).toHaveAttribute("aria-expanded", "false");
    await field.fill("");
    await expect(field).toHaveAttribute("aria-expanded", "true");

    // Escape closes it; Down opens it again on the first option, focus staying in the field.
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await page.keyboard.press("ArrowDown");
    const first = list.getByRole("option", { name: "Live music" });
    await expect(field).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id")) ?? "");
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(field).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/events\?category=live-music$/, { timeout: 30_000 });
  });

  test("a click on an event opens its page; a click outside closes the list", async ({ page }) => {
    const events = await mockApi(page);
    await page.goto("/");
    const field = page.getByRole("combobox", { name: "Search events" });
    const list = page.getByRole("listbox", { name: "Search suggestions" });
    await expect(page.locator("[data-event-card]").first()).toBeVisible({ timeout: 30_000 });
    await field.click();
    await expect(list).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(list).toBeHidden();
    await field.click();
    await list.getByRole("option", { name: new RegExp(events[0].title) }).click();
    await expect(page).toHaveURL(new RegExp(`/events/${events[0].slug}$`), { timeout: 30_000 });
  });
});

test.describe("search suggestions in the phone's search sheet", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("open under Search when the sheet opens, nothing sideways; Escape closes the list, then the sheet", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const search = page.getByRole("search", { name: "Search events" });
    const trigger = search.locator("[data-search-trigger]");
    const field = search.getByRole("combobox", { name: "Search events" });
    await expect(async () => {
      if (!(await field.isVisible())) await trigger.tap();
      await expect(field).toBeFocused({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    const list = page.getByRole("listbox", { name: "Search suggestions" });
    await expect(list).toBeVisible();
    const submit = await search.getByRole("button", { name: "Search", exact: true }).boundingBox();
    const box = await list.boundingBox();
    expect(box && submit && box.y).toBeGreaterThan((submit?.y ?? 0) + (submit?.height ?? 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    // Rows are at least 40px to tap.
    expect((await list.getByRole("option", { name: "Art" }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);

    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(field).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(field).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.tap();
    await page.getByRole("dialog", { name: "Search events" }).getByRole("option", { name: "Theatre" }).tap();
    await expect(page).toHaveURL(/\/events\?category=theatre$/, { timeout: 30_000 });
  });
});

test.describe("rounded dropdown lists", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("an open filter's list is the customizable select: 40px rows, under the filter", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const category = page.getByRole("combobox", { name: "Category", exact: true });
    await expect(category).toBeVisible({ timeout: 30_000 });
    // This Chromium has base-select (the Playwright config pins one that does).
    expect(await category.evaluate((el) => getComputedStyle(el).appearance)).toBe("base-select");
    // Near the top of the window (under the sticky header), so there's room for the list below it.
    await category.evaluate((el) => {
      // Instant: the page scrolls smoothly otherwise, and would be measured mid-scroll.
      el.scrollIntoView({ block: "start", behavior: "instant" });
      window.scrollBy({ top: -200, behavior: "instant" });
    });
    const closed = await category.boundingBox();
    await category.click();
    expect(await category.evaluate((el) => el.matches(":open"))).toBe(true);
    const art = category.getByRole("option", { name: "Art" });
    const row = await art.boundingBox();
    expect(row?.height ?? 0).toBeGreaterThanOrEqual(40);
    expect(row?.y ?? 0).toBeGreaterThan((closed?.y ?? 0) + (closed?.height ?? 0));
    await art.click();
    await expect(category).toHaveValue("art");
    // The closed filter keeps its width (its widest option's), whatever is chosen.
    expect((await category.boundingBox())?.width).toBe(closed?.width);
  });
});
