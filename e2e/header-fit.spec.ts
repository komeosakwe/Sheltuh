import { expect, test, type Page } from "@playwright/test";
import type { AdminSummary } from "@/lib/api/types";

/**
 * The black desktop header (redesign PR 2, the rules' Navigation board) is one
 * 64px row at every desktop width, whoever is signed in: signed out, Sign in and
 * the For organisers button; signed in, For organisers, Messages with its count
 * and the avatar (plus Admin and its badge for admins), with no sideways scroll
 * and no search field. Live mode, with a stored test session (the Supabase URL
 * is a local placeholder) and every /api/* request answered here.
 */

const DAY = 86_400_000;
const now = Date.now();

const SUMMARY: AdminSummary = {
  reportsOpen: { count: 2, oldestAt: new Date(now - 3 * DAY).toISOString() },
  eventsPending: { count: 2, soonestStartsAt: new Date(now + DAY).toISOString(), startingSoon: 1, startingSoonHours: 72 },
  organisersPending: { count: 1, oldestAt: new Date(now - DAY).toISOString() },
  emailsFailed: { count: 0 },
  emailsRetrying: { count: 1 },
  doorEvents: { count: 1, windowHours: 24 },
};

type Who = "signed-out" | "member" | "admin";

/** The account link that shows once the header's auth state has settled (with its badge when signed in). */
const READY: Record<Who, RegExp> = {
  "signed-out": /^Sign in$/,
  member: /^Messages\s*, 12 unread$/,
  admin: /^Admin\s*, 5 waiting$/,
};

async function as(page: Page, who: Who) {
  if (who !== "signed-out") {
    const session = {
      access_token: "e2e.token.x",
      token_type: "bearer",
      expires_in: 31_536_000,
      expires_at: Math.floor(now / 1000) + 31_536_000,
      refresh_token: "r",
      user: {
        id: `u-${who}`,
        aud: "authenticated",
        role: "authenticated",
        email: `${who}@sheltuh.example`,
        email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
        app_metadata: who === "admin" ? { provider: "email", role: "admin" } : { provider: "email" },
        user_metadata: {},
        created_at: new Date(now - 300 * DAY).toISOString(),
      },
    };
    await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  }
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/admin/summary") return route.fulfill({ json: SUMMARY });
    if (path === "/api/events") return route.fulfill({ json: { items: [], nextCursor: undefined } });
    if (path === "/api/events/trending") return route.fulfill({ json: { items: [] } });
    // A two-digit unread count: the widest Messages link a member's row has to fit.
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 12 } });
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Sam", suspended: false } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

/** The header on /events once its account links (and badges) have settled. */
async function measure(page: Page, who: Who) {
  await page.goto("/events");
  const header = page.locator("header").first();
  await expect(header.getByRole("link", { name: READY[who] }).first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const box = await header.boundingBox();
  const primary = page.getByRole("navigation", { name: "Primary" });
  // Every visible control in the row, as [top, bottom, right] (one row: they all sit inside the header).
  const controls = await primary.locator("a").evaluateAll((links) =>
    links
      .map((link) => link.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right), height: Math.round(r.height) })),
  );
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return { height: Math.round(box?.height ?? 0), controls, overflow };
}

for (const width of [1024, 1280, 1440, 1920]) {
  test.describe(`desktop header at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("is one 64px row, as tall signed in (member, admin with badge) as signed out, with no search field", async ({ page }) => {
      await as(page, "signed-out");
      const signedOut = await measure(page, "signed-out");
      // --header-h (app/globals.css) is 64px.
      expect(signedOut.height).toBe(64);
      expect(signedOut.overflow).toBeLessThanOrEqual(0);
      await expect(page.locator("header").getByRole("search")).toHaveCount(0);

      for (const who of ["member", "admin"] as const) {
        const signedInPage = await page.context().newPage();
        await as(signedInPage, who);
        const result = await measure(signedInPage, who);
        expect(result.height, `${who}: ${JSON.stringify(result)}`).toBe(signedOut.height);
        expect(result.overflow, who).toBeLessThanOrEqual(0);
        // One row: every control inside the 64px bar, 40px or taller, and none past the right edge.
        for (const control of result.controls) {
          expect(control.top, `${who}: ${JSON.stringify(control)}`).toBeGreaterThanOrEqual(0);
          expect(control.bottom, `${who}: ${JSON.stringify(control)}`).toBeLessThanOrEqual(64);
          expect(control.height, who).toBeGreaterThanOrEqual(40);
          expect(control.right, who).toBeLessThanOrEqual(width);
        }
        const header = signedInPage.locator("header");
        await expect(header.getByRole("search")).toHaveCount(0);
        // No heart on the desktop row: Saved is on /account (and in the phone menu).
        await expect(signedInPage.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Saved" })).toHaveCount(0);
        const avatar = signedInPage.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Account" });
        await expect(avatar).toBeVisible();
        const avatarBox = await avatar.boundingBox();
        expect(Math.round(avatarBox?.width ?? 0)).toBe(40);
        expect(Math.round(avatarBox?.height ?? 0)).toBe(40);
        await signedInPage.close();
      }
    });
  });
}

test.describe("desktop header at 1440px, signed in", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("is black in Light and Dark, and the Messages count is orange with a black number", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      const themed = await page.context().newPage();
      if (theme === "dark") await themed.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
      await as(themed, "member");
      await measure(themed, "member");
      expect(await themed.locator("header").first().evaluate((el) => getComputedStyle(el).backgroundColor), theme).toBe("rgb(0, 0, 0)");
      const badge = themed.getByRole("navigation", { name: "Primary" }).locator("[data-unread-badge]");
      expect(await badge.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]), theme).toEqual([
        "rgb(255, 72, 0)",
        "rgb(0, 0, 0)",
      ]);
      await themed.close();
    }
  });

  test("keyboard: the wordmark, Discover, Nearby, Community, For organisers, Messages, then the avatar, each with a visible ring", async ({ page }) => {
    await as(page, "member");
    await measure(page, "member");
    await page.locator("header").getByRole("link", { name: "Sheltüh home" }).last().focus();
    const primary = page.getByRole("navigation", { name: "Primary" });
    for (const name of ["Discover", "Nearby", "Community", "For organisers", READY.member, "Account"]) {
      await page.keyboard.press("Tab");
      const link = primary.getByRole("link", { name });
      await expect(link).toBeFocused();
      // The global ring: 2px, white inside the black header (never orange).
      expect(await link.evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineColor])).toEqual([
        "solid",
        "rgb(255, 255, 255)",
      ]);
    }
  });
});
