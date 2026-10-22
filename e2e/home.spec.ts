import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The home page in a real browser (docs/design/mobile-redesign.md §6.1,
 * §6.3: the one-message hero, no Up next). The e2e server runs in live mode with every /api/*
 * request intercepted here, so the events are the demo sample events served
 * as the live list API would, re-timed relative to the real clock (so the
 * spec never goes stale), two of them inside this weekend's window.
 */

const HOUR = 3600_000;

function fixtures(now: number): PublicEvent[] {
  const window = weekendWindow(new Date(now));
  // Two events open during this weekend, whatever day the suite runs. Late on Sunday, when
  // there's no room left to start one, they're in progress (which still counts).
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

/**
 * `trending`: serve the trending list (the last few events, labelled
 * "popular"); otherwise it's a 404 and the home's third slot is Coming up.
 */
async function mockApi(page: Page, { trending = false }: { trending?: boolean } = {}) {
  const events = fixtures(Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/events") {
      expect(url.searchParams.get("upcoming")).toBe("1");
      return route.fulfill({ json: { items: events, nextCursor: undefined } });
    }
    if (trending && url.pathname === "/api/events/trending") {
      return route.fulfill({ json: { items: events.slice(-4).map((event) => ({ event, label: "popular" })) } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

async function openHome(page: Page, options?: { trending?: boolean }) {
  await mockApi(page, options);
  await page.goto("/");
  await expect(page.locator("[data-home-section]").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const VIEWPORTS = [
  { name: "desktop 1440×900", width: 1440, height: 900, phone: false },
  { name: "desktop 1280×800", width: 1280, height: 800, phone: false },
  { name: "phone 390×844", width: 390, height: 844, phone: true },
];

for (const vp of VIEWPORTS) {
  test.describe(`home at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("one h1, the first section's events above the fold, each event once, no sideways scroll", async ({ page }) => {
      await openHome(page);

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Find your next thing.");
      // No Up next any more (docs/design/mobile-redesign.md §6.1).
      await expect(page.getByRole("region", { name: "Up next" })).toHaveCount(0);

      const fold = vp.height;
      const box = async (locator: ReturnType<Page["locator"]>) => {
        const b = await locator.boundingBox();
        if (!b) throw new Error("not rendered");
        return b;
      };

      // §6.1 acceptance: the first section's heading and the top of its first card are above the fold.
      const firstSection = page.locator("[data-home-section]").first();
      const heading = firstSection.getByRole("heading", { level: 2 });
      const h = await box(heading);
      expect(h.y + h.height).toBeLessThanOrEqual(fold);
      const firstCard = firstSection.locator("[data-event-card]").first();
      expect((await box(firstCard)).y).toBeLessThan(fold);
      // Refinement (owner, 22 Oct 2026): on the phone, the first card's whole image and its title too.
      if (vp.phone) {
        const image = await box(firstCard.locator("[data-card-media]"));
        expect(image.y + image.height).toBeLessThanOrEqual(fold);
        const title = await box(firstCard.getByRole("heading", { level: 3 }));
        expect(title.y + title.height).toBeLessThanOrEqual(fold);
      }

      // Each event at most once across every section.
      const hrefs = await page
        .locator("main a[href^='/events/']")
        .evaluateAll((links) =>
          links.map((a) => a.getAttribute("href") ?? "").filter((href) => /^\/events\/[^?#/]+$/.test(href)),
        );
      expect(hrefs.length).toBeGreaterThan(5);
      expect(new Set(hrefs).size).toBe(hrefs.length);

      // No horizontal overflow.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // The trending request isn't mocked here (404): the third slot is Coming up, never "Popular", and no error.
      await expect(page.getByRole("heading", { name: "Popular right now" })).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 2, name: "Coming up", exact: true })).toBeVisible();
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    });
  });
}

test.describe("the photo push-in (the hero photo shows from 1024px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("runs one cycle of 5s or less", async ({ page }) => {
    await openHome(page);
    const animation = await page.locator("img.ken-burns").first().evaluate((img) => {
      const style = getComputedStyle(img);
      return { name: style.animationName, count: style.animationIterationCount, duration: style.animationDuration };
    });
    expect(animation.name).toBe("push-in");
    expect(animation.count).toBe("1");
    expect(parseFloat(animation.duration)).toBeLessThanOrEqual(5);
  });

  test("is off under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    const names = await page
      .locator("img.ken-burns")
      .evaluateAll((imgs) => imgs.map((img) => getComputedStyle(img).animationName));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toBe("none");
  });
});

test("a card's Buy tickets lands on the event page with focus on the tickets", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const events = fixtures(Date.now());
  await mockApi(page);
  await page.route("**/api/events/slug/**", (route) => {
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const event = events.find((e) => e.slug === slug);
    return event ? route.fulfill({ json: event }) : route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.goto("/");
  const section = page.locator("[data-home-section]").first();
  const quickBuy = section.getByRole("link", { name: /^(?:Buy tickets|Get free tickets) for / }).first();
  const href = await quickBuy.getAttribute("href");
  expect(href).toMatch(/^\/events\/[^/]+#tickets$/);
  await quickBuy.click();
  // The dev server compiles the event route on first visit, which can take a while under load.
  await expect(page).toHaveURL(/#tickets$/, { timeout: 30_000 });
  await expect(page.locator("#tickets")).toBeFocused({ timeout: 30_000 });
});

test.describe("keyboard", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("at 390px, a card reached with Tab is brought fully into view in its rail", async ({ page }) => {
    await openHome(page);
    const section = page.locator("[data-home-section]").filter({ has: page.getByRole("heading", { name: "Coming up", exact: true }) });
    const items = section.getByRole("listitem");
    expect(await items.count()).toBeGreaterThan(2);
    // Start on the first card's link, then Tab through the next two cards (link, Save, Buy tickets each).
    await items.first().getByRole("link").first().focus();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const item = page.locator("li:has(:focus)").last();
      await expect
        .poll(async () => {
          const b = await item.boundingBox();
          if (!b) return "not rendered";
          return b.x >= 0 && b.x + b.width <= 390 && b.y >= 0 && b.y + b.height <= 844 ? "in view" : `${b.x},${b.y} ${b.width}×${b.height}`;
        })
        .toBe("in view");
    }
    // It got past the cards that were on screen to begin with.
    await expect(items.nth(2).locator(":focus")).toHaveCount(1);
  });
});

// The brief's order (docs/design/mobile-redesign.md §6.3.1), at a phone and a desktop width.
for (const width of [375, 1280]) {
  test.describe(`home order at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 812 : 800 } });

    test("hero, the category row, This weekend, Popular right now, Find your people, For organisers, footer", async ({ page }) => {
      await openHome(page, { trending: true });
      await expect(page.getByRole("heading", { level: 2, name: "Popular right now" })).toBeVisible();
      const headings = await page.locator("main h2").allTextContents();
      // Refinement (22 Oct 2026): the categories are a chip row (a labelled nav, no heading) under the search.
      expect(headings.map((h) => h.trim())).toEqual([
        "This weekend",
        "Popular right now",
        "See who’s going before you book",
        "Bring your event to life",
      ]);
      const hero = await page.getByRole("search", { name: "Search events" }).boundingBox();
      const chips = await page.getByRole("navigation", { name: "Browse by category" }).boundingBox();
      const weekend = await page.getByRole("heading", { level: 2, name: "This weekend" }).boundingBox();
      expect((hero?.y ?? Infinity) < (chips?.y ?? -1) && (chips?.y ?? Infinity) < (weekend?.y ?? -1)).toBe(true);
      // The hero comes first, the footer last.
      const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
      const first = await page.locator("main h2").first().boundingBox();
      expect((h1?.y ?? Infinity) < (first?.y ?? -1)).toBe(true);
      await expect(page.locator("footer")).toBeAttached();
      // Gone from the home: Trending and Coming up as separate sections, Free & low-cost, Only in the city.
      for (const name of ["Trending", "Coming up near you", "Free & low-cost", "Only in the city"]) {
        await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
      }
      // Each event section has a clear link onward, named for where it goes: "All events" where the
      // target isn't the section's own list (A8), "See all …" where it is.
      for (const section of await page.locator("[data-home-section]").all()) {
        await expect(section.getByRole("link", { name: /^(?:See all .+|All events)$/ })).toHaveAttribute(
          "href",
          /^\/(events|following)$/,
        );
      }
      // Section heads never repeat the h2 in a strap: each head says its title once.
      const repeats = await page.locator("[data-home-section]").evaluateAll((sections) =>
        sections.map((section) => {
          const title = section.querySelector("h2")?.textContent?.trim() ?? "";
          const head = section.firstElementChild?.textContent ?? "";
          return head.split(title).length - 1;
        }),
      );
      expect(repeats.length).toBeGreaterThan(1);
      for (const n of repeats) expect(n).toBe(1);
      // Find your people: one benefit line (what's visible, as the API allows it) and one action; the
      // step-by-step is on the event page's Who's Going panel.
      const band = page.locator("#find-your-people");
      await expect(band).toContainText("once three people have added themselves. Make a free profile to see who.");
      await expect(band.getByRole("link")).toHaveCount(1);
      await expect(band.getByRole("listitem")).toHaveCount(0);
    });
  });
}

test.describe("rail cards on a phone (375×667)", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("a card fits one screen, image to CTA, and the next card peeks", async ({ page }) => {
    await openHome(page);
    const section = page.locator("[data-home-section]").filter({ has: page.getByRole("heading", { name: "Coming up", exact: true }) });
    const cards = section.locator("[data-event-card]");
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    if (!first || !second) throw new Error("cards not laid out");
    // Under the header (56px), the whole card fits: far from the 1,000px it once ran to.
    expect(first.height).toBeLessThanOrEqual(667 - 56);
    expect(first.width).toBeLessThanOrEqual(375 * 0.68);
    // A sliver of the next card shows at the right edge.
    expect(second.x).toBeLessThan(375);
    expect(second.x + 24).toBeLessThanOrEqual(375);
  });
});

test.describe("/events", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("ends with Only in the city (moved off the home), pointing at the map", async ({ page }) => {
    const events = fixtures(Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    await page.route("**/api/**", (route) =>
      new URL(route.request().url()).pathname === "/api/events"
        ? route.fulfill({ json: { items: events, nextCursor: undefined } })
        : route.fulfill({ status: 404, json: { error: "not mocked in e2e" } }),
    );
    await page.goto("/events");
    const guide = page.getByRole("region", { name: "Only in the city" });
    await expect(guide).toBeVisible({ timeout: 30_000 });
    await expect(guide.getByRole("link", { name: "Open the map" })).toHaveAttribute("href", "/map");
    const feed = await page.getByRole("list", { name: "Events" }).boundingBox();
    const box = await guide.boundingBox();
    expect((box?.y ?? -1) > (feed?.y ?? Infinity)).toBe(true);
  });
});
