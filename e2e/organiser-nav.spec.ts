import { expect, test, type Page } from "@playwright/test";

/**
 * "For organisers" for an approved organiser, in a real browser: the header's button (and the phone
 * drawer's) goes straight to /dashboard, and the For organisers page's marketing hero is never shown
 * on the way, also when they reach /organisers/apply through another link before their record has
 * loaded (this browser's frame hint stands in for it). Live mode, signed in with a stored test
 * session, every /api/* request answered here.
 */

const DAY = 86_400_000;
const HERO = "Your event. Your community.";

async function signedInOrganiser(page: Page, { hinted = false, recordDelayMs = 0 } = {}) {
  const now = Date.now();
  const session = {
    access_token: "e2e.token.x",
    token_type: "bearer",
    expires_in: 31_536_000,
    expires_at: Math.floor(now / 1000) + 31_536_000,
    refresh_token: "r",
    user: {
      id: "u1",
      aud: "authenticated",
      role: "authenticated",
      email: "hello@hereandnow.example",
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
  // The storage key supabase-js derives from the placeholder URL (http://127.0.0.1:…/supabase-mock),
  // and the frame hint (lib/organiser-frame-hint.ts) when this browser last showed them the frame.
  await page.addInitScript(
    ({ s, hint }) => {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(s));
      if (hint) localStorage.setItem("sheltuh:organiser-frame", "u1");
    },
    { s: session, hint: hinted },
  );
  // Notes, in every document, whether the For organisers hero was ever on screen.
  await page.addInitScript((hero) => {
    const w = window as unknown as { heroSeen?: boolean };
    const check = () => {
      const h1 = Array.from(document.querySelectorAll("h1")).find((el) => el.textContent?.includes(hero));
      if (h1 && h1.getClientRects().length > 0) w.heroSeen = true;
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, HERO);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/organisers/me") {
      if (recordDelayMs) await new Promise((resolve) => setTimeout(resolve, recordDelayMs));
      return route.fulfill({
        json: {
          ownerUserId: "u1",
          organiserId: "org-demo",
          displayName: "Here & Now Collective",
          contactEmail: "hello@hereandnow.example",
          description: "Warehouse nights.",
          categories: ["live-music"],
          status: "approved",
          createdAt: new Date(now - 200 * DAY).toISOString(),
          updatedAt: new Date(now - 2 * DAY).toISOString(),
          payoutsEnabled: true,
        },
      });
    }
    if (path === "/api/organisers/me/overview") {
      return route.fulfill({
        json: {
          thisWeek: { range: { from: "2026-11-18", to: "2026-11-24" }, ticketsSold: 0, views: 0, viewsUnreliable: false, viewsComplete: true, newFollowers: 0 },
          highlight: null,
          upcoming: [],
          draftsCount: 0,
          performance: [],
        },
      });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

/** Every URL the page was on, to show /organisers/apply was never one. */
function visitedPaths(page: Page): string[] {
  const paths: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) paths.push(new URL(frame.url()).pathname);
  });
  return paths;
}

async function heroSeen(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { heroSeen?: boolean }).heroSeen === true);
}

async function expectOverview(page: Page) {
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back, Here & Now Collective!" })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 1024 } });

  test("the header's For organisers goes straight to the dashboard, never showing the For organisers page", async ({ page }) => {
    await signedInOrganiser(page);
    await page.goto("/events");
    const header = page.getByRole("navigation", { name: "Primary" }).first();
    const organisers = header.getByRole("link", { name: "For organisers" });
    await expect(organisers).toHaveAttribute("href", "/dashboard", { timeout: 30_000 });
    const paths = visitedPaths(page);
    await organisers.click();
    await expectOverview(page);
    expect(paths).not.toContain("/organisers/apply");
    expect(await heroSeen(page)).toBe(false);
    // On the dashboard it isn't marked current: the avatar's dots mark the place.
    await expect(organisers).not.toHaveAttribute("aria-current");
    await expect(header.locator("[data-header-avatar]")).toHaveAttribute("data-current", "");
  });

  test("reaching /organisers/apply another way before the record loads: Opening your dashboard…, never the page", async ({ page }) => {
    test.slow();
    await signedInOrganiser(page, { hinted: true, recordDelayMs: 1_500 });
    await page.goto("/");
    // The home's "List your event" (a marketing link to the For organisers page), clicked while the
    // record is still on its way.
    const listYourEvent = page.getByRole("region", { name: "Bring your event to life" }).getByRole("link", { name: "List your event" });
    await expect(listYourEvent).toHaveAttribute("href", "/organisers/apply", { timeout: 30_000 });
    await listYourEvent.click();
    await expect(page.getByRole("progressbar", { name: "Opening your dashboard" })).toBeVisible();
    await expectOverview(page);
    expect(await heroSeen(page)).toBe(false);
  });
});

test.describe("phone 375", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("the drawer's For organisers goes straight to the dashboard", async ({ page }) => {
    await signedInOrganiser(page);
    await page.goto("/events");
    await page.getByRole("button", { name: /^Menu/ }).click();
    const drawer = page.locator("#site-menu");
    const organisers = drawer.getByRole("link", { name: "For organisers" });
    await expect(organisers).toHaveAttribute("href", "/dashboard", { timeout: 30_000 });
    const paths = visitedPaths(page);
    await organisers.click();
    await expectOverview(page);
    expect(paths).not.toContain("/organisers/apply");
    expect(await heroSeen(page)).toBe(false);
  });
});
