import { expect, test, type Locator, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { weekendWindow } from "@/lib/home-sections";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The home rails' auto-scroll in a real browser (owner, 23 Oct 2026: "make
 * them automatically scroll", then "as smooth as the very initial one done to
 * simulate DICE"; components/home/useRailAutoScroll.ts): the original
 * carousel's continuous 60px/s drift, a 2s hold at the far end and an eased
 * glide back. Live mode with /api/* answered here: two events this weekend (a
 * pair, which never auto-scrolls) and eight more in Coming up, which
 * overflows at both widths.
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

/** The rail's scrollLeft every `every` ms for `ms`, sampled in the page (no round trips between samples). */
function sample(rail: Locator, ms: number, every: number): Promise<number[]> {
  return rail.evaluate(
    (ul, [total, step]) =>
      new Promise<number[]>((resolve) => {
        const out = [ul.scrollLeft];
        const timer = setInterval(() => {
          out.push(ul.scrollLeft);
          if (out.length > total / step) {
            clearInterval(timer);
            resolve(out);
          }
        }, step);
      }),
    [ms, every] as const,
  );
}
const steps = (values: number[]) => values.slice(1).map((value, i) => value - values[i]);

for (const width of [390, 1440]) {
  test.describe(`home rail auto-scroll at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 844 : 900 } });

    test("drifts on by itself, smoothly, a few pixels at a time with snapping off, and Pause stops it on a card", async ({ page }) => {
      const { section, rail } = await openHome(page, "no-preference");
      const pause = section.getByRole("button", { name: "Pause auto-scroll: Coming up" });
      // A visible 44px control at every width (on phones the arrows are hidden, the Pause button isn't).
      await expect(pause).toBeVisible();
      const box = await pause.boundingBox();
      expect(Math.round(box?.width ?? 0)).toBe(44);
      expect(Math.round(box?.height ?? 0)).toBe(44);
      await expect(section.getByRole("button", { name: "Next events: Coming up" })).toBeVisible({ visible: width >= 640 });

      // Snapping is off while it drifts (it would pull the rail back to a card).
      await expect.poll(() => snapType(rail)).toBe("none");
      // About 60px a second, continuously: every 100ms a few pixels on, never a card-sized jump.
      const samples = await sample(rail, 2000, 100);
      const moves = steps(samples);
      expect(moves.length).toBeGreaterThanOrEqual(19);
      expect(moves.filter((d) => d > 0).length).toBeGreaterThanOrEqual(moves.length - 1);
      expect(Math.min(...moves)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...moves)).toBeLessThan(20);
      const travelled = samples[samples.length - 1] - samples[0];
      expect(travelled).toBeGreaterThan(80);
      expect(travelled).toBeLessThan(160);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

      // Pause: it settles on a card (snapping back on), then stays there; the button now offers Play.
      await pause.click();
      const play = section.getByRole("button", { name: "Play auto-scroll: Coming up" });
      await expect(play).toBeVisible();
      await expect.poll(() => snapType(rail), { timeout: 3_000 }).toContain("mandatory");
      const onCard = await rail.evaluate((ul) => {
        const inset = parseFloat(getComputedStyle(ul).paddingInlineStart) || 0;
        const start = ul.getBoundingClientRect().left + ul.clientLeft + inset;
        return Array.from(ul.querySelectorAll(":scope > li")).some((li) => Math.abs(li.getBoundingClientRect().left - start) < 2);
      });
      expect(onCard).toBe(true);
      const held = await scrollLeft(rail);
      await page.waitForTimeout(3_000);
      expect(await scrollLeft(rail)).toBe(held);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("at the far end it holds, glides smoothly back to the start, and drifts on", async ({ page }) => {
      const { rail } = await openHome(page, "no-preference");
      await expect.poll(() => snapType(rail)).toBe("none");
      // A script (not a person) moves it near the end: the drift carries on from there.
      const max = await rail.evaluate((ul) => {
        const end = ul.scrollWidth - ul.clientWidth;
        ul.scrollLeft = end - 20;
        return end;
      });
      await expect.poll(() => scrollLeft(rail), { timeout: 3_000 }).toBeGreaterThanOrEqual(max - 1);
      // The hold: about 2 seconds at the end.
      const hold = await sample(rail, 1400, 100);
      expect(Math.min(...hold)).toBeGreaterThanOrEqual(max - 1);
      // The glide back: many small steps, all heading back, then on again from the start.
      const glide = await sample(rail, 3000, 50);
      const back = steps(glide).filter((d) => d < 0);
      expect(back.length).toBeGreaterThanOrEqual(15);
      expect(Math.max(...back.map(Math.abs))).toBeLessThan(max / 3);
      expect(Math.min(...glide)).toBeLessThan(40);
      await expect.poll(() => scrollLeft(rail), { timeout: 3_000 }).toBeGreaterThan(Math.min(...glide) + 10);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("a sideways wheel over the rail is the visitor taking over: it stops, with snapping back on", async ({ page }) => {
      const { section, rail } = await openHome(page, "no-preference");
      await expect.poll(() => snapType(rail)).toBe("none");
      const box = await rail.boundingBox();
      await page.mouse.move((box?.x ?? 0) + 100, (box?.y ?? 0) + 100);
      await page.mouse.wheel(300, 0);
      await expect(section.getByRole("button", { name: "Play auto-scroll: Coming up" })).toBeVisible();
      await expect.poll(() => snapType(rail)).toContain("mandatory");
      await page.mouse.move(1, 1);
      await page.waitForTimeout(1_000);
      const held = await scrollLeft(rail);
      await page.waitForTimeout(2_000);
      expect(await scrollLeft(rail)).toBe(held);
    });

    test("Next pressed mid-drift pages smoothly onto a card, never jumping back first", async ({ page }) => {
      test.skip(width < 640, "the arrows are from 640px");
      const { section, rail } = await openHome(page, "no-preference");
      await expect.poll(() => snapType(rail)).toBe("none");
      // Between two cards (the drift has been going for a moment).
      await expect.poll(() => scrollLeft(rail), { timeout: 5_000 }).toBeGreaterThan(40);
      const frames = rail.evaluate(
        (ul) =>
          new Promise<number[]>((resolve) => {
            const out: number[] = [];
            const start = performance.now();
            const frame = (now: number) => {
              out.push(ul.scrollLeft);
              if (now - start < 2000) requestAnimationFrame(frame);
              else resolve(out);
            };
            requestAnimationFrame(frame);
          }),
      );
      await section.getByRole("button", { name: "Next events: Coming up" }).click();
      const seen = await frames;
      expect(Math.min(...steps(seen))).toBeGreaterThanOrEqual(-1);
      await expect(section.getByRole("button", { name: "Play auto-scroll: Coming up" })).toBeVisible();
      await expect.poll(() => snapType(rail)).toContain("mandatory");
      // On a card's start, or at the rail's end (where the last card meets the column's edge).
      const landed = await rail.evaluate((ul) => {
        const inset = parseFloat(getComputedStyle(ul).paddingInlineStart) || 0;
        const start = ul.getBoundingClientRect().left + ul.clientLeft + inset;
        const onCard = Array.from(ul.querySelectorAll(":scope > li")).some((li) => Math.abs(li.getBoundingClientRect().left - start) < 2);
        return { onCard, atEnd: ul.scrollLeft >= ul.scrollWidth - ul.clientWidth - 1, left: ul.scrollLeft };
      });
      expect(landed.onCard || landed.atEnd, JSON.stringify(landed)).toBe(true);
    });

    test("under reduced motion it never moves, and there's no Pause button", async ({ page }) => {
      const { section, rail } = await openHome(page, "reduce");
      await expect(section.getByRole("button", { name: /auto-scroll/ })).toHaveCount(0);
      await page.waitForTimeout(3_000);
      expect(await scrollLeft(rail)).toBe(0);
      expect(await snapType(rail)).toContain("mandatory");
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
}
