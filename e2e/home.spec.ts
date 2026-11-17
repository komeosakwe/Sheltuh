import { expect, test, type Locator, type Page } from "@playwright/test";
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
type MockOptions = {
  trending?: boolean;
  going?: number;
  lead?: string;
  /** Changes to some events, by slug (a state, a banner fit). */
  edits?: Record<string, Partial<PublicEvent>>;
};

async function mockApi(page: Page, { trending = false, going, lead, edits = {} }: MockOptions = {}) {
  const events = fixtures(Date.now())
    .map((event) => ({ ...event, ...edits[event.slug] }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
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
      // `lead`: that event's slide comes first (the rest are the last three).
      const leading = lead ? events.filter((event) => event.slug === lead) : [];
      const items = [...leading, ...events.filter((event) => event.slug !== lead).slice(-(4 - leading.length))].map((event, i) =>
        going !== undefined && i === 0 ? { event, label: "going", goingCount: going } : { event, label: "popular" },
      );
      return route.fulfill({ json: { items } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

async function openHome(page: Page, options?: MockOptions) {
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

// The rules' Layout board: 1312px of content, four 304px cards at 1440 (64px margins from 1280: 264px there); three
// from 1024, two from 768, one below 768 (Round 2 §1.2).
const VIEWPORTS = [
  { name: "desktop 1440×900", width: 1440, height: 900, columns: 4, card: 304 },
  { name: "desktop 1280×800", width: 1280, height: 800, columns: 4, card: 264 },
  { name: "laptop 1024×768", width: 1024, height: 768, columns: 3, card: 298.67 },
  { name: "tablet 768×1024", width: 768, height: 1024, columns: 2, card: 340 },
  { name: "small tablet 700×900", width: 700, height: 900, columns: 1, card: 668 },
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

// The proposal's banner (redesign PR 3; Round 2 §1.1): the WAI carousel pattern, a stretched title link and dots plus Pause.
test.describe("the featured carousel at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const current = (page: Page) =>
    page.locator("[data-featured-carousel] [data-slide]").evaluateAll((slides) => slides.findIndex((s) => s.hasAttribute("data-current")));

  test("each slide: the category alone (no 'Featured'), the title as its one link, 'date · venue' (no time or price), its own ticket action, no Details", async ({ page }) => {
    await openHome(page, { trending: true });
    const carousel = page.getByRole("region", { name: "Popular right now" });
    const slide = carousel.locator("[data-slide][data-current]");
    await expect(slide).toHaveAttribute("aria-label", /^1 of \d$/);
    await expect(carousel).not.toContainText(/Featured/i);
    await expect(slide.locator("p.mono-s").first()).toHaveText(/^(Live music|Art|Workshop|Pop-up|Theatre)$/);
    const facts = slide.locator("[data-slide-facts]");
    await expect(facts).toHaveText(/^(\w{3} \d{1,2} \w{3}|Now on · until .+) · .+$/);
    await expect(facts).not.toHaveText(/A\$|\d(?:am|pm)\b/);
    await expect(slide.locator("[data-banner-link]")).toHaveAttribute("href", /^\/events\/[^/#]+$/);
    await expect(carousel.getByRole("link", { name: /^Details: / })).toHaveCount(0);
    await expect(carousel.getByRole("button", { name: /Previous slide|Next slide/ })).toHaveCount(0);
    // Mixed case, never upper-cased by CSS (Round 2 §1.7); 40px from 1280px.
    const title = slide.locator("h3");
    expect(await title.evaluate((el) => getComputedStyle(el).textTransform)).toBe("none");
    expect(await title.evaluate((el) => getComputedStyle(el).fontSize)).toBe("40px");
    // Only the current slide is reachable: the others are inert.
    await expect(carousel.locator("[data-slide]:not([data-current])[inert]")).toHaveCount((await carousel.locator("[data-slide]").count()) - 1);
    // No interactive element inside another (axe's nested-interactive).
    expect(await carousel.evaluate((el) => el.querySelectorAll("a a, a button, button a, button button").length)).toBe(0);
  });

  test("a click anywhere on the slide but Buy tickets and the controls opens the event; Buy tickets goes to the tickets", async ({ page }) => {
    await openHome(page, { trending: true });
    const carousel = page.getByRole("region", { name: "Popular right now" });
    await carousel.getByRole("button", { name: "Pause carousel" }).click();
    const slide = carousel.locator("[data-slide][data-current]");
    const href = await slide.locator("[data-banner-link]").getAttribute("href");
    const buy = slide.locator(".btn").first();
    await expect(buy).toBeVisible();
    // Hit-test: the photo's top-left, the facts line and the title all land on the title's link; Buy tickets on itself.
    const box = await slide.boundingBox();
    const factsBox = await slide.locator("[data-slide-facts]").boundingBox();
    if (!box || !factsBox) throw new Error("slide not laid out");
    const hit = (x: number, y: number) =>
      page.evaluate(([px, py]) => {
        const el = document.elementFromPoint(px, py);
        return el?.closest("a, button")?.hasAttribute("data-banner-link") === true ? "title" : (el?.closest("a, button")?.getAttribute("aria-label") ?? "none");
      }, [x, y] as const);
    expect(await hit(box.x + 24, box.y + 24)).toBe("title");
    expect(await hit(factsBox.x + 4, factsBox.y + factsBox.height / 2)).toBe("title");
    const buyBox = await buy.boundingBox();
    if (!buyBox) throw new Error("no ticket action");
    expect(await hit(buyBox.x + buyBox.width / 2, buyBox.y + buyBox.height / 2)).toMatch(/^(Buy tickets|Free tickets|Choose seats|Join waitlist): /);
    await page.mouse.click(box.x + box.width / 2, box.y + 24);
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });

  test("tabs Pause, the dots, the title, then the ticket action; the title underlines on focus with a visible ring", async ({ page }) => {
    await openHome(page, { trending: true });
    const carousel = page.getByRole("region", { name: "Popular right now" });
    const pause = carousel.getByRole("button", { name: "Pause carousel" });
    await pause.focus();
    const order: string[] = [];
    for (let i = 0; i < 12; i++) {
      const name = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest("[data-featured-carousel]")) return null;
        return el.hasAttribute("data-banner-link") ? "title" : (el.getAttribute("aria-label") ?? el.textContent ?? "");
      });
      if (name === null) break;
      order.push(name);
      await page.keyboard.press("Tab");
    }
    const dotCount = await carousel.getByRole("list", { name: "Slides" }).getByRole("button").count();
    expect(order[0]).toBe("Pause carousel");
    expect(order.slice(1, 1 + dotCount).every((name) => /^Slide \d: /.test(name))).toBe(true);
    expect(order[1 + dotCount]).toBe("title");
    expect(order[2 + dotCount]).toMatch(/^(Buy tickets|Free tickets|Choose seats|Join waitlist): /);
    const title = carousel.locator("[data-slide][data-current] [data-banner-link]");
    await title.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(title).toBeFocused();
    // Once the 200ms ease settles: a white ring, and the underline in the text's colour.
    await expect
      .poll(() =>
        title.evaluate((el) => {
          const style = getComputedStyle(el);
          return { outline: style.outlineStyle, outlineColor: style.outlineColor, underlined: style.textDecorationColor === style.color };
        }),
      )
      .toEqual({ outline: "solid", outlineColor: "rgb(255, 255, 255)", underlined: true });
  });

  test("advances by itself, never moving focus; Pause stops it; the dots move it and take over", async ({ page }) => {
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

    await carousel.getByRole("button", { name: /^Slide 3: / }).click();
    await expect.poll(() => current(page)).toBe(2);
    await carousel.getByRole("button", { name: /^Slide 1: / }).click();
    await expect.poll(() => current(page)).toBe(0);
    await expect(carousel.getByRole("button", { name: /^Slide 1: / })).toHaveAttribute("aria-current", "true");
    // A 40px Pause/Play from md, over the photo's bottom-right (48px in from 1024px), with a visible ring.
    const play = carousel.getByRole("button", { name: "Play carousel" });
    const [playBox, slideBox, pillBox] = await Promise.all([
      play.boundingBox(),
      page.locator("#home-featured-slides").boundingBox(),
      carousel.getByRole("list", { name: "Slides" }).boundingBox(),
    ]);
    if (!playBox || !slideBox || !pillBox) throw new Error("not laid out");
    expect(playBox.height).toBe(40);
    expect(Math.round(slideBox.y + slideBox.height - (pillBox.y + pillBox.height))).toBe(48);
    expect(Math.round(slideBox.x + slideBox.width - (pillBox.x + pillBox.width))).toBe(48);
    expect(playBox.x + playBox.width).toBeLessThanOrEqual(pillBox.x);
    await play.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await play.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    // A dot's ring is black on the white pill.
    const dot = carousel.getByRole("button", { name: /^Slide 2: / });
    await dot.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect.poll(() => dot.evaluate((el) => getComputedStyle(el).outlineColor)).toBe("rgb(0, 0, 0)");
  });

  test("under reduced motion it never moves by itself and has no Pause", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page, { trending: true });
    const carousel = page.getByRole("region", { name: "Popular right now" });
    await expect(carousel.getByRole("button", { name: /^Slide 1: / })).toBeVisible();
    await expect(carousel.getByRole("button", { name: /Pause carousel|Play carousel/ })).toHaveCount(0);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(7_000);
    expect(await current(page)).toBe(0);
  });
});

// Round 2 §1.1: 5:2 from 1024px (1312×525 at 1440, 1136×454 at 1200), the title 40px from 1280px and 32px below it.
for (const { width, w, h, title } of [
  { width: 1440, w: 1312, h: 525, title: "40px" },
  { width: 1200, w: 1136, h: 454, title: "32px" },
  { width: 1024, w: 960, h: 384, title: "32px" },
]) {
  test.describe(`the featured carousel at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test(`is ${w}×${h}, with no text box and the title at ${title}`, async ({ page }) => {
      await openHome(page, { trending: true });
      const slide = page.locator("[data-featured-carousel] [data-slide][data-current]");
      const box = await slide.boundingBox();
      if (!box) throw new Error("slide not laid out");
      expect(Math.round(box.width)).toBe(w);
      expect(Math.abs(box.height - h)).toBeLessThanOrEqual(1);
      await expect(slide.locator("[data-slide-panel]")).toHaveCount(0);
      expect(await slide.locator("[data-slide-content]").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
      expect(await slide.locator("h3").evaluate((el) => getComputedStyle(el).fontSize)).toBe(title);
      expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
    });
  });
}

// Round 2 review: at the card's 2:1 and the banner's 5:2, an ordinary 3:2 photo fills its box (object-fit: cover),
// never pillarboxed on a blurred copy; only a portrait poster is shown whole. With no imageFocus, the banner's
// photo takes its per-breakpoint focal default (50% 50% on phones, 50% 35% from 1024px). Neon Static's demo
// photo is 1080×720.
for (const { width, height, focus } of [
  { width: 1440, height: 900, focus: "50% 35%" },
  { width: 390, height: 844, focus: "50% 50%" },
]) {
  test.describe(`a 3:2 photo at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test("covers its box in a card and in the banner, with no blurred backdrop", async ({ page }) => {
      await openHome(page, { trending: true, lead: "neon-static" });
      const fitOf = (img: Locator) =>
        img.evaluate(async (el: HTMLImageElement) => {
          if (!el.complete) await new Promise((resolve) => el.addEventListener("load", resolve, { once: true }));
          const style = getComputedStyle(el);
          return { ratio: el.naturalWidth / el.naturalHeight, fit: style.objectFit, position: style.objectPosition };
        });

      const slide = page.locator("[data-featured-carousel] [data-slide][data-current]");
      await expect(slide.getByRole("link", { name: "Neon Static", exact: true })).toBeAttached();
      const banner = await fitOf(slide.locator("img"));
      expect(banner.ratio).toBeCloseTo(1.5, 2);
      expect(banner.fit).toBe("cover");
      expect(banner.position).toBe(focus);
      await expect(slide.locator("[data-art-backdrop]")).toHaveCount(0);

      const card = page.locator("[data-event-card]:has(a[href='/events/neon-static'])").first();
      await card.scrollIntoViewIfNeeded();
      const inCard = await fitOf(card.locator("[data-card-media] img"));
      expect(inCard.ratio).toBeCloseTo(1.5, 2);
      expect(inCard.fit).toBe("cover");
      await expect(card.locator("[data-art-backdrop]")).toHaveCount(0);
    });
  });
}

// Round 2 Part 2: "Show the whole photo in the home banner" (bannerFit "whole"): the banner shows the whole photo,
// centred on its blurred backdrop, with no focal default; the event's card still crops it to fill.
for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`a whole-photo banner at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test("contains the photo on its blurred backdrop; the card still covers", async ({ page }) => {
      await openHome(page, { trending: true, lead: "neon-static", edits: { "neon-static": { bannerFit: "whole" } } });
      const slide = page.locator("[data-featured-carousel] [data-slide][data-current]");
      await expect(slide.getByRole("link", { name: "Neon Static", exact: true })).toBeAttached();
      const img = slide.locator("img");
      const banner = await img.evaluate(async (el: HTMLImageElement) => {
        if (!el.complete) await new Promise((resolve) => el.addEventListener("load", resolve, { once: true }));
        const style = getComputedStyle(el);
        return { fit: style.objectFit, position: style.objectPosition, className: el.className };
      });
      expect(banner.fit).toBe("contain");
      expect(banner.position).toBe("50% 50%");
      expect(banner.className).not.toMatch(/object-\[/);
      await expect(slide.locator("[data-art-backdrop]")).toHaveCount(1);
      // The words keep their scrim, and nothing scrolls sideways.
      await expect(slide.locator("[data-slide-scrim]")).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`whole-banner-${width}.png`) });

      const card = page.locator("[data-event-card]:has(a[href='/events/neon-static'])").first();
      await card.scrollIntoViewIfNeeded();
      expect(await card.locator("[data-card-media] img").evaluate((el) => getComputedStyle(el).objectFit)).toBe("cover");
      expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
    });
  });
}

// Round 2 Part 2: with a saved suburb (browser-only, `sheltuh:near:v1`), This weekend shows only its state's events
// (the owner's amendment: filter by location before artist grouping), and All events stops saying "Across Australia".
test.describe("This weekend with a saved suburb", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  const [nsw, vic] = sampleEvents;
  const edits = { [nsw.slug]: { state: "NSW" as const, suburb: "Newtown" } };

  /** Saves `saved` as the visitor's suburb before the page loads, then opens the home. */
  async function openSaved(page: Page, saved: { suburb: string; state?: string } | null) {
    if (saved) {
      await page.addInitScript((value) => window.localStorage.setItem("sheltuh:near:v1", value), JSON.stringify(saved));
    }
    await openHome(page, { edits });
    // The saved state is read after hydration: wait for the list the home settles on.
    await expect(page.getByRole("list", { name: "All events", exact: true })).toBeVisible();
  }

  test("none saved: both weekend events, Australia-wide", async ({ page }) => {
    await openSaved(page, null);
    // (During the weekend itself the other fixtures, starting soon, may be in it too: all of them Victorian.)
    await expect(page.getByRole("list", { name: "This weekend", exact: true }).getByText(nsw.title)).toBeVisible();
    expect(await titlesIn(page, "This weekend")).toEqual(expect.arrayContaining([nsw.title, vic.title]));
    await expect(page.getByRole("region", { name: "All events" })).toContainText("Across Australia");
  });

  test("a saved NSW suburb: only the NSW event, and no Across Australia", async ({ page }) => {
    await openSaved(page, { suburb: "Newtown", state: "NSW" });
    await expect(page.getByRole("list", { name: "This weekend", exact: true }).locator("[data-event-card]")).toHaveCount(1);
    expect(await titlesIn(page, "This weekend")).toEqual([nsw.title]);
    await expect(page.getByRole("region", { name: "All events" })).not.toContainText("Across Australia");
  });

  test("a saved VIC suburb (an entry saved before states were: 'Fitzroy VIC'): only the VIC event", async ({ page }) => {
    await openSaved(page, { suburb: "Fitzroy VIC" });
    await expect(page.getByRole("list", { name: "This weekend", exact: true }).getByText(vic.title)).toBeVisible();
    const titles = await titlesIn(page, "This weekend");
    expect(titles).not.toContain(nsw.title);
    expect(titles).toContain(vic.title);
  });

  test("a saved state with no weekend events: the section hides", async ({ page }) => {
    await openSaved(page, { suburb: "Perth", state: "WA" });
    await expect(page.getByRole("heading", { name: "This weekend" })).toHaveCount(0);
  });
});

// Round 2 §1.1: 4:5 below 640px; the words grow the slide rather than being cut off, and Buy tickets stays clear of the controls.
for (const width of [320, 390]) {
  test.describe(`the featured carousel at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("the slide is at least 4:5, its words (category to the ticket action) wholly inside it and clear of the dots and Pause", async ({ page }) => {
      await openHome(page, { trending: true });
      const slide = page.locator("[data-featured-carousel] [data-slide][data-current]");
      const [box, eyebrow, action, controls] = await Promise.all([
        slide.boundingBox(),
        slide.locator("[data-slide-content] p").first().boundingBox(),
        slide.locator("[data-slide-content] .btn").first().boundingBox(),
        page.locator("[data-featured-carousel] [data-carousel-controls]").boundingBox(),
      ]);
      if (!box || !eyebrow || !action || !controls) throw new Error("slide not laid out");
      expect(box.height).toBeGreaterThanOrEqual(box.width * 1.25 - 1);
      expect(eyebrow.y).toBeGreaterThanOrEqual(box.y);
      expect(action.y + action.height).toBeLessThanOrEqual(box.y + box.height);
      expect(action.y + action.height).toBeLessThanOrEqual(controls.y);
      expect(controls.y + controls.height).toBeLessThanOrEqual(box.y + box.height);
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

  test("All events shows its first eight, with no Show more: See all events at the bottom leads to the full list", async ({ page }) => {
    await openHome(page);
    const section = page.getByRole("region", { name: "All events" });
    const grid = page.getByRole("list", { name: "All events", exact: true });
    await expect(grid.locator("[data-event-card]")).toHaveCount(8);
    // Whole rows at every width: two of four from 1280px, two of three from 1024px, three of two from 768px, four in one column below.
    for (const [width, cards] of [
      [1024, 6],
      [768, 6],
      [700, 4],
      [390, 4],
      [1440, 8],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await expect(grid.locator("[data-event-card]")).toHaveCount(cards);
    }
    await expect(section.getByRole("button", { name: /Show more/ })).toHaveCount(0);
    const bottom = section.locator("[data-all-events-more]");
    await expect(bottom).toHaveAccessibleName("See all events");
    await expect(bottom).toHaveAttribute("href", "/events");
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
      // All events has two, the head's and the bottom's (Round 2: in place of Show more), both to /events.
      const seeAll = page.getByRole("region", { name: "All events" }).getByRole("link", { name: "See all events" });
      await expect(seeAll).toHaveCount(2);
      for (const link of await seeAll.all()) await expect(link).toHaveAttribute("href", "/events");
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

// The scene cards under the band (the owner's mockup, real data only): three equal columns from
// 1024px, a sideways row bleeding to the edges below it, and never the page scrolling sideways.
const SCENES = [
  { name: "Live music", category: "live-music" },
  { name: "Art", category: "art" },
  { name: "Pop-ups", category: "pop-up" },
];
for (const vp of [
  { width: 1440, height: 900, row: false },
  { width: 1024, height: 768, row: false },
  { width: 390, height: 844, row: true },
  { width: 320, height: 640, row: true },
]) {
  test.describe(`Find your people's scene cards at ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("Live music, Art and Pop-ups, each its own event's photo and one link to its listing, with no invented counts", async ({ page }) => {
      await openHome(page, { trending: true, going: 22 });
      const list = page.getByRole("list", { name: "Scenes", exact: true });
      await list.scrollIntoViewIfNeeded();
      const items = list.getByRole("listitem");
      await expect(items).toHaveCount(3);
      for (const [i, scene] of SCENES.entries()) {
        const item = items.nth(i);
        await expect(item.getByRole("heading", { level: 3 })).toHaveText(scene.name);
        await expect(item.getByRole("link")).toHaveCount(1);
        await expect(item.getByRole("link", { name: `See events: ${scene.name}` })).toHaveAttribute("href", `/events?category=${scene.category}`);
        // The fixtures have events in all three: each shows its lead event's art, never the fallback tile.
        await expect(item.locator("[data-scene-media] [aria-hidden='true']").first()).toBeVisible();
        await expect(item.locator("[data-scene-fallback]")).toHaveCount(0);
        // Every upcoming event was served (no next cursor), so the event count is the whole number.
        await expect(item.locator("[data-scene-meta]")).toHaveText(/^(\d+ events? this month|\d+ upcoming)$/);
      }
      // The only real going count is 22, on an event weeks away: no "going this week" anywhere.
      await expect(list.locator("[data-scene-going]")).toHaveCount(0);
      await expect(page.locator("[data-scenes-note]")).toHaveCount(0);
      await expect(page.locator("#find-your-people")).not.toContainText(/friends|members|follow/i);

      const boxes = await Promise.all([0, 1, 2].map(async (i) => items.nth(i).boundingBox()));
      if (boxes.some((box) => !box)) throw new Error("scene cards not laid out");
      const [a, b, c] = boxes as NonNullable<(typeof boxes)[number]>[];
      if (vp.row) {
        // The home's phone row: 288px cards side by side, the next one peeking in.
        expect(Math.round(a.width)).toBe(288);
        expect(b.y).toBeCloseTo(a.y, 0);
        expect(b.x).toBeGreaterThan(a.x + a.width);
      } else {
        // Three equal columns on one row, filling the band's width.
        const band = await page.locator("[data-community-band]").boundingBox();
        if (!band) throw new Error("band not laid out");
        expect(Math.abs(a.width - b.width)).toBeLessThan(1);
        expect(Math.abs(b.width - c.width)).toBeLessThan(1);
        expect(b.y).toBeCloseTo(a.y, 0);
        expect(c.y).toBeCloseTo(a.y, 0);
        expect(a.x).toBeCloseTo(band.x, 0);
        expect(c.x + c.width).toBeCloseTo(band.x + band.width, 0);
      }
      // The link is reachable by keyboard, with the visible focus ring, and is big enough to tap.
      const link = items.nth(1).getByRole("link");
      await link.focus();
      await expect(link).toBeFocused();
      expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
      expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("Find your people's scene cards: the whole card opens the listing", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a click on Art's photo opens /events?category=art", async ({ page }) => {
    // /events asks for recently ended events too (openHome's mock refuses those), so serve both pages here.
    const events = fixtures(Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    await page.route("**/api/**", (route) =>
      new URL(route.request().url()).pathname === "/api/events"
        ? route.fulfill({ json: { items: events, nextCursor: undefined } })
        : route.fulfill({ status: 404, json: { error: "not mocked in e2e" } }),
    );
    await page.goto("/");
    const art = page.getByRole("list", { name: "Scenes", exact: true }).getByRole("listitem").nth(1);
    const media = art.locator("[data-scene-media]");
    await media.scrollIntoViewIfNeeded();
    // A real click on the photo's middle: the card's one link covers the card, so it takes the click.
    const box = await media.boundingBox();
    if (!box) throw new Error("photo not laid out");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/events\?category=art$/, { timeout: 30_000 });
  });
});

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
