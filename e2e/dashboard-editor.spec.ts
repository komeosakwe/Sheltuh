import { expect, test, type Page } from "@playwright/test";

/**
 * The organiser's event editor (/dashboard/new) at phone and desktop widths:
 * nothing overflows, and every field fits its column (brand-direction-one.md
 * §6.2). Live mode, signed in with a stored test session (no network: the
 * Supabase URL is a local placeholder), with every /api/* request answered here.
 */

const DAY = 86_400_000;

async function signedInAsOrganiser(page: Page) {
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
      email: "mia@example.com",
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
  // The storage key supabase-js derives from the placeholder URL (http://127.0.0.1:…/supabase-mock).
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/organisers/me") {
      return route.fulfill({
        json: {
          ownerUserId: "u1",
          organiserId: "org-demo",
          displayName: "Northside Noise",
          contactEmail: "hello@northside.example",
          description: "Warehouse nights.",
          categories: ["live-music"],
          status: "approved",
          createdAt: new Date(now - 200 * DAY).toISOString(),
          updatedAt: new Date(now - 2 * DAY).toISOString(),
          payoutsEnabled: true,
        },
      });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

for (const vp of [
  { width: 320, height: 640 },
  { width: 1440, height: 900 },
]) {
  test.describe(`/dashboard/new at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test("no sideways scrolling, and every field fits inside the form", async ({ page }) => {
      await signedInAsOrganiser(page);
      await page.goto("/dashboard/new");
      const title = page.getByLabel("Title", { exact: true });
      await expect(title).toBeVisible({ timeout: 30_000 });

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      const formBox = await page.locator("form").filter({ has: title }).boundingBox();
      expect(formBox).not.toBeNull();
      for (const name of ["Start date", "Start time", "End date", "End time"]) {
        const box = await page.getByLabel(name).boundingBox();
        expect(box, name).not.toBeNull();
        expect((box?.x ?? 0) + (box?.width ?? 0), name).toBeLessThanOrEqual((formBox?.x ?? 0) + (formBox?.width ?? 0) + 1);
        expect(box?.x ?? -1, name).toBeGreaterThanOrEqual((formBox?.x ?? 0) - 1);
      }
      // The photo picker is a button-styled label, not the browser's raw file control.
      await expect(page.getByText("Choose a photo")).toBeVisible();
    });
  });
}
