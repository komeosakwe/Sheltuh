import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The home page in a real browser (the proposal, redesign PR 3: the hero, the featured carousel,
 * the category chips, This weekend, All events, Find your people and the organiser banner). The
 * e2e server runs in live mode with every /api/*
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
 * "popular"); otherwise it's a 404 and the carousel is Coming up.
 */
async function mockApi(page: Page, { trending = false, going }: { trending?: boolean; going?: number } = {}) {
  const events = fixtures(Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/events") {
      expect(url.searchParams.get("upcoming")).toBe("1");
      // Recently on is gone: nothing asks for ended events.
      expect(url.searchParams.get("recent")).toBeNull();
      return route.fulfill({ json: { items: events, nextCursor: undefined } });
    }
    if (trending && url.pathname === "/api/events/trending") {
      // `going`: the first trending event carries a real (thresholded) going count.
      const items = events.slice(-4).map((event, i) =>
        going !== undefined && i === 0 ? { event, label: "going", goingCount: going } : { event, label: "popular" },
      );
      return route.fulfill({ json: { items } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

async function openHome(page: Page, options?: { trending?: boolean; going?: number }) {
  await mockApi(page, options);
  await page.goto("/");
  await expect(page.locator("[data-home-section]").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** Serves `count` events, all well past this weekend, and opens the home. */
async function openWith(page: Page, count: number) {
  const events = fixtures(Date.now())
    .slice(2, 2 + count)
    .map((event, i) => {
      const start = Date.now() + (10 + i) * 24 * HOUR;
      return { ...event, startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3 * HOUR).toISOString() };
    });
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/events") return route.fulfill({ json: { items: events, nextCursor: undefined } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  await page.goto("/");
}

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The card titles in a listing, in order. */
const titlesIn = (page: Page, name: string) => page.getByRole("list", { name, exact: true }).locator("[data-event-card] h3").allTextContents();

// The rules' Layout board: 1312px of content, four 304px cards at 1440; three from 1024, two on a tablet, one on a phone.
const VIEWPORTS = [
  { name: "desktop 1440×900", width: 1440, height: 900, columns: 4, card: 304 },
  { name: "desktop 1280×800", width: 1280, height: 800, columns: 4, card: 280 },
  { name: "laptop 1024×768", width: 1024, height: 768, columns: 3, card: 298.67 },
  { name: "tablet 768×1024", width: 768, height: 1024, columns: 2, card: 340 },
  { name: "phone 390×844", width: 390, height: 844, columns: 1, card: 358 },
];

for (const vp of VIEWPORTS) {
  test.describe(`home at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("one h1, the carousel starting above the fold, each event once above All events, a grid of whole-foot cards, no sideways scroll", async ({ page }) => {
      await openHome(page);

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Find your next thing.");
      // The trending request isn't mocked here (404): the carousel is Coming up, never "Popular", and no error.
      const carousel = page.getByRole("region", { name: "Coming up", exact: true });
      await expect(carousel).toHaveAttribute("aria-roledescription", "carousel");
      expect((await carousel.boundingBox())?.y ?? Infinity).toBeLessThan(vp.height);
      await expect(page.getByRole("heading", { name: "Popular right now" })).toHaveCount(0);
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);

      // The carousel picks the soonest without emptying This weekend (an event can be in both); neither
      // repeats an event within itself, and All events lists each one once.
      const slides = await carousel.locator("[data-slide] h3").allTextContents();
      const weekend = await titlesIn(page, "This weekend");
      expect(slides.length).toBeGreaterThan(0);
      expect(weekend.length).toBeGreaterThan(0);
      expect(new Set(slides).size).toBe(slides.length);
      expect(new Set(weekend).size).toBe(weekend.length);
      const all = await titlesIn(page, "All events");
      expect(all.length).toBeGreaterThan(3);
      expect(new Set(all).size).toBe(all.length);

      // The grid: its columns, each card at its width, and every card's foot (who's going, the price) on one line.
      const grid = page.getByRole("list", { name: "All events", exact: true });
      const columns = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").map(parseFloat));
      expect(columns).toHaveLength(vp.columns);
      for (const width of columns) expect(width).toBeCloseTo(vp.card, 0);
      // A row, and laid out as one: every child shares the first one's line (a wrapped row would pass the first check alone).
      const feet = await grid.locator("[data-card-foot]").evaluateAll((els) =>
        els.map((el) => {
          const boxes = Array.from(el.children)
            .map((child) => child.getBoundingClientRect())
            .filter((box) => box.width > 0 && box.height > 0);
          const [first] = boxes;
          return {
            direction: getComputedStyle(el).flexDirection,
            oneLine: boxes.every((box) => box.top < first.bottom && box.bottom > first.top),
          };
        }),
      );
      expect(feet.length).toBeGreaterThan(0);
      for (const foot of feet) expect(foot).toEqual({ direction: "row", oneLine: true });

      expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("home with few events", () => {
  for (const vp of [
    { width: 375, height: 667 },
    { width: 1280, height: 800 },
  ]) {
    test(`one event, none this weekend, at ${vp.width}px: it's the carousel's Coming up and All events' one card, no dead end`, async ({ page }) => {
      await page.setViewportSize(vp);
      await openWith(page, 1);
      const carousel = page.getByRole("region", { name: "Coming up", exact: true });
      await expect(carousel.locator("[data-slide]")).toHaveCount(1);
      // One slide: no controls.
      await expect(carousel.getByRole("button")).toHaveCount(0);
      await expect(page.getByRole("list", { name: "All events", exact: true }).locator("[data-event-card]")).toHaveCount(1);
      await expect(page.getByRole("heading", { name: "This weekend" })).toHaveCount(0);
      await expect(page.getByText(/Nothing this weekend/)).toHaveCount(0);
    });
  }

  test("no events: says so with a link to all events, and no chips", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openWith(page, 0);
    await expect(page.getByText("No events yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "All events" }).first()).toHaveAttribute("href", "/events");
    await expect(page.getByRole("group", { name: "Browse by category" })).toHaveCount(0);
  });
});

// The proposal's banner (redesign PR 3): the WAI carousel pattern.
test.describe("the featured carousel at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const current = (page: Page) =>
    page.locator("[data-featured-carousel] [data-slide]").evaluateAll((slides) => slides.findIndex((s) => s.hasAttribute("data-current")));

  test("each slide: the category alone (no 'Featured'), the title, an all-inclusive A$ price, its own ticket action and Details", async ({ page }) => {
    await openHome(page, { trending: true });
    const carousel = page.getByRole("region", { name: "Popular right now" });
    const slide = carousel.locator("[data-slide][data-current]");
    await expect(slide).toHaveAttribute("aria-label", /^1 of \d$/);
    await expect(carousel).not.toContainText(/Featured/i);
    await expect(slide.locator("p.mono-s").first()).toHaveText(/^(Live music|Art|Workshop|Pop-up|Theatre)$/);
    await expect(slide.locator("p.mono-s").nth(1)).toHaveText(/ · (?:From )?A\$[\d.]+$|· Free$|· Sold out$|· Buy tickets$/);
    await expect(slide.getByRole("link", { name: /^Details: / })).toHaveAttribute("href", /^\/events\/[^/#]+$/);
    // Only the current slide is reachable: the others are inert.
    await expect(carousel.locator("[data-slide]:not([data-current])[inert]")).toHaveCount((await carousel.locator("[data-slide]").count()) - 1);
  });

  test("advances by itself, never moving focus; Pause stops it; Next, Previous and the dots move it and take over", async ({ page }) => {
    await openHome(page, { trending: true });
    const carousel = page.getByRole("region", { name: "Popular right now" });
    // Keep the pointer and focus out of it: either holds it still.
    await page.mouse.move(5, 5);
    await expect(carousel.locator("[data-slide]").first()).toHaveAttribute("data-current", "");
    await expect.poll(() => current(page), { timeout: 15_000 }).toBe(1);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    // The slide in view is the current one, once the glide settles.
    await expect
      .poll(() =>
        carousel.locator("[data-slide][data-current]").evaluate((slide) => {
          const track = slide.parentElement?.getBoundingClientRect();
          const box = slide.getBoundingClientRect();
          return track ? Math.abs(box.left - track.left) < 2 : false;
        }),
      )
      .toBe(true);

    await carousel.getByRole("button", { name: "Pause carousel" }).click();
    await expect(carousel.getByRole("button", { name: "Play carousel" })).toBeFocused();
    await expect(page.locator("#home-featured-slides")).toHaveAttribute("aria-live", "polite");
    await page.mouse.move(5, 5);
    await page.waitForTimeout(7_000);
    expect(await current(page)).toBe(1);

    await carousel.getByRole("button", { name: "Next slide" }).click();
    await expect.poll(() => current(page)).toBe(2);
    await carousel.getByRole("button", { name: "Previous slide" }).click();
    await expect.poll(() => current(page)).toBe(1);
    await carousel.getByRole("button", { name: /^Slide 1: / }).click();
    await expect.poll(() => current(page)).toBe(0);
    await expect(carousel.getByRole("button", { name: /^Slide 1: / })).toHaveAttribute("aria-current", "true");
    // 40px controls from md, each with a visible ring.
    const next = carousel.getByRole("button", { name: "Next slide" });
    expect((await next.boundingBox())?.height).toBe(40);
    await next.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await next.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  });

  test("under reduced motion it never moves by itself and has no Pause", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page, { trending: true });
    const carousel = page.getByRole("region", { name: "Popular right now" });
    await expect(carousel.getByRole("button", { name: "Next slide" })).toBeVisible();
    await expect(carousel.getByRole("button", { name: /Pause carousel|Play carousel/ })).toHaveCount(0);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(7_000);
    expect(await current(page)).toBe(0);
  });
});

// UX review (blocking): below 640px the slide is square (was 4:5; the owner asked for a home that shows more, Nov 2026) and grows to fit its panel, so nothing is cut off.
for (const width of [320, 390]) {
  test.describe(`the featured carousel at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("the slide's panel (eyebrow to Details) is wholly inside the slide, and the slide is at least square", async ({ page }) => {
      await openHome(page, { trending: true });
      const slide = page.locator("[data-featured-carousel] [data-slide][data-current]");
      const [box, panel, eyebrow, details] = await Promise.all([
        slide.boundingBox(),
        slide.locator("[data-slide-panel]").boundingBox(),
        slide.locator("[data-slide-panel] p").first().boundingBox(),
        slide.getByRole("link", { name: /^Details: / }).boundingBox(),
      ]);
      if (!box || !panel || !eyebrow || !details) throw new Error("slide not laid out");
      expect(box.height).toBeGreaterThanOrEqual(box.width - 1);
      expect(panel.y).toBeGreaterThanOrEqual(box.y);
      expect(eyebrow.y).toBeGreaterThanOrEqual(box.y);
      expect(details.y + details.height).toBeLessThanOrEqual(box.y + box.height);
      expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("the category chips and All events", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a category chip filters the listings in the page (no navigation), and the Category filter agrees", async ({ page }) => {
    await openHome(page);
    const chips = page.getByRole("group", { name: "Browse by category" });
    await expect(chips.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
    const art = chips.getByRole("button", { name: "Art" });
    await expect(async () => {
      if ((await art.getAttribute("aria-pressed")) !== "true") await art.click();
      await expect(art).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/$/);
    const arts = sampleEvents.filter((e) => e.category === "art").map((e) => e.title);
    const listed = await titlesIn(page, "All events");
    expect(listed.length).toBeGreaterThan(0);
    for (const title of listed) expect(arts).toContain(title.trim());
    await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("art");
  });

  test("Reset filters clears them and moves focus to the All events heading", async ({ page }) => {
    await openHome(page);
    const price = page.getByRole("combobox", { name: "Price" });
    await expect(async () => {
      await price.selectOption("free");
      await expect(page.getByRole("button", { name: "Reset filters" })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByRole("region", { name: "All events" }).getByRole("status")).toHaveText(/^\d+ events? match(es)?$/);
    await page.getByRole("button", { name: "Reset filters" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "All events" })).toBeFocused();
    await expect(price).toHaveValue("all");
  });

  test("Show more events adds the next cards and moves focus to the first new one", async ({ page }) => {
    await openHome(page);
    const grid = page.getByRole("list", { name: "All events", exact: true });
    await expect(grid.locator("[data-event-card]")).toHaveCount(8);
    await page.getByRole("button", { name: "Show more events" }).click();
    await expect(grid.locator("[data-event-card]").nth(8).locator("[data-card-link]")).toBeFocused();
    expect(await grid.locator("[data-event-card]").count()).toBeGreaterThan(8);
  });
});

// The redesign's card (the rules' Cards board) has no ticket button: its price is an orange label inside
// the card's one link, so a tap on the price opens the event like anywhere else on the card.
test("a tap on a card's price label opens its event page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const events = fixtures(Date.now());
  await mockApi(page);
  await page.route("**/api/events/slug/**", (route) => {
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const event = events.find((e) => e.slug === slug);
    return event ? route.fulfill({ json: event }) : route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.goto("/");
  const grid = page.getByRole("list", { name: "All events", exact: true });
  const card = grid.locator("[data-event-card]").filter({ has: page.locator("[data-price-tag='signal']") }).first();
  const href = await card.locator("[data-card-link]").getAttribute("href");
  expect(href).toMatch(/^\/events\/[^/#]+$/);
  await expect(grid.getByRole("link", { name: /^(?:Buy tickets|Free tickets) for / })).toHaveCount(0);
  const price = card.locator("[data-price-tag]");
  await price.scrollIntoViewIfNeeded();
  // A real click where the label is drawn: the card's stretched link is what's under the pointer there.
  const box = await price.boundingBox();
  if (!box) throw new Error("price not laid out");
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href"), [box.x + box.width / 2, box.y + box.height / 2])).toBe(href);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // The dev server compiles the event route on first visit, which can take a while under load.
  await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 30_000 });
});

test.describe("the logo on the home", () => {
  for (const vp of [
    { name: "desktop 1280×800", width: 1280, height: 800 },
    { name: "phone 390×844", width: 390, height: 844 },
  ]) {
    test(`scrolls back to the top at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openHome(page);
      await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" }));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
      await page.locator("header").getByRole("link", { name: "Sheltüh home" }).click();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await expect(page).toHaveURL(/\/$/);
    });
  }

  test("goes to the clean / when the home has a query string, and scrolls to the top", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockApi(page);
    await page.goto("/?utm_source=newsletter");
    await expect(page.locator("[data-home-section]").first()).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await page.locator("header").getByRole("link", { name: "Sheltüh home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });
});

// The proposal's order, at a phone, a tablet and a desktop width.
for (const width of [390, 768, 1280]) {
  test.describe(`home order at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("hero, carousel, chips, This weekend, All events, Find your people, Bring your event to life, footer", async ({ page }) => {
      await openHome(page, { trending: true });
      await expect(page.getByRole("region", { name: "Popular right now" })).toBeVisible();
      const headings = (await page.locator("main h2").allTextContents()).map((h) => h.trim());
      expect(headings).toEqual(["Popular right now", "This weekend", "All events", "Find your people.", "Bring your event to life"]);
      const ys = await Promise.all(
        [
          page.getByRole("heading", { level: 1 }),
          page.getByRole("search", { name: "Search events" }),
          page.getByRole("region", { name: "Popular right now" }),
          page.getByRole("group", { name: "Browse by category" }),
          page.getByRole("region", { name: "This weekend" }),
          page.getByRole("region", { name: "All events" }),
          page.locator("#find-your-people"),
          page.getByRole("region", { name: "Bring your event to life" }),
          page.locator("footer"),
        ].map(async (locator) => (await locator.boundingBox())?.y ?? NaN),
      );
      expect(ys.every((y, i) => i === 0 || y > ys[i - 1])).toBe(true);
      // Gone from the home: the rails, What else?, Recently on and the old weekend card.
      for (const name of ["What else?", "Recently on", "After dark"]) await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
      await expect(page.locator("[data-rail-layout], [data-rail-clone], [data-what-else], [data-variant='weekend']")).toHaveCount(0);
      // Each event section's link onward, named for where it goes.
      await expect(page.getByRole("region", { name: "This weekend" }).getByRole("link", { name: "See all this weekend" })).toHaveAttribute("href", "/map?time=weekend&within=all");
      await expect(page.getByRole("region", { name: "All events" }).getByRole("link", { name: "See all events" })).toHaveAttribute("href", "/events");
      // Find your people: Explore communities to /community, then the band, with no invented counts.
      const people = page.locator("#find-your-people");
      await expect(people.getByRole("link", { name: "Explore communities" })).toHaveAttribute("href", "/community");
      await expect(people).not.toContainText(/friends going|members|Follow/);
      // The organiser banner, last.
      await expect(page.getByRole("region", { name: "Bring your event to life" }).getByRole("link", { name: "List your event" })).toHaveAttribute("href", "/organisers/apply");
      expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
    });
  });
}

// The band: a real count from trending, with the owner's illustrative portraits (never attendees).
for (const vp of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test.describe(`Find your people at ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("the band shows a trending event's real count, the illustrative faces and an honest note, and its action works by keyboard", async ({ page }) => {
      await openHome(page, { trending: true, going: 22 });
      const band = page.locator("[data-community-band]");
      await band.scrollIntoViewIfNeeded();
      await expect(band.getByRole("heading", { level: 3, name: "See who’s going." })).toBeVisible();
      await expect(band.locator("[data-community-count]")).toHaveText(/^22 people going · .+$/);
      await expect(band.locator("[data-community-note]")).toHaveText("Popular right now · Real count");
      await expect(band).not.toContainText(/sample|follow a community/i);
      const faces = band.locator("[data-community-faces]");
      await expect(faces).toHaveAttribute("aria-hidden", "true");
      await expect
        .poll(() => faces.locator("img").evaluateAll((imgs) => imgs.filter((img) => (img as HTMLImageElement).naturalWidth > 0).length))
        .toBe(5);
      const bandBox = await band.boundingBox();
      const facesBox = await faces.boundingBox();
      if (!bandBox || !facesBox) throw new Error("band not laid out");
      expect(facesBox.x + facesBox.width).toBeLessThanOrEqual(bandBox.x + bandBox.width);
      // The focus ring shows on the orange (black, never orange), and the action is reachable.
      const action = band.getByRole("link", { name: "Create profile" });
      await action.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(action).toBeFocused();
      expect(await action.evaluate((a) => getComputedStyle(a).outlineColor)).toBe("rgb(0, 0, 0)");
      expect((await action.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("/events", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("ends with the After dark guide card (moved off the home), pointing at the map", async ({ page }) => {
    const events = fixtures(Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    await page.route("**/api/**", (route) =>
      new URL(route.request().url()).pathname === "/api/events"
        ? route.fulfill({ json: { items: events, nextCursor: undefined } })
        : route.fulfill({ status: 404, json: { error: "not mocked in e2e" } }),
    );
    await page.goto("/events");
    const guide = page.getByRole("region", { name: "After dark" });
    await expect(guide).toBeVisible({ timeout: 30_000 });
    await expect(guide.getByRole("link", { name: "Open the map" })).toHaveAttribute("href", "/map");
    const feed = await page.getByRole("list", { name: "Events" }).boundingBox();
    const box = await guide.boundingBox();
    expect((box?.y ?? -1) > (feed?.y ?? Infinity)).toBe(true);
  });
});

// Owner (23 Oct 2026): "keep this as well and the motion in the picture": the hero's turning badge.
test.describe("the hero badge at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("sits before the h1, turns slowly and can be paused from the keyboard", async ({ page }) => {
    await openHome(page);
    const badge = page.getByRole("button", { name: "Pause the badge animation" });
    await expect(badge).toBeVisible();
    const [badgeBox, h1Box] = [await badge.boundingBox(), await page.getByRole("heading", { level: 1 }).boundingBox()];
    expect((badgeBox?.x ?? Infinity) + (badgeBox?.width ?? 0)).toBeLessThanOrEqual(h1Box?.x ?? -1);
    const art = page.locator("[data-hero-badge-art]");
    const spin = await art.evaluate((svg) => {
      const style = getComputedStyle(svg);
      return { name: style.animationName, duration: style.animationDuration, count: style.animationIterationCount, state: style.animationPlayState };
    });
    expect(spin).toEqual({ name: "spin", duration: "30s", count: "infinite", state: "running" });
    await badge.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Play the badge animation" })).toBeFocused();
    expect(await art.evaluate((svg) => getComputedStyle(svg).animationPlayState)).toBe("paused");
  });

  test("holds still, and isn't a control, under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    await expect(page.getByRole("button", { name: /badge animation/ })).toHaveCount(0);
    expect(await page.locator("[data-hero-badge-art]").evaluate((svg) => getComputedStyle(svg).animationName)).toBe("none");
  });

  test("is hidden below 1024px", async ({ page }) => {
    await page.setViewportSize({ width: 1023, height: 800 });
    await openHome(page);
    await expect(page.locator("[data-hero-badge]")).toBeHidden();
  });
});
