import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";

/**
 * /community in a real browser (redesign PR 3), built from real data only. Live mode, with every
 * /api/* request answered here: the demo sample events re-timed to the real clock, served as the
 * public list API would (no venue pins, so the page places them by suburb, as /map does).
 */

const HOUR = 3600_000;

function fixtures(now: number): PublicEvent[] {
  return sampleEvents.map((event, i) => {
    const start = now + (i + 1) * 26 * HOUR;
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
      ...(event.state ? { state: event.state } : {}),
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 3 * HOUR).toISOString(),
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

async function mockApi(page: Page, { fail = false }: { fail?: boolean } = {}) {
  const events = fixtures(Date.now());
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/events") {
      if (fail) return route.fulfill({ status: 500, json: { error: "down" } });
      return route.fulfill({ json: { items: events, nextCursor: undefined } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

async function openCommunity(page: Page, options?: { fail?: boolean }) {
  await mockApi(page, options);
  await page.goto("/community");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}

const sidewaysOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 768, 390, 320]) {
    test.describe(`/community at ${width}px, ${theme}`, () => {
      test.use({ viewport: { width, height: 900 } });

      test("one h1, the real sections in order, real counts, no invented parts, and no sideways scroll", async ({ page }) => {
        if (theme === "dark") await page.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
        await openCommunity(page);
        await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Find your people.");
        await expect(page).toHaveTitle("Community — Sheltüh");
        const headings = (await page.locator("main h2").allTextContents()).map((h) => h.trim());
        expect(headings).toEqual(["Local discovery", "Your visibility, your choice", "Scenes by city", "Find your people."]);
        await expect(page.locator("main")).not.toContainText(/Word of mouth|Follow scenes|members|you know/i);
        // Local discovery: real upcoming events, the one EventCard.
        await expect(page.getByRole("list", { name: "Local discovery" }).locator("[data-event-card]").first()).toBeVisible();
        // Scenes by city: Melbourne's real count (the samples are mostly in inner Melbourne).
        const melbourne = page.locator("[data-city='Melbourne']");
        await expect(melbourne).toContainText(/\d+ upcoming/, { timeout: 30_000 });
        // The collage's photos load (licensed only), decorative.
        const collage = page.locator("[data-community-collage]");
        await expect(collage).toHaveAttribute("aria-hidden", "true");
        await expect
          .poll(() => collage.locator("img").evaluateAll((imgs) => imgs.filter((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0).length))
          .toBeGreaterThan(2);
        expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
      });
    });
  }
}

test.describe("/community's ways on, at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Explore scenes moves to Scenes by city, focus included; a city opens Nearby around it without changing the saved place", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sheltuh:near:v1", JSON.stringify({ suburb: "Fitzroy", state: "VIC" })));
    await openCommunity(page);
    await page.getByRole("link", { name: "Explore scenes" }).click();
    await expect(page).toHaveURL(/\/community#scenes-by-city$/);
    await expect(page.locator("#scenes-by-city")).toBeFocused();
    await expect(page.getByRole("heading", { level: 2, name: "Scenes by city" })).toBeInViewport();
    const sydney = page.getByRole("link", { name: "Events near Sydney on Nearby" });
    await expect(sydney).toHaveAttribute("href", "/map?near=Sydney");
    await sydney.click();
    await expect(page).toHaveURL(/\/map\?near=Sydney$/, { timeout: 30_000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sheltuh:near:v1") ?? "{}"));
    expect(stored).toEqual({ suburb: "Fitzroy", state: "VIC" });
  });

  test("Join free and Join Sheltüh — free open sign-up; the banner's action is black on orange", async ({ page }) => {
    await openCommunity(page);
    await expect(page.getByRole("link", { name: "Join free" })).toHaveAttribute("href", "/signup");
    const banner = page.locator('section[aria-labelledby="community-join"]');
    const join = banner.getByRole("link", { name: "Join Sheltüh — free" });
    expect(await banner.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 72, 0)");
    expect(await join.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(0, 0, 0)");
    await join.click();
    await expect(page).toHaveURL(/\/signup$/, { timeout: 30_000 });
  });

  test("when the events can't load: the error and Try again in Local discovery; the rest still shows", async ({ page }) => {
    await openCommunity(page, { fail: true });
    const local = page.getByRole("region", { name: "Local discovery" });
    await expect(local.getByRole("alert")).toContainText("Couldn’t load events", { timeout: 30_000 });
    await expect(local.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.locator("[data-city='Melbourne']")).toBeVisible();
    await expect(page.locator("[data-city='Melbourne']")).not.toContainText(/upcoming/);
  });
});
