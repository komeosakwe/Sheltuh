import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The owner's layout polish of 23 Oct 2026, in a real browser: the selected
 * filter chip's state and colours (Light and Dark), and the home's ways on
 * still working after it (a category chip, the search, a card, the profile
 * CTA). Live mode, with every /api/* request answered here from the demo
 * samples re-timed to the real clock (two of them this weekend), as in
 * home.spec.ts and responsive.spec.ts.
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

async function mockApi(page: Page) {
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
  // No map tiles (no network in CI either); the map's filters work without them.
  await page.route("https://server.arcgisonline.com/**", (route) => route.abort());
}

// Owner (23 Oct 2026): "Make the selected category clearly identifiable: white background and black text.
// Unselected categories retain dark backgrounds and subtle borders." The chips with a selected state are
// the map's filters (the home's category row is navigation: none of its chips is ever "selected").
for (const theme of ["light", "dark"] as const) {
  test.describe(`filter chips in ${theme === "light" ? "Light" : "Dark"} at 390px`, () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the selected chip says so (aria-pressed) and is solid; unselected chips keep the card colour and a subtle edge", async ({ page }) => {
      if (theme === "dark") await page.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
      await mockApi(page);
      await page.goto("/map");
      const tonight = page.getByRole("button", { name: "Tonight", exact: true });
      const weekend = page.getByRole("button", { name: "This weekend", exact: true });
      await expect(tonight).toHaveAttribute("aria-pressed", "false", { timeout: 30_000 });
      // The dev server may still be hydrating the page: press until the chip responds (never twice once it has).
      await expect(async () => {
        if ((await tonight.getAttribute("aria-pressed")) !== "true") await tonight.click();
        await expect(tonight).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
      await expect(weekend).toHaveAttribute("aria-pressed", "false");

      const look = (chip: typeof tonight) =>
        chip.evaluate((el) => {
          const s = getComputedStyle(el);
          return { bg: s.backgroundColor, fg: s.color, border: s.borderTopColor };
        });
      const [ink, paper, card] =
        theme === "dark" ? ["rgb(255, 255, 255)", "rgb(0, 0, 0)", "rgb(20, 20, 20)"] : ["rgb(0, 0, 0)", "rgb(255, 255, 255)", "rgb(255, 255, 255)"];
      // Selected: Dark, white with black text (the owner's ask); Light, its inverse, black with white text.
      expect(await look(tonight)).toEqual({ bg: ink, fg: paper, border: ink });
      await expect(tonight.locator("[data-selected-dots]")).toHaveCount(1);
      // Unselected: the card colour with the page's text colour, and a half-strength edge.
      const other = await look(weekend);
      expect(other.bg).toBe(card);
      expect(other.fg).toBe(ink);
      expect(other.border).toMatch(/\/ 0\.5\)$/);

      // The keyboard focus ring still shows on a chip.
      await weekend.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(weekend).toBeFocused();
      const ring = await weekend.evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }));
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThanOrEqual(2);
    });
  });
}

test.describe("the home's ways on, at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a category chip lands on /events with that category chosen and only its events listed", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const row = page.getByRole("navigation", { name: "Browse by category" });
    // Navigation, not a filter: no chip on the home claims to be selected.
    await expect(row.locator("[aria-current], [aria-pressed]")).toHaveCount(0);
    await row.getByRole("link", { name: "Art" }).click();
    await expect(page).toHaveURL(/\/events\?category=art$/, { timeout: 30_000 });
    // The filter form is behind "Filters" on phones; its Category field already says Art.
    await expect(page.locator("#category-filter")).toHaveValue("art");
    const list = page.getByRole("list", { name: "Events" });
    await expect(list.getByRole("listitem").first()).toBeVisible({ timeout: 30_000 });
    const arts = sampleEvents.filter((e) => e.category === "art").map((e) => e.title);
    for (const title of await list.locator("[data-event-card] h3").allTextContents()) expect(arts).toContain(title.trim());
  });

  test("the hero's search submits to /search with the words", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const search = page.getByRole("search", { name: "Search events" });
    await search.getByRole("searchbox", { name: "Search events" }).fill("jazz");
    await search.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search\?q=jazz$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("jazz");
  });

  test("a card's title opens its event page", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const card = page.getByRole("region", { name: "This weekend" }).locator("[data-event-card]").first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const link = card.locator("[data-card-link]");
    const href = await link.getAttribute("href");
    const title = (await card.locator("h3").textContent())?.trim() ?? "";
    expect(href).toMatch(/^\/events\/[^/#?]+$/);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title, { timeout: 30_000 });
  });

  test("“Create profile now” opens sign-up", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const action = page.locator("#find-your-people").getByRole("link", { name: "Create profile now" });
    await action.scrollIntoViewIfNeeded();
    await action.click();
    await expect(page).toHaveURL(/\/signup$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Create an account");
  });

  test("the band is compact: about 32px between the action and the card, 20px inside the card", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    // Measured once the events are in (they move everything below them), both in the same frame.
    await expect(page.locator("[data-home-section] [data-event-card]").first()).toBeVisible({ timeout: 30_000 });
    const band = page.locator("#find-your-people");
    const card = band.locator("[data-community-card]");
    const gap = await band.evaluate((el) => {
      const action = el.querySelector("a[href='/signup']")?.getBoundingClientRect();
      const box = el.querySelector("[data-community-card]")?.getBoundingClientRect();
      return action && box ? Math.round(box.top - action.bottom) : -1;
    });
    expect(gap).toBe(32);
    expect(await card.evaluate((el) => getComputedStyle(el).paddingTop)).toBe("20px");
    // Its disclosure stays readable: 14px.
    expect(await card.locator("[data-community-note]").evaluate((el) => getComputedStyle(el).fontSize)).toBe("14px");
  });
});
