import { expect, test, type Page } from "@playwright/test";

/**
 * The three faces in a real Chromium (app/fonts.ts, the redesign rules' Type
 * board): display headlines in Bootzy (its file really loads), running text,
 * headings and buttons in Instrument Sans, and the facts and eyebrows too,
 * as written (owner decision, 13 Nov 2026): IBM Plex Mono is only for
 * machine codes (a ticket's code), so the home never loads it. The
 * dotted body face is gone, and the brand's Ü is a real letter shown only in
 * display headlines and read as plain words. /api is intercepted.
 */

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "not mocked in e2e" } }));
});

const fontFamily = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);

/** next/font names a local face after its export, with a hash in production. */
const BOOTZY = /^"?bootzy\b/i;

test("the home h1 is Bootzy, read plainly; body, headings and eyebrows are Instrument Sans; no Plex Mono", async ({ page }) => {
  await page.goto("/");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  // Shown as FIND YOÜR NEXT THING. (capitals by CSS), read as "Find your next thing.".
  await expect(h1).toHaveAccessibleName("Find your next thing.");
  const shown = h1.locator('[aria-hidden="true"]');
  await expect(shown).toHaveText("Find yoür next thing.");
  expect(await shown.evaluate((el) => getComputedStyle(el).textTransform)).toBe("uppercase");

  const display = await fontFamily(page, "main h1");
  expect(display).toMatch(BOOTZY);
  // Bootzy then Instrument Sans: no size-adjusted Arial between them (adjustFontFallback: false).
  expect(display).toMatch(/^"?bootzy[^,]*"?, "Instrument Sans", /i);
  expect(display).not.toMatch(/bootzy Fallback/i);
  expect(await h1.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("400");
  expect(await h1.evaluate((el) => getComputedStyle(el).fontSynthesisWeight)).toBe("none");

  expect(await fontFamily(page, "body")).toMatch(/^"Instrument Sans", /);
  expect(await fontFamily(page, "main h2")).toMatch(/^"Instrument Sans", /);
  expect(await fontFamily(page, "main h3")).toMatch(/^"Instrument Sans", /);
  const search = page.getByRole("combobox", { name: "Search events" });
  expect(await search.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"Instrument Sans", /);
  // Eyebrows: Instrument Sans labels in sentence case, normal tracking (the footer's "Explore", "Fan support").
  const eyebrow = page.locator("footer .eyebrow").first();
  expect(await eyebrow.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"Instrument Sans", /);
  expect(await eyebrow.evaluate((el) => getComputedStyle(el).textTransform)).toBe("none");
  expect(await eyebrow.evaluate((el) => getComputedStyle(el).letterSpacing)).toMatch(/^(?:normal|0px)$/);
  expect(await eyebrow.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("500");

  // The Bootzy file really loaded (a face of that family, status "loaded"), and nothing dotted is left.
  const faces = await page.evaluate(() => [...document.fonts].map((face) => ({ family: face.family, status: face.status })));
  expect(faces.some((face) => /bootzy/i.test(face.family) && face.status === "loaded")).toBe(true);
  expect(faces.some((face) => /instrumentDots/i.test(face.family))).toBe(false);
  expect(await page.locator("[data-dotted-letter], .font-dots").count()).toBe(0);
  // Plex Mono is declared (for codes) but not preloaded or drawn here, so the home never downloads it.
  expect(faces.some((face) => /plex/i.test(face.family) && face.status !== "unloaded")).toBe(false);
});

/** The card's event: fixed instants, so its meta line is known (Sat 16 Jan, 5pm in Melbourne). */
const CARD_STARTS_AT = "2027-01-16T06:00:00.000Z";
const CARD_ENDS_AT = "2027-01-16T09:00:00.000Z";

test("the cards' meta line is Instrument Sans as written, never in capitals; so are their titles", async ({ page }) => {
  // The page's clock starts a week before the event, so it's upcoming (with its price) whatever the real date.
  await page.clock.install({ time: Date.parse(CARD_STARTS_AT) - 7 * 24 * 3600_000 });
  // One live event for /events' feed (registered after the catch-all, so it wins).
  await page.route("**/api/events*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            eventId: "evt-1",
            slug: "glasshouse",
            title: "Glasshouse Sessions",
            description: "d",
            category: "live-music",
            venueName: "The Conservatory",
            venueAddress: "1 Garden Rd",
            suburb: "Carlton",
            startsAt: CARD_STARTS_AT,
            endsAt: CARD_ENDS_AT,
            organiserName: "Org",
            ticketTypes: [{ id: "t1", name: "GA", priceCents: 1000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
          },
        ],
      },
    }),
  );
  await page.goto("/events");
  const card = page.locator("[data-event-card]").first();
  await expect(card).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const meta = card.locator("[data-card-meta]");
  // Shown and read as written (owner decision, 13 Nov 2026): never SAT 16 JAN · 5PM.
  await expect(meta).toHaveText("Sat 16 Jan · 5pm · Carlton, VIC");
  expect(await meta.innerText()).toBe("Sat 16 Jan · 5pm · Carlton, VIC");
  expect(await meta.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"Instrument Sans", /);
  expect(await meta.evaluate((el) => getComputedStyle(el).textTransform)).toBe("none");
  expect(await meta.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("400");
  expect(await meta.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toBe("tabular-nums");
  expect(await card.locator("h3").evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"Instrument Sans", /);
  // The price is a label inside the card's one link, never its own tab stop.
  const price = card.locator("[data-price-tag]");
  await expect(price).toHaveText(/^A\$/);
  expect(await price.evaluate((el) => el.tabIndex)).toBe(-1);
});

test("the brand headlines on /events and /map are Bootzy; an ordinary page title is Instrument Sans", async ({ page }) => {
  const expected: Record<string, string> = { "/events": "What’s on.", "/map": "Sheltüh near you." };
  for (const [path, name] of Object.entries(expected)) {
    await page.goto(path);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(h1).toHaveAccessibleName(name);
    expect(await fontFamily(page, "main h1")).toMatch(BOOTZY);
  }
  await page.goto("/search");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await fontFamily(page, "main h1")).toMatch(/^"Instrument Sans", /);
});
