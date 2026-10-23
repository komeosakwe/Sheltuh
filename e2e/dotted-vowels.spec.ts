import { expect, test, type Page } from "@playwright/test";

/**
 * The dotted vowels (owner, 23 Oct 2026; app/fonts/instrument-sans-dots/
 * README.md) in a real Chromium: the sans, and the display headline with it,
 * is Instrument Sans Dots, which draws every vowel with two dots, while the
 * text itself stays plainly spelled. Form fields keep the plain Instrument
 * Sans and the mono stays IBM Plex Mono. /api is intercepted.
 */

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "not mocked in e2e" } }));
});

const fontFamily = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);

test("only the headlines render in the dotted face; body, fields and mono stay plain; the text stays plain", async ({ page }) => {
  await page.goto("/");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  // Spelling, accessible name and copy are unchanged: only the rendering differs.
  await expect(h1).toHaveAccessibleName("Find your new thing.");
  expect((await h1.textContent())?.replace(/\s+/g, " ").trim()).toBe("Find your new thing.");

  // instrumentDots: the CSS family of Instrument Sans Dots (app/fonts.ts), then the plain face.
  expect(await fontFamily(page, "h1")).toMatch(/^"?instrumentDots"?, "Instrument Sans", /);
  // Section titles (display-md) are dotted too; running text, cards and buttons are plain.
  expect(await fontFamily(page, "main h2")).toMatch(/^"?instrumentDots"?, /);
  expect(await fontFamily(page, "body")).toMatch(/^"Instrument Sans", /);
  expect(await fontFamily(page, "main p:not(.eyebrow)")).toMatch(/^"Instrument Sans", /);
  expect(await fontFamily(page, "main h3")).toMatch(/^"Instrument Sans", /);

  // What people type looks the way they typed it.
  const search = page.getByRole("searchbox", { name: "Search events" });
  const searchFont = await search.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(searchFont).toMatch(/^"Instrument Sans", /);
  expect(searchFont).not.toContain("instrumentDots");

  // Eyebrows, dates and codes: IBM Plex Mono, untouched.
  expect(await fontFamily(page, ".eyebrow")).toMatch(/^"IBM Plex Mono", /);

  // The dotted face really loaded and draws the dots: "o" (drawn as ö) reaches higher than the
  // plain face's "o", while a consonant is identical in both.
  const metrics = await page.evaluate(async () => {
    await document.fonts.load("700 64px instrumentDots");
    await document.fonts.load('700 64px "Instrument Sans"');
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");
    const measure = (family: string, text: string) => {
      ctx.font = `700 64px ${family}`;
      return ctx.measureText(text).actualBoundingBoxAscent;
    };
    return {
      loaded: [...document.fonts].some((face) => face.family.replace(/"/g, "") === "instrumentDots" && face.status === "loaded"),
      dottedO: measure("instrumentDots", "o"),
      plainO: measure('"Instrument Sans"', "o"),
      dottedN: measure("instrumentDots", "n"),
      plainN: measure('"Instrument Sans"', "n"),
    };
  });
  expect(metrics.loaded).toBe(true);
  expect(metrics.dottedO).toBeGreaterThan(metrics.plainO + 8);
  expect(metrics.dottedN).toBeCloseTo(metrics.plainN, 1);
});
