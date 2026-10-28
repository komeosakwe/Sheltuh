import { expect, test, type Page } from "@playwright/test";
import type { AdminOrganiserLinkRecord, OrganiserRecord } from "@/lib/api/types";

/**
 * Organiser links end to end in the browser, against the live dev server,
 * with every /api/* request and Supabase Auth's password sign-in (the
 * placeholder at /supabase-mock) answered here, so nothing leaves the
 * machine: an admin creates a link on /admin/invites and copies it; the
 * organiser opens it signed out, signs in (back to the join page, the token
 * kept in the tab, never in the URL), names their organiser and lands on the
 * dashboard with a welcome. At 375 and 1280 wide.
 */

const SUPABASE = "/supabase-mock/auth/v1";
const DAY = 86_400_000;
const now = Date.now();
const TOKEN = "Lk".repeat(21) + "z";
const LINK_URL = `https://sheltuh.example/organisers/join#token=${TOKEN}`;

function session(user: { id: string; email: string; admin?: boolean }) {
  return {
    access_token: `e2e.${user.id}.token`,
    token_type: "bearer",
    expires_in: 31_536_000,
    expires_at: Math.floor(now / 1000) + 31_536_000,
    refresh_token: "r",
    user: {
      id: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: { provider: "email", providers: ["email"], ...(user.admin ? { role: "admin" } : {}) },
      user_metadata: {},
      identities: [],
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
}

function linkRecord(overrides: Partial<AdminOrganiserLinkRecord> = {}): AdminOrganiserLinkRecord {
  return {
    linkId: "11111111-1111-4111-8111-111111111111",
    status: "active",
    createdAt: new Date(now).toISOString(),
    createdBy: "u-admin",
    createdByEmail: "admin@sheltuh.example",
    expiresAt: new Date(now + 7 * DAY).toISOString(),
    ...overrides,
  };
}

/** The common signed-in chrome's calls. */
function chrome(path: string) {
  if (path === "/api/conversations/unread") return { json: { count: 0 } };
  if (path === "/api/profiles/me") return { json: { displayName: "Someone", suspended: false } };
  if (path.startsWith("/api/favourites")) return { json: { items: [], ids: [], eventIds: [] } };
  return null;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function minHeight(page: Page, locator: ReturnType<Page["getByRole"]>) {
  const box = await locator.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

for (const vp of [
  { width: 375, height: 667 },
  { width: 1280, height: 900 },
]) {
  test.describe(`organiser links at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test("an admin creates a link, copies it, and cancels an older one", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.addInitScript(
        (s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)),
        session({ id: "u-admin", email: "admin@sheltuh.example", admin: true }),
      );
      const older = linkRecord({
        linkId: "22222222-2222-4222-8222-222222222222",
        createdAt: new Date(now - 2 * DAY).toISOString(),
      });
      let links: AdminOrganiserLinkRecord[] = [older];
      const posted: string[] = [];
      await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
      await page.route("**/api/**", (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const common = chrome(path);
        if (common) return route.fulfill(common);
        if (path === "/api/admin/summary") {
          return route.fulfill({
            json: {
              reportsOpen: { count: 0 },
              eventsPending: { count: 0, startingSoon: 0, startingSoonHours: 72 },
              organisersPending: { count: 0 },
              emailsFailed: { count: 0 },
              emailsRetrying: { count: 0 },
              doorEvents: { count: 0, windowHours: 24 },
              eventsPublishedByOrganisers: { count: 0, windowHours: 72 },
            },
          });
        }
        if (path === "/api/admin/invites") return route.fulfill({ json: { items: [] } });
        if (path === "/api/organisers/me") return route.fulfill({ status: 404, json: { error: "No organiser." } });
        if (path === "/api/admin/organiser-links" && request.method() === "GET") return route.fulfill({ json: { items: links } });
        if (path === "/api/admin/organiser-links" && request.method() === "POST") {
          posted.push(path);
          const made = linkRecord();
          links = [made, ...links];
          return route.fulfill({ status: 201, json: { link: made, url: LINK_URL } });
        }
        if (path === `/api/admin/organiser-links/${older.linkId}/cancel`) {
          posted.push(path);
          const cancelled = { ...older, status: "cancelled" as const, cancelledAt: new Date().toISOString() };
          links = links.map((l) => (l.linkId === older.linkId ? cancelled : l));
          return route.fulfill({ json: cancelled });
        }
        return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
      });

      await page.goto("/admin/invites");
      const section = page.getByRole("region", { name: "Organiser links" });
      const create = section.getByRole("button", { name: "Create organiser link" });
      await expect(create).toBeVisible({ timeout: 60_000 });
      await minHeight(page, create);
      await create.click();

      const field = section.getByLabel("Your new organiser link");
      await expect(field).toHaveValue(LINK_URL);
      const copy = section.getByRole("button", { name: "Copy link" });
      await expect(copy).toBeFocused();
      await minHeight(page, copy);
      await copy.click();
      await expect(section.getByText("Link copied. Paste it into a message to the organiser.")).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LINK_URL);
      expect(posted).toEqual(["/api/admin/organiser-links"]);
      await noSidewaysScroll(page);

      // The older, unused link: cancel it after confirming.
      const olderItem = section.getByRole("article").nth(1);
      await olderItem.getByRole("button", { name: "Cancel link…" }).click();
      await expect(olderItem.getByRole("button", { name: "Keep link" })).toBeFocused();
      await olderItem.getByRole("button", { name: "Cancel link", exact: true }).click();
      await expect(olderItem).toContainText("Cancelled");
      expect(posted[1]).toBe(`/api/admin/organiser-links/${older.linkId}/cancel`);
      await noSidewaysScroll(page);
    });

    test("the organiser opens the link, signs in, names their organiser and lands on the dashboard", async ({ page }) => {
      const calls: string[] = [];
      const joins: { body: unknown; authorization: string | undefined }[] = [];
      let joined = false;
      const organiser: OrganiserRecord = {
        organiserId: "org-new",
        ownerUserId: "u-mia",
        displayName: "Neon Collective",
        contactEmail: "mia@example.com",
        description: "",
        categories: ["live-music"],
        status: "approved",
        payoutsEnabled: false,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      } as OrganiserRecord;
      await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
      await page.route(
        (url) => url.pathname.endsWith(`${SUPABASE}/token`) && url.searchParams.get("grant_type") === "password",
        (route) => route.fulfill({ json: session({ id: "u-mia", email: "mia@example.com" }) }),
      );
      await page.route("**/api/**", (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const common = chrome(path);
        if (common) return route.fulfill(common);
        if (path.startsWith("/api/organiser-links/")) calls.push(`${request.method()} ${path}`);
        if (path === "/api/organiser-links/view") {
          expect(request.postDataJSON()).toEqual({ token: TOKEN });
          return route.fulfill({ json: { expiresAt: new Date(now + 7 * DAY).toISOString() } });
        }
        if (path === "/api/organiser-links/join") {
          joins.push({ body: request.postDataJSON(), authorization: request.headers().authorization });
          joined = true;
          return route.fulfill({ json: { organiserId: "org-new", displayName: "Neon Collective" } });
        }
        if (path === "/api/organisers/me") {
          return joined ? route.fulfill({ json: organiser }) : route.fulfill({ status: 404, json: { error: "No organiser." } });
        }
        if (path === "/api/organisers/me/events") return route.fulfill({ json: { items: [] } });
        return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
      });

      await page.goto(`/organisers/join#token=${TOKEN}`);
      const invited = page.getByRole("heading", { level: 1, name: "You’ve been invited to sell tickets on Sheltüh" });
      await expect(invited).toBeVisible({ timeout: 60_000 });
      // The token left the address bar; only the read happened.
      expect(new URL(page.url()).hash).toBe("");
      expect(calls).toEqual(["POST /api/organiser-links/view"]);
      const main = page.getByRole("main");
      await minHeight(page, main.getByRole("link", { name: "Create account" }));
      await noSidewaysScroll(page);

      await main.getByRole("link", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/login\?next=%2Forganisers%2Fjoin$/, { timeout: 30_000 });
      await page.getByLabel("Email").fill("mia@example.com");
      await page.getByLabel("Password", { exact: true }).fill("Secret123");
      await page.getByRole("main").getByRole("button", { name: "Sign in", exact: true }).click();

      // Back on the join page, the token from this tab's storage (never the URL).
      await expect(page).toHaveURL(/\/organisers\/join$/, { timeout: 30_000 });
      const form = page.getByRole("form", { name: "Join as an organiser" });
      await expect(form).toBeVisible({ timeout: 30_000 });
      await form.getByLabel("Organiser name").fill("Neon Collective");
      await form.getByLabel("Live music").check();
      await noSidewaysScroll(page);
      const joinButton = form.getByRole("button", { name: "Join as an organiser" });
      await minHeight(page, joinButton);
      await joinButton.click();

      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
      await expect(page.getByText("Welcome to Sheltüh, Neon Collective.")).toBeVisible({ timeout: 30_000 });
      expect(joins).toEqual([
        {
          body: { token: TOKEN, displayName: "Neon Collective", categories: ["live-music"] },
          authorization: "Bearer e2e.u-mia.token",
        },
      ]);
      // Used up: the tab forgot it.
      expect(await page.evaluate(() => sessionStorage.getItem("sheltuh:organiser-link"))).toBeNull();
      await noSidewaysScroll(page);
    });

    test("a used or expired link says so, and nothing else is called", async ({ page }) => {
      const calls: string[] = [];
      await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        const common = chrome(path);
        if (common) return route.fulfill(common);
        calls.push(path);
        if (path === "/api/organiser-links/view") {
          return route.fulfill({
            status: 404,
            json: { error: "This link has expired or was already used — ask Sheltüh for a new one.", code: "unavailable" },
          });
        }
        return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
      });
      await page.goto(`/organisers/join#token=${TOKEN}`);
      const heading = page.getByRole("heading", { level: 1, name: "This link can’t be used" });
      await expect(heading).toBeVisible({ timeout: 60_000 });
      await expect(heading).toBeFocused();
      await expect(page.getByText("This link has expired or was already used — ask Sheltüh for a new one.")).toBeVisible();
      expect(calls).toEqual(["/api/organiser-links/view"]);
      await noSidewaysScroll(page);
    });
  });
}

test("at 320px the join form fits", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(
    (s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)),
    session({ id: "u-mia", email: "a-rather-long-address.for-testing@example.com" }),
  );
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const common = chrome(path);
    if (common) return route.fulfill(common);
    if (path === "/api/organiser-links/view") return route.fulfill({ json: { expiresAt: new Date(now + 7 * DAY).toISOString() } });
    if (path === "/api/organisers/me") return route.fulfill({ status: 404, json: { error: "No organiser." } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  await page.goto(`/organisers/join#token=${TOKEN}`);
  await expect(page.getByRole("form", { name: "Join as an organiser" })).toBeVisible({ timeout: 60_000 });
  await noSidewaysScroll(page);
});
