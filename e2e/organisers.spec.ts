import { expect, test, type Page } from "@playwright/test";

/**
 * The For organisers page and the sign-in frame in a real browser (redesign PR 6), signed out in
 * live mode, at the widths the owner's mocks were drawn for, Light and Dark. Every /api/* request
 * is answered here (none is expected signed out). Sign-in's flows are in e2e/oauth.spec.ts.
 */

async function mockApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "not mocked in e2e" } }));
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
}

/** Whether an <img> has loaded (a broken one has no natural width). */
const loaded = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 768, 390, 320]) {
    test.describe(`at ${width}px, ${theme}`, () => {
      test.use({ viewport: { width, height: 900 } });
      test.beforeEach(async ({ page }) => {
        if (theme === "dark") await page.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
        await mockApi(page);
      });

      test("/organisers/apply: the mock's sections in order, the photo, no sideways scroll", async ({ page }) => {
        await page.goto("/organisers/apply");
        await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Your event. Your community.", {
          timeout: 60_000,
        });
        await expect(page).toHaveTitle("For organisers — Sheltüh");
        // Signed out, the panel asks to sign in (it settles once the session is read).
        const panel = page.getByRole("region", { name: "Sign in to apply as an organiser." });
        await expect(panel).toBeVisible({ timeout: 30_000 });
        const h2s = (await page.locator("main h2").allTextContents()).map((h) => h.trim());
        expect(h2s).toEqual([
          "Create",
          "Reach",
          "Grow",
          "Publish your first event in four steps",
          "Creative audiences, not everyone.",
          "Sign in to apply as an organiser.",
        ]);
        await expect(page.locator("main")).toContainText("13 of 15 people we spoke to skipped an event");
        await expect(page.locator("main")).not.toContainText(/87\s*%|save and finish later|and event is checked/);
        await expect.poll(() => loaded(page, "main img")).toBe(true);
        await noSidewaysScroll(page);
      });

      test("/organisers/apply: Get started goes to the Start organising panel; its links come back here", async ({ page }) => {
        await page.goto("/organisers/apply");
        const panel = page.getByRole("region", { name: "Sign in to apply as an organiser." });
        await expect(panel).toBeVisible({ timeout: 60_000 });
        await page.getByRole("link", { name: "Get started" }).click();
        await expect(page).toHaveURL(/#start$/);
        await expect(panel).toBeInViewport();
        // The panel's heading is clear of the sticky header.
        const header = await page.getByRole("banner").boundingBox();
        const title = await panel.getByRole("heading", { level: 2 }).boundingBox();
        if (!header || !title) throw new Error("not laid out");
        expect(title.y).toBeGreaterThanOrEqual(header.y + header.height);
        // 48px buttons, coming back here after signing in or up.
        for (const [name, href] of [
          ["Sign in", "/login?next=%2Forganisers%2Fapply"],
          ["Create an account", "/signup?next=%2Forganisers%2Fapply"],
        ] as const) {
          const link = panel.getByRole("link", { name });
          await expect(link).toHaveAttribute("href", href);
          expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(48);
        }
        await page.getByRole("link", { name: "See how it works" }).click();
        await expect(page).toHaveURL(/#how-it-works$/);
        await expect(page.getByRole("region", { name: "Publish your first event in four steps" })).toBeInViewport();
      });

      test("/login: the photo, the card's copy, Continue, the links, no sideways scroll", async ({ page }) => {
        await page.goto("/login");
        await expect(page.getByRole("heading", { level: 1, name: "Welcome to Sheltüh" })).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText("Find your place, find your people.")).toBeVisible();
        const main = page.locator("#main");
        await expect(main.getByLabel("Email")).toHaveAttribute("placeholder", "you@example.com");
        const submit = main.getByRole("button", { name: "Continue", exact: true });
        await expect(submit).toBeVisible();
        expect((await submit.boundingBox())?.height).toBeGreaterThanOrEqual(48);
        expect((await main.getByLabel("Email").boundingBox())?.height).toBeGreaterThanOrEqual(48);
        await expect(main.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/signup");
        await expect(main.getByRole("link", { name: "Find my tickets" })).toHaveAttribute("href", "/help#where-are-my-tickets");
        await expect.poll(() => loaded(page, "main img")).toBe(true);
        // From 1024px the card sits on the photo; below, the photo is a band above the card's content.
        const photo = await page.locator("main img").first().boundingBox();
        const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
        if (!photo || !h1) throw new Error("not laid out");
        if (width >= 1024) expect(photo.y + photo.height).toBeGreaterThan(h1.y + h1.height);
        else expect(photo.y + photo.height).toBeLessThanOrEqual(h1.y);
        await noSidewaysScroll(page);
      });
    });
  }
}

test("Find my tickets lands on Help's Where are my tickets?", async ({ page }) => {
  await mockApi(page);
  await page.goto("/login");
  await page.locator("#main").getByRole("link", { name: "Find my tickets" }).click();
  await expect(page).toHaveURL(/\/help#where-are-my-tickets$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 2, name: "Where are my tickets?" })).toBeInViewport();
});
