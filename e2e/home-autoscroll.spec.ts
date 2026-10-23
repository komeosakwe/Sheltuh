import { expect, test, type Locator, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The home rails' auto-scroll in a real browser (owner, 23 Oct 2026: "make
 * them automatically scroll to the left or right"; components/home/
 * useRailAutoScroll.ts). Live mode with /api/* answered here: two events this
 * weekend (a pair, which never auto-scrolls) and eight more in Coming up,
 * which overflows at both widths.
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

async function openHome(page: Page, reducedMotion: "reduce" | "no-preference") {
  await page.emulateMedia({ reducedMotion });
  const events = fixtures(Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  await page.route("**/api/**", (route) =>
    new URL(route.request().url()).pathname === "/api/events"
      ? route.fulfill({ json: { items: events, nextCursor: undefined } })
      : route.fulfill({ status: 404, json: { error: "not mocked in e2e" } }),
  );
  await page.goto("/");
  const section = page.locator("[data-home-section]").filter({ has: page.getByRole("heading", { name: "Coming up", exact: true }) });
  const rail = section.getByRole("list");
  await expect(rail).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  // On screen (it only moves there), with the pointer well away from it.
  await page.mouse.move(1, 1);
  await section.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  return { section, rail };
}

const scrollLeft = (rail: Locator) => rail.evaluate((ul) => Math.round(ul.scrollLeft));
const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [390, 1440]) {
  test.describe(`home rail auto-scroll at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 844 : 900 } });

    test("moves on by itself within about 5 seconds, a card at a time, and Pause stops it", async ({ page }) => {
      const { section, rail } = await openHome(page, "no-preference");
      expect(await scrollLeft(rail)).toBe(0);
      const pause = section.getByRole("button", { name: "Pause auto-scroll: Coming up" });
      // A visible 44px control at every width (on phones the arrows are hidden, the Pause button isn't).
      await expect(pause).toBeVisible();
      const box = await pause.boundingBox();
      expect(Math.round(box?.width ?? 0)).toBe(44);
      expect(Math.round(box?.height ?? 0)).toBe(44);
      await expect(section.getByRole("button", { name: "Next events: Coming up" })).toBeVisible({ visible: width >= 640 });

      // It moves on, and settles on a card's start (snap), one card along.
      await expect.poll(() => scrollLeft(rail), { timeout: 6_000, intervals: [250] }).toBeGreaterThan(0);
      const step = await rail.evaluate((ul) => {
        const cards = ul.querySelectorAll("li");
        return Math.round(cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().left);
      });
      await expect.poll(() => scrollLeft(rail), { timeout: 3_000 }).toBe(step);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

      // Pause: it stays where it is, and the button now offers Play.
      await pause.click();
      const play = section.getByRole("button", { name: "Play auto-scroll: Coming up" });
      await expect(play).toBeVisible();
      const held = await scrollLeft(rail);
      await page.waitForTimeout(5_000);
      expect(await scrollLeft(rail)).toBe(held);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("under reduced motion it never moves, and there's no Pause button", async ({ page }) => {
      const { section, rail } = await openHome(page, "reduce");
      await expect(section.getByRole("button", { name: /auto-scroll/ })).toHaveCount(0);
      await page.waitForTimeout(5_000);
      expect(await scrollLeft(rail)).toBe(0);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
}
