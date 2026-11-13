import { expect, test, type Page } from "@playwright/test";
import type { AdminSummary } from "@/lib/api/types";

/**
 * The black desktop header (redesign PR 2, the proposal and the rules' Navigation
 * board) is one 96px row at every desktop width, in Light and Dark (Dark's rule is
 * drawn inside it), whoever is signed in: signed out, Sign in and the For
 * organisers button; signed in, For organisers, the Messages chip with its count
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
  for (const theme of ["light", "dark"] as const) {
    test.describe(`desktop header at ${width}px in ${theme === "light" ? "Light" : "Dark"}`, () => {
      test.use({ viewport: { width, height: 900 } });

      test("is one 96px row, as tall signed in (member, admin with badge) as signed out, with no search field", async ({ page }) => {
        const themed = async (p: Page) => {
          if (theme === "dark") await p.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
        };
        await themed(page);
        await as(page, "signed-out");
        const signedOut = await measure(page, "signed-out");
        // --header-h (app/globals.css) is 96px from lg; in Dark too, its rule drawn inside the header.
        expect(signedOut.height).toBe(96);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--header-h").trim())).toBe("6rem");
        expect(signedOut.overflow).toBeLessThanOrEqual(0);
        await expect(page.locator("header").getByRole("search")).toHaveCount(0);

        for (const who of ["member", "admin"] as const) {
          const signedInPage = await page.context().newPage();
          await themed(signedInPage);
          await as(signedInPage, who);
          const result = await measure(signedInPage, who);
          expect(result.height, `${who}: ${JSON.stringify(result)}`).toBe(signedOut.height);
          expect(result.overflow, who).toBeLessThanOrEqual(0);
          // One row: every control inside the bar, 32px or taller (the Messages chip; the rest 40), and none past the right edge.
          for (const control of result.controls) {
            expect(control.top, `${who}: ${JSON.stringify(control)}`).toBeGreaterThanOrEqual(0);
            expect(control.bottom, `${who}: ${JSON.stringify(control)}`).toBeLessThanOrEqual(96);
            expect(control.height, who).toBeGreaterThanOrEqual(32);
            expect(control.right, who).toBeLessThanOrEqual(width);
          }
          const header = signedInPage.locator("header");
          await expect(header.getByRole("search")).toHaveCount(0);
          // No heart on the desktop row: Saved is on /account (and in the phone menu).
          await expect(signedInPage.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Saved" })).toHaveCount(0);
          // The avatar: a solid 40px square with the initial and a caret.
          const avatar = signedInPage.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Account" });
          await expect(avatar).toBeVisible();
          const avatarBox = await avatar.boundingBox();
          expect(Math.round(avatarBox?.height ?? 0)).toBe(40);
          expect(Math.round(avatarBox?.width ?? 0)).toBeGreaterThanOrEqual(40);
          expect(await avatar.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])).toEqual([
            "rgb(255, 255, 255)",
            "rgb(0, 0, 0)",
          ]);
          await signedInPage.close();
        }
      });
    });
  }
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
      // The Messages chip: 32px, 14px, a muted outline.
      const chip = themed.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: READY.member });
      expect(await chip.evaluate((el) => [Math.round(el.getBoundingClientRect().height), getComputedStyle(el).fontSize, getComputedStyle(el).borderTopColor])).toEqual([
        32,
        "14px",
        "rgb(51, 51, 51)",
      ]);
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
