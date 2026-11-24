import { expect, test, type Page } from "@playwright/test";

/**
 * The event editor's preview panel (docs/design/event-editor.md §5.10), from 1280px, in the admin
 * editor (/admin/events/new): the rail, the form and a 352px preview column, Hide / Show. The
 * organiser editor sits in the organiser dashboard's frame, where the preview stays in its sheet
 * (e2e/dashboard-editor.spec.ts); this keeps the panel covered where it's still shown. Live mode,
 * signed in as an admin with a stored test session, every /api/* request answered here.
 */

const DAY = 86_400_000;

async function signedInAsAdmin(page: Page) {
  const now = Date.now();
  const session = {
    access_token: "e2e.token.x",
    token_type: "bearer",
    expires_in: 31_536_000,
    expires_at: Math.floor(now / 1000) + 31_536_000,
    refresh_token: "r",
    user: {
      id: "u-admin",
      aud: "authenticated",
      role: "authenticated",
      email: "admin@sheltuh.example",
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: { provider: "email", role: "admin" },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
  // The storage key supabase-js derives from the placeholder URL (http://127.0.0.1:…/supabase-mock).
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Admin", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    if (path === "/api/admin/organisers") return route.fulfill({ json: { items: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

test.use({ viewport: { width: 1440, height: 900 } });

test("admin editor at 1440: the preview is a 352px panel beside the form, follows the draft, and hides and shows", async ({ page }) => {
  await signedInAsAdmin(page);
  await page.goto("/admin/events/new");
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible({ timeout: 30_000 });
  const frame = page.frameLocator("iframe[title='Event page preview']");

  const panel = page.getByRole("complementary", { name: "Event page preview" });
  await expect(panel).toBeVisible();
  // Three columns: the rail, the form, the preview (352px).
  expect(Math.round((await panel.boundingBox())?.width ?? 0)).toBe(352);
  expect((await page.locator("[data-step-panel='1']").boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(560);
  expect(Math.round((await page.locator("iframe[title='Event page preview']").boundingBox())?.width ?? 0)).toBe(320);
  // No Preview button where the panel is.
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeHidden();

  await expect(frame.getByRole("heading", { level: 1, name: "Untitled event" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Title", { exact: true }).fill("Neon Static");
  await expect(frame.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 10_000 });
  // Nothing in it is a control: inert (no tab stop, no click).
  await expect(frame.locator("[data-event-preview]")).toHaveJSProperty("inert", true);

  await page.getByRole("button", { name: "Hide preview" }).click();
  await expect(page.locator("iframe[title='Event page preview']")).toHaveCount(0);
  expect((await page.locator("[data-step-panel='1']").boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(700);
  await page.getByRole("button", { name: "Show preview" }).click();
  await expect(page.locator("iframe[title='Event page preview']")).toBeVisible();
});
