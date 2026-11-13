import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The owner's layout polish of 23 Oct 2026, in a real browser: the selected
 * filter chip's state and colours (Light and Dark), and the home's ways on
 * (redesign PR 3: a category chip, the search, a card, the profile CTA and
 * Explore communities). Live mode, with every /api/* request answered here from the demo
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

// Owner (23 Oct 2026): "Make the selected category clearly identifiable" — now the rules' Tags & chips
// board (redesign PR 5): the chosen filter is black (the foreground) with the page colour's words and
// the two orange dots; the others are the page colour with the 1.5px foreground stroke. The filters
// with a selected state are Nearby's (the home's category row is navigation: none of its chips is
// ever "selected"). On a phone they sit behind the "Filters" button.
for (const theme of ["light", "dark"] as const) {
  test.describe(`filter chips in ${theme === "light" ? "Light" : "Dark"} at 390px`, () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the selected chip says so (aria-pressed) and is filled with the foreground; unselected chips are outlined", async ({ page }) => {
      if (theme === "dark") await page.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
      await mockApi(page);
      await page.goto("/map");
      const filters = page.getByRole("button", { name: /^Filters/ });
      const tonight = page.getByRole("button", { name: "Tonight", exact: true });
      const weekend = page.getByRole("button", { name: "This weekend", exact: true });
      // The dev server may still be hydrating the page: press until it responds (never twice once it has).
      await expect(async () => {
        if ((await filters.getAttribute("aria-expanded")) !== "true") await filters.click();
        await expect(filters).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
      await expect(tonight).toHaveAttribute("aria-pressed", "false");
      await tonight.click();
      await expect(tonight).toHaveAttribute("aria-pressed", "true");
      await expect(weekend).toHaveAttribute("aria-pressed", "false");

      const look = (chip: typeof tonight) =>
        chip.evaluate((el) => {
          const s = getComputedStyle(el);
          const icon = el.querySelector("svg");
          return { bg: s.backgroundColor, fg: s.color, border: s.borderTopColor, icon: icon ? getComputedStyle(icon).color : "" };
        });
      // --foreground and --background (app/globals.css) in each theme.
      const [ink, page_] = theme === "dark" ? ["rgb(255, 255, 255)", "rgb(0, 0, 0)"] : ["rgb(0, 0, 0)", "rgb(255, 255, 255)"];
      // Polled: the chip's colours ease in (a short transition), so the first read can be mid-way.
      // Selected: filled with the foreground, the page colour's words and icon, and the orange dots.
      await expect.poll(() => look(tonight)).toEqual({ bg: ink, fg: page_, border: ink, icon: page_ });
      await expect(tonight.locator("[data-selected-dots] span").first()).toHaveCSS("background-color", "rgb(255, 72, 0)");
      // Unselected: the page colour, outlined in the foreground.
      await expect.poll(() => look(weekend)).toEqual({ bg: page_, fg: ink, border: ink, icon: ink });
      // The 1.5px stroke (drawn as 1px on a 1x screen).
      expect(await weekend.evaluate((el) => getComputedStyle(el).borderTopWidth)).toMatch(/^1(\.5)?px$/);

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

  test("a category chip filters the home's listings in place: pressed, the page's address unchanged, only its events listed", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const row = page.getByRole("group", { name: "Browse by category" });
    await expect(row.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    const art = row.getByRole("button", { name: "Art" });
    // The dev server may still be hydrating the page: press until the chip responds (never twice once it has).
    await expect(async () => {
      if ((await art.getAttribute("aria-pressed")) !== "true") await art.click();
      await expect(art).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expect(row.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveURL(/\/$/);
    // Selected: black with white words and the two orange dots, never colour alone.
    // (Polled: the fill eases in over 200ms.)
    await expect.poll(() => art.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(0, 0, 0)");
    await expect(art.locator("[data-selected-dots]")).toHaveCount(1);
    const arts = sampleEvents.filter((e) => e.category === "art").map((e) => e.title);
    const list = page.getByRole("list", { name: "All events", exact: true });
    const titles = await list.locator("[data-event-card] h3").allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) expect(arts).toContain(title.trim());
  });

  test("the hero's search submits to /search with the words", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const search = page.getByRole("search", { name: "Search events" });
    // On a phone the bar is one field that opens the search sheet (redesign PR 2).
    const field = search.getByRole("combobox", { name: "Search events" });
    await expect(async () => {
      if (!(await field.isVisible())) await search.locator("[data-search-trigger]").click();
      await expect(field).toBeFocused({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await field.fill("jazz");
    await search.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?q=jazz$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("jazz");
  });

  test("a card's title opens its event page", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const card = page.getByRole("list", { name: "All events", exact: true }).locator("[data-event-card]").first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const link = card.locator("[data-card-link]");
    const href = await link.getAttribute("href");
    const title = (await card.locator("h3").textContent())?.trim() ?? "";
    expect(href).toMatch(/^\/events\/[^/#?]+$/);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title, { timeout: 30_000 });
  });

  test("“Create profile” in the See who’s going band opens sign-up", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const action = page.locator("[data-community-band]").getByRole("link", { name: "Create profile" });
    await action.scrollIntoViewIfNeeded();
    await action.click();
    await expect(page).toHaveURL(/\/signup$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Create an account");
  });

  test("“Explore communities” opens /community", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    const action = page.locator("#find-your-people").getByRole("link", { name: "Explore communities" });
    await action.scrollIntoViewIfNeeded();
    await action.click();
    await expect(page).toHaveURL(/\/community$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Find your people.", { timeout: 30_000 });
  });
});
