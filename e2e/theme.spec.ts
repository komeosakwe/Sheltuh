import { expect, test, type Page } from "@playwright/test";

/**
 * The Light / Dark theme (docs/design/theme-white-dark.md) in a real
 * Chromium on the local server: the no-flash script, the footer and phone
 * menu switches, persistence, and a first visit staying white whatever the
 * OS prefers. /api is intercepted, so nothing reaches a backend.
 */

const KEY = "sheltuh:theme";
const WHITE = "rgb(255, 255, 255)";
const BLACK = "rgb(0, 0, 0)";

async function stubApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "not mocked in e2e" } }));
}

const bodyBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.beforeEach(async ({ page }) => {
  await stubApi(page);
});

test("the server HTML runs the theme script in <head>, synchronously, and never renders a theme itself", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  // The layout's first <head> child, and the head's only inline script (React hoists the charset,
  // viewport, stylesheet, Next's async chunks and metadata above it): it's neither async nor
  // deferred, and it runs before any of <body> is parsed, so it's on before the first paint.
  const inline = [...head.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([^<]*)<\/script>/g)];
  expect(inline).toHaveLength(1);
  expect(inline[0][1]).not.toMatch(/\b(?:async|defer|type=)/);
  expect(inline[0][2]).toMatch(/^\(function\(\)\{try\{if\(localStorage\.getItem\("sheltuh:theme"\)!=="dark"\)return;/);
  // The theme-color meta is already parsed when it runs, so it's fixed at once.
  expect(head.indexOf('name="theme-color"')).toBeGreaterThan(-1);
  expect(head.indexOf('name="theme-color"')).toBeLessThan(head.indexOf(inline[0][0]));
  // Light is "no attribute": the server never decides the theme.
  expect(html.slice(0, html.indexOf("<head>"))).not.toContain("data-theme");
  // No color-scheme meta: it would let the OS paint the canvas dark before the CSS loads.
  expect(html).not.toMatch(/<meta name="color-scheme"/);
});

test("a stored Dark is on from the first paint: black page, black theme-color", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "dark"), KEY);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe(BLACK);
  // One theme-color, black (the script's changed copy is dropped once React renders its own).
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#000000");
  // The footer's switch shows Dark as the pressed option.
  const footerTheme = page.locator("footer").getByRole("group", { name: "Theme" });
  await expect(footerTheme.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
});

test("choosing Light in the footer applies at once and survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => localStorage.setItem(key, "dark"), KEY);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const footerTheme = page.locator("footer").getByRole("group", { name: "Theme" });
  const light = footerTheme.getByRole("button", { name: "Light" });
  await light.click();
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  expect(await bodyBackground(page)).toBe(WHITE);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#ffffff");

  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  expect(await bodyBackground(page)).toBe(WHITE);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe("light");
});

test("at 375px, choosing Dark in the phone menu keeps the menu open", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/events");
  await page.getByRole("button", { name: "Menu" }).click();
  const menu = page.locator("#site-menu");
  await expect(menu).toBeVisible();

  const dark = menu.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" });
  const box = await dark.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await dark.click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(menu).toBeVisible();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  // No sideways scroll from the switch at the narrowest phones' content width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test.describe("a first visit with the OS set to dark", () => {
  test.use({ colorScheme: "dark" });

  test("still renders white: the default is Light for everyone", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    expect(await bodyBackground(page)).toBe(WHITE);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#ffffff");
  });
});

test("print always uses Light, even in Dark", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "dark"), KEY);
  await page.goto("/");
  await page.emulateMedia({ media: "print" });
  expect(await bodyBackground(page)).toBe(WHITE);
});
