import { expect, test, type Page } from "@playwright/test";

/**
 * The Light / Dark theme (docs/design/theme-white-dark.md) in a real
 * Chromium on the local server: the no-flash script, the footer's switch (the
 * only one: the rules' Navigation board), persistence, a first visit staying
 * white whatever the OS prefers, and the black theme-color of the black header
 * in both themes. /api is intercepted, so nothing reaches a backend.
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
  // One theme-color, the black header's, in the server HTML for everyone.
  expect(head).toMatch(/<meta name="theme-color" content="#000000"/);
  // Light is "no attribute": the server never decides the theme.
  expect(html.slice(0, html.indexOf("<head>"))).not.toContain("data-theme");
  // No color-scheme meta: it would let the OS paint the canvas dark before the CSS loads.
  expect(html).not.toMatch(/<meta name="color-scheme"/);
});

test("a stored Dark is on from the first paint: black page, and the header's black theme-color", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "dark"), KEY);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe(BLACK);
  // One theme-color, black (the header is black in both themes, so nothing swaps it).
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
  // The header stays black, and so does the browser's chrome above it.
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#000000");
  expect(await page.locator("header").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(BLACK);

  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  expect(await bodyBackground(page)).toBe(WHITE);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe("light");
});

test("at 375px, the phone menu has no theme switch; the footer's works, with 48px options and no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/events");
  await page.getByRole("button", { name: "Menu" }).click();
  const menu = page.locator("#site-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("group", { name: "Theme" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  const dark = page.locator("footer").getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" });
  await dark.scrollIntoViewIfNeeded();
  const box = await dark.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  await dark.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  // No sideways scroll from the switch at the narrowest phones' content width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("at 375px, a Menu tap before the page hydrates stays open (and reads Close) once it does", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  // Hold the app's scripts so the tap lands on the server-rendered button (a native popover target).
  let release: () => void = () => undefined;
  const scriptsHeld = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => {
    await scriptsHeld;
    await route.continue();
  });
  await page.goto("/events", { waitUntil: "commit" });
  await page.getByRole("button", { name: "Menu" }).click();
  const menu = page.locator("#site-menu");
  await expect(menu).toBeVisible();
  release();
  await page.waitForLoadState("load");
  // Hydrated: the button's label is React's, and it now says Close.
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible({ timeout: 15_000 });
  await expect(menu).toBeVisible();
});

test.describe("a first visit with the OS set to dark", () => {
  test.use({ colorScheme: "dark" });

  test("still renders white: the default is Light for everyone (under the black header)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    expect(await bodyBackground(page)).toBe(WHITE);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#000000");
  });
});

test("print always uses Light, even in Dark", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "dark"), KEY);
  await page.goto("/");
  await page.emulateMedia({ media: "print" });
  expect(await bodyBackground(page)).toBe(WHITE);
});
