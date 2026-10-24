import { expect, test, type Locator, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The home rails' auto-scroll in a real browser (owner, 23 Oct 2026: "make
 * them automatically scroll", "as smooth as the very initial one done to
 * simulate DICE"; 24 Oct 2026: "make it go from one end of screen to next";
 * components/home/useRailAutoScroll.ts): an endless marquee, the cards
 * drifting at 60px/s from the right edge of the screen to the left, looping
 * seamlessly on copies of the cards (hidden from assistive tech and out of
 * the tab order, but clickable). Live mode with /api/* answered
 * here: two events this weekend (a pair, which never auto-scrolls; on a
 * Friday to Sunday the next few events fall in the weekend too) and the rest
 * in Coming up, which overflows at both widths.
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

const scrollLeft = (rail: Locator) => rail.evaluate((ul) => ul.scrollLeft);
const snapType = (rail: Locator) => rail.evaluate((ul) => getComputedStyle(ul).scrollSnapType);
const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const copies = (rail: Locator) => rail.locator(":scope > li[data-rail-clone]");
const realCards = (rail: Locator) => rail.locator(":scope > li:not([data-rail-clone])");

/** The loop's seam in scrollLeft terms (as `railLoop`): the first real card's offset, one set's width, the gap. */
function loopOf(rail: Locator) {
  return rail.evaluate((ul) => {
    const first = ul.querySelector(":scope > li:not([data-rail-clone])");
    const copy = ul.querySelector(":scope > li[data-rail-clone]");
    const railLeft = ul.getBoundingClientRect().left + ul.clientLeft;
    const firstLeft = first?.getBoundingClientRect().left ?? 0;
    return {
      start: ul.scrollLeft + firstLeft - railLeft,
      period: (copy?.getBoundingClientRect().left ?? firstLeft) - firstLeft,
      gap: parseFloat(getComputedStyle(ul).columnGap) || 0,
    };
  });
}

interface Frame {
  /** The rail's scrollLeft. */
  left: number;
  /** The title of the leftmost card in view, and how far its left edge is from the rail's (negative: cut off). */
  title: string;
  firstLeft: number;
  /** How far the rightmost card in view ends from the rail's right edge (negative: cut off). */
  lastRight: number;
}
/** Every frame for `ms`: where the rail is and which card is at its left edge, sampled in the page. */
function watch(rail: Locator, ms: number): Promise<Frame[]> {
  return rail.evaluate(
    (ul, total) =>
      new Promise<Frame[]>((resolve) => {
        const out: Frame[] = [];
        let t0: number | undefined;
        const frame = (now: number) => {
          t0 ??= now;
          const box = ul.getBoundingClientRect();
          const left = box.left + ul.clientLeft;
          const right = left + ul.clientWidth;
          const inView = Array.from(ul.querySelectorAll(":scope > li"))
            .map((li) => ({ box: li.getBoundingClientRect(), title: li.querySelector("h3")?.textContent ?? "" }))
            .filter((card) => card.box.right > left + 0.5 && card.box.left < right - 0.5);
          const first = inView[0];
          const last = inView[inView.length - 1];
          out.push({
            left: ul.scrollLeft,
            title: first?.title ?? "",
            firstLeft: (first?.box.left ?? right) - left,
            lastRight: right - (last?.box.right ?? left),
          });
          if (now - t0 < total) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    ms,
  );
}

/** The rail's position with each wrap added back: the distance the marquee has really travelled. */
function unwrap(frames: Frame[], period: number): { travelled: number[]; wraps: number } {
  let wraps = 0;
  const travelled = frames.map((frame, i) => {
    if (i > 0 && frames[i - 1].left - frame.left > period / 2) wraps += 1;
    return frame.left + wraps * period;
  });
  return { travelled, wraps };
}

for (const width of [390, 1440]) {
  test.describe(`home rail auto-scroll at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 844 : 900 } });

    test("an endless marquee: edge to edge, always forward, and seamless across the loop, on hidden, untabbable copies", async ({ page }) => {
      const { section, rail } = await openHome(page, "no-preference");
      await expect.poll(() => snapType(rail)).toBe("none");
      // The copies: after the real cards, a whole set at least, hidden from assistive tech, not inert
      // (they're clickable), with nothing in them in the tab order.
      await expect.poll(() => copies(rail).count()).toBeGreaterThan(0);
      const real = await realCards(rail).count();
      expect(real).toBeGreaterThanOrEqual(5);
      expect((await copies(rail).count()) % real).toBe(0);
      const marked = await copies(rail).evaluateAll((lis) =>
        lis.map((li) => ({
          hidden: li.getAttribute("aria-hidden"),
          inert: (li as HTMLElement).inert,
          // Everything with a tab index (links, buttons, the Save heart, the ticket action) and what it is.
          tabIndexes: Array.from(li.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")).map((el) => el.tabIndex),
        })),
      );
      for (const copy of marked) {
        expect(copy.hidden).toBe("true");
        expect(copy.inert).toBe(false);
        expect(copy.tabIndexes.length).toBeGreaterThanOrEqual(2);
        expect(copy.tabIndexes.every((index) => index === -1)).toBe(true);
      }
      // Only the real cards are list items and links to assistive tech.
      await expect(rail.getByRole("listitem")).toHaveCount(real);
      const realLinks = await rail.evaluate((ul) => ul.querySelectorAll(":scope > li:not([data-rail-clone]) a[href]").length);
      await expect(rail.getByRole("link")).toHaveCount(realLinks);
      // A pair (This weekend with two events; on a weekend the fixtures give it more) never moves and has no copies.
      const pairs = page.locator("[data-home-section]").filter({ has: page.locator('[data-rail-layout="pair"]') });
      for (const pair of await pairs.all()) {
        await expect(pair.locator("li[data-rail-clone]")).toHaveCount(0);
        await expect(pair.getByRole("button", { name: /auto-scroll/ })).toHaveCount(0);
      }

      const titles = await realCards(rail).evaluateAll((lis) => lis.map((li) => li.querySelector("h3")?.textContent ?? ""));
      expect(new Set(titles).size).toBe(real);
      const loop = await loopOf(rail);
      expect(loop.period).toBeGreaterThan(0);
      // A script (not a person) puts the rail just before the seam: the drift carries on from there.
      await rail.evaluate((ul, at) => void (ul.scrollLeft = at), loop.start + loop.period - 150);
      const frames = await watch(rail, 5_000);

      // It wrapped, and every frame moved it a little further on: never back, never a jump.
      const { travelled, wraps } = unwrap(frames, loop.period);
      expect(wraps).toBeGreaterThanOrEqual(1);
      const moves = travelled.slice(1).map((value, i) => value - travelled[i]);
      expect(Math.min(...moves)).toBeGreaterThanOrEqual(-0.5);
      expect(Math.max(...moves)).toBeLessThan(10);
      // About 60px a second.
      const distance = travelled[travelled.length - 1] - travelled[0];
      expect(distance).toBeGreaterThan(200);
      expect(distance).toBeLessThan(400);
      // The card at the left edge only ever gives way to the next one in order, across the seam too.
      const seen = frames.map((frame) => frame.title).filter((title, i, all) => i === 0 || title !== all[i - 1]);
      expect(seen.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < seen.length; i++) {
        expect(titles.indexOf(seen[i]), `${seen[i - 1]} → ${seen[i]}`).toBe((titles.indexOf(seen[i - 1]) + 1) % real);
      }
      // Edge to edge: never more than a gap between the screen's edges and the cards.
      expect(Math.max(...frames.map((frame) => frame.firstLeft))).toBeLessThanOrEqual(loop.gap + 0.5);
      expect(Math.max(...frames.map((frame) => frame.lastRight))).toBeLessThanOrEqual(loop.gap + 0.5);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      await expect(section.getByRole("button", { name: "Pause auto-scroll: Coming up" })).toBeVisible();
    });

    test("Pause freezes it exactly where it is; Play carries on from there", async ({ page }) => {
      const { section, rail } = await openHome(page, "no-preference");
      const pause = section.getByRole("button", { name: "Pause auto-scroll: Coming up" });
      // A visible 44px control at every width (on phones the arrows are hidden, the Pause button isn't).
      await expect(pause).toBeVisible();
      const box = await pause.boundingBox();
      expect(Math.round(box?.width ?? 0)).toBe(44);
      expect(Math.round(box?.height ?? 0)).toBe(44);
      await expect(section.getByRole("button", { name: "Next events: Coming up" })).toBeVisible({ visible: width >= 640 });
      await expect.poll(() => scrollLeft(rail), { timeout: 5_000 }).toBeGreaterThan(30);

      await pause.click();
      const play = section.getByRole("button", { name: "Play auto-scroll: Coming up" });
      await expect(play).toBeVisible();
      const held = await scrollLeft(rail);
      await page.waitForTimeout(2_000);
      expect(await scrollLeft(rail)).toBe(held);
      // Frozen as a marquee: snapping stays off (turning it on would pull the rail to a card) and the copies stay.
      expect(await snapType(rail)).toBe("none");
      expect(await copies(rail).count()).toBeGreaterThan(0);

      // Watched from before the press: still at the held spot, then on from it, never a jump.
      const watching = watch(rail, 1_500);
      await play.click();
      await expect(section.getByRole("button", { name: "Pause auto-scroll: Coming up" })).toBeVisible();
      const frames = await watching;
      const moves = frames.slice(1).map((frame, i) => frame.left - frames[i].left);
      expect(frames[0].left).toBe(held);
      expect(Math.min(...moves)).toBeGreaterThanOrEqual(-0.5);
      expect(Math.max(...moves)).toBeLessThan(10);
      expect(frames[frames.length - 1].left - held).toBeGreaterThan(30);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("a click on a copy (the rail held under the pointer) opens its event, like the real card", async ({ page }) => {
      const { rail } = await openHome(page, "no-preference");
      const events = fixtures(Date.now());
      await page.route("**/api/events/slug/**", (route) => {
        const slug = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
        const event = events.find((e) => e.slug === slug);
        return event ? route.fulfill({ json: event }) : route.fulfill({ status: 404, json: { error: "not found" } });
      });
      await expect.poll(() => copies(rail).count()).toBeGreaterThan(0);
      const loop = await loopOf(rail);
      // The first copy part way in from the right edge, the last real cards to its left.
      await rail.evaluate((ul, period) => void (ul.scrollLeft = period - ul.clientWidth * 0.6), loop.start + loop.period);
      // The pointer over the rail holds it, as for a person about to click.
      const railBox = await rail.boundingBox();
      await page.mouse.move((railBox?.x ?? 0) + 10, (railBox?.y ?? 0) + 60);
      const target = await rail.evaluate((ul) => {
        const copy = ul.querySelector<HTMLElement>(":scope > li[data-rail-clone]");
        const media = copy?.querySelector("[data-card-media]")?.getBoundingClientRect();
        const railBox = ul.getBoundingClientRect();
        if (!copy || !media) return null;
        // The middle of the copy's image where it's on screen (clear of the Save heart in its corner).
        const x = (Math.max(media.left, railBox.left) + Math.min(media.right, railBox.right)) / 2;
        const y = media.top + media.height * 0.6;
        const hit = document.elementFromPoint(x, y);
        return {
          x,
          y,
          onCopy: !!hit?.closest("li[data-rail-clone]"),
          href: copy.querySelector("[data-card-link]")?.getAttribute("href") ?? "",
          title: copy.querySelector("h3")?.textContent?.trim() ?? "",
        };
      });
      expect(target?.onCopy).toBe(true);
      expect(target?.href).toMatch(/^\/events\/[^/#?]+$/);
      await page.mouse.click(target?.x ?? 0, target?.y ?? 0);
      await expect(page).toHaveURL(new RegExp(`${target?.href}$`), { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(target?.title ?? "", { timeout: 30_000 });
    });

    test("Tab through the rail reaches only the real cards", async ({ page }) => {
      const { section, rail } = await openHome(page, "no-preference");
      await expect.poll(() => copies(rail).count()).toBeGreaterThan(0);
      // From the section's last control before the rail (Next from 640px, Pause on phones).
      const before = section.getByRole("button", { name: width >= 640 ? "Next events: Coming up" : "Pause auto-scroll: Coming up" });
      await before.focus();
      const stops: { inRail: boolean; inCopy: boolean; card: number }[] = [];
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press("Tab");
        const stop = await page.evaluate(() => {
          const el = document.activeElement;
          const ul = document.getElementById("home-popular-rail");
          const li = el?.closest("#home-popular-rail > li");
          return {
            inRail: !!(ul && el && ul.contains(el)),
            inCopy: !!el?.closest("[data-rail-clone]"),
            card: ul && li ? Array.from(ul.children).indexOf(li) : -1,
          };
        });
        if (!stop.inRail && stops.some((s) => s.inRail)) break;
        stops.push(stop);
      }
      const inRail = stops.filter((s) => s.inRail);
      const real = await realCards(rail).count();
      expect(inRail.length).toBeGreaterThanOrEqual(real);
      expect(inRail.some((s) => s.inCopy)).toBe(false);
      // Every real card in turn, and nothing after the last.
      expect([...new Set(inRail.map((s) => s.card))]).toEqual(Array.from({ length: real }, (_, i) => i));
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("a sideways wheel is the visitor taking over: it stops, snaps on a card, and the copies go without a jump", async ({ page }) => {
      const { section, rail } = await openHome(page, "no-preference");
      await expect.poll(() => snapType(rail)).toBe("none");
      await expect.poll(() => copies(rail).count()).toBeGreaterThan(0);
      const box = await rail.boundingBox();
      await page.mouse.move((box?.x ?? 0) + 100, (box?.y ?? 0) + 100);
      await page.mouse.wheel(300, 0);
      await expect(section.getByRole("button", { name: "Play auto-scroll: Coming up" })).toBeVisible();
      await expect.poll(() => snapType(rail)).toContain("mandatory");
      // Near the start no copy is in view, so they go, and the rail doesn't move when they do.
      await expect.poll(() => copies(rail).count()).toBe(0);
      await page.mouse.move(1, 1);
      const held = await scrollLeft(rail);
      await page.waitForTimeout(2_000);
      expect(await scrollLeft(rail)).toBe(held);
      await expect(rail.getByRole("listitem")).toHaveCount(await realCards(rail).count());
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("taking over with copies in view keeps them rather than jumping, and the rail stays put", async ({ page }) => {
      const { section, rail } = await openHome(page, "no-preference");
      await expect.poll(() => copies(rail).count()).toBeGreaterThan(0);
      const loop = await loopOf(rail);
      // Straddling the seam: the last real cards on the left, the first copies on the right.
      await rail.evaluate((ul, at) => void (ul.scrollLeft = at), loop.start + loop.period - 300);
      await page.waitForTimeout(300);
      const box = await rail.boundingBox();
      await page.mouse.move((box?.x ?? 0) + 100, (box?.y ?? 0) + 100);
      await page.mouse.wheel(40, 0);
      await expect(section.getByRole("button", { name: "Play auto-scroll: Coming up" })).toBeVisible();
      await expect.poll(() => snapType(rail)).toContain("mandatory");
      await page.mouse.move(1, 1);
      await page.waitForTimeout(1_000);
      const held = await scrollLeft(rail);
      expect(await copies(rail).count()).toBeGreaterThan(0);
      await page.waitForTimeout(1_500);
      expect(await scrollLeft(rail)).toBe(held);
      // Still hidden: the real cards are still the only list items.
      await expect(rail.getByRole("listitem")).toHaveCount(await realCards(rail).count());
    });

    test("Next pressed mid-drift pages smoothly onto a card, never jumping back first", async ({ page }) => {
      test.skip(width < 640, "the arrows are from 640px");
      const { section, rail } = await openHome(page, "no-preference");
      await expect.poll(() => snapType(rail)).toBe("none");
      // Between two cards (the drift has been going for a moment).
      await expect.poll(() => scrollLeft(rail), { timeout: 5_000 }).toBeGreaterThan(40);
      const frames = watch(rail, 2_000);
      await section.getByRole("button", { name: "Next events: Coming up" }).click();
      const seen = (await frames).map((frame) => frame.left);
      expect(Math.min(...seen.slice(1).map((value, i) => value - seen[i]))).toBeGreaterThanOrEqual(-1);
      await expect(section.getByRole("button", { name: "Play auto-scroll: Coming up" })).toBeVisible();
      await expect.poll(() => snapType(rail)).toContain("mandatory");
      // On a card's start.
      const landed = await rail.evaluate((ul) => {
        const inset = parseFloat(getComputedStyle(ul).paddingInlineStart) || 0;
        const start = ul.getBoundingClientRect().left + ul.clientLeft + inset;
        const onCard = Array.from(ul.querySelectorAll(":scope > li")).some((li) => Math.abs(li.getBoundingClientRect().left - start) < 2);
        return { onCard, left: ul.scrollLeft };
      });
      expect(landed.onCard, JSON.stringify(landed)).toBe(true);
    });

    test("under reduced motion it never moves: no copies and no Pause button", async ({ page }) => {
      const { section, rail } = await openHome(page, "reduce");
      await expect(section.getByRole("button", { name: /auto-scroll/ })).toHaveCount(0);
      await page.waitForTimeout(3_000);
      expect(await scrollLeft(rail)).toBe(0);
      await expect(copies(rail)).toHaveCount(0);
      expect(await snapType(rail)).toContain("mandatory");
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
}
