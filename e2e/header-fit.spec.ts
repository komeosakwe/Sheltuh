import { expect, test, type Page } from "@playwright/test";
import type { AdminSummary } from "@/lib/api/types";

/**
 * The desktop header is one row at every desktop width, whoever is signed in.
 * Signed in, the nav is wider (Messages and Account, plus Admin and its badge
 * for admins), so the header's search bar shrinks into the room left, and where
 * that's under 13rem the slot shows the search icon link instead. The header
 * is then exactly as tall as it is signed out, with no sideways scroll. Live
 * mode, with a stored test session (the Supabase URL is a local placeholder)
 * and every /api/* request answered here.
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
  await expect(page.locator("header").getByRole("link", { name: READY[who] }).first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const header = await page.locator("header").first().boundingBox();
  // A hidden bar isn't a landmark at all (display: none), so look before measuring.
  const search = page.getByRole("search", { name: "Search the site" });
  const bar = (await search.isVisible()) ? await search.boundingBox() : null;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return { height: Math.round(header?.height ?? 0), barWidth: bar ? Math.round(bar.width) : null, overflow };
}

for (const width of [1024, 1280, 1440, 1920]) {
  test.describe(`desktop header at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("is one row, as tall signed in (member, admin with badge) as signed out, with search always reachable", async ({ page }) => {
      await as(page, "signed-out");
      const signedOut = await measure(page, "signed-out");
      // Signed out the bar has its full width, and the header fits --header-h (70px on desktop).
      expect(signedOut.barWidth).toBe(384);
      expect(signedOut.height).toBeLessThanOrEqual(70);
      expect(signedOut.overflow).toBeLessThanOrEqual(0);

      for (const who of ["member", "admin"] as const) {
        const signedInPage = await page.context().newPage();
        await as(signedInPage, who);
        const result = await measure(signedInPage, who);
        expect(result.height, `${who}: ${JSON.stringify(result)}`).toBe(signedOut.height);
        expect(result.overflow, who).toBeLessThanOrEqual(0);

        const search = signedInPage.getByRole("search", { name: "Search the site" });
        const icon = signedInPage.locator("[data-header-search]").getByRole("link", { name: "Search" });
        // From 1280px (the 1152px column) there's room for the bar whoever is signed in.
        if (width >= 1280) expect(result.barWidth, who).not.toBeNull();
        if (result.barWidth === null) {
          // No room for a usable bar: the icon link to /search instead, never both.
          await expect(search).toBeHidden();
          await expect(icon).toBeVisible();
          await expect(icon).toHaveAttribute("href", "/search");
          const box = await icon.boundingBox();
          expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(24);
        } else {
          // A shown bar stays usable: at least 13rem, with the whole "Search events" placeholder in view.
          expect(result.barWidth, who).toBeGreaterThanOrEqual(208);
          await expect(icon).toBeHidden();
          const field = search.getByRole("searchbox", { name: "Search events" });
          const clipped = await field.evaluate((el: HTMLInputElement) => {
            const s = getComputedStyle(el);
            const ctx = document.createElement("canvas").getContext("2d");
            if (!ctx) return true;
            ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
            const room = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
            return ctx.measureText(el.placeholder).width > room;
          });
          expect(clipped, `${who}: placeholder clipped at ${result.barWidth}px`).toBe(false);
          // The location segment keeps its name when it narrows to the pin.
          await expect(search.getByRole("button", { name: /^Location: / })).toBeVisible();
        }
        await signedInPage.close();
      }
    });
  });
}

test.describe("desktop header at 1024px, as an admin", () => {
  test.use({ viewport: { width: 1024, height: 900 } });

  test("the search icon link goes to /search and is reachable by keyboard right after the wordmark", async ({ page }) => {
    await as(page, "admin");
    await measure(page, "admin");
    const icon = page.locator("[data-header-search]").getByRole("link", { name: "Search" });
    await expect(icon).toBeVisible();
    await page.locator("header").getByRole("link", { name: "Sheltüh home" }).last().focus();
    await page.keyboard.press("Tab");
    await expect(icon).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search$/);
  });
});
