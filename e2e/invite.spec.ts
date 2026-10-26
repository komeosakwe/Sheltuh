import { expect, test, type Page, type Request } from "@playwright/test";
import type { InviteView, MyInvite } from "@/lib/api/types";

/**
 * An emailed account invite (/invite#token=…), end to end in the browser,
 * against the live dev server: the API's /api/invites/* and Supabase Auth's
 * /verify, PUT /user and /logout (the placeholder at /supabase-mock) are
 * answered here, so nothing leaves the machine. Creating an organiser's
 * account: account link → verifyOtp (type invite) → set the password → sign
 * out the other sessions → Join → the dashboard.
 */

const SUPABASE = "/supabase-mock/auth/v1";
const TOKEN = "Ab".repeat(21) + "c";
const EMAIL = "mia@example.com";
const now = Date.now();

const VIEW: InviteView = {
  kind: "organiser",
  maskedEmail: "m***@example.com",
  organiserName: "Neon Collective",
  expiresAt: new Date(now + 14 * 86_400_000).toISOString(),
  account: "new",
  passwordSetup: true,
};
const MINE: MyInvite = { inviteId: "11111111-1111-4111-8111-111111111111", kind: "organiser", organiserName: "Neon Collective", expiresAt: VIEW.expiresAt };

function session() {
  return {
    access_token: "e2e.invite.token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(now / 1000) + 3600,
    refresh_token: "e2e-refresh",
    user: {
      id: "u-new",
      aud: "authenticated",
      role: "authenticated",
      email: EMAIL,
      email_confirmed_at: new Date(now).toISOString(),
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: new Date(now).toISOString(),
    },
  };
}

interface Seen {
  /** Every Supabase Auth and invite API call, in order: "METHOD path". */
  calls: string[];
  verify: unknown[];
  passwords: unknown[];
  accept: { body: unknown; authorization: string | undefined }[];
}

async function mockInvite(page: Page, { view = VIEW, viewStatus = 200, viewBody }: { view?: InviteView; viewStatus?: number; viewBody?: unknown } = {}): Promise<Seen> {
  const seen: Seen = { calls: [], verify: [], passwords: [], accept: [] };
  const record = (request: Request) => {
    const url = new URL(request.url());
    seen.calls.push(`${request.method()} ${url.pathname.replace(SUPABASE, "auth")}${url.search}`);
  };
  await page.route("**/auth/*.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="gray"/></svg>',
    }),
  );
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route(
    (url) => url.pathname.endsWith(`${SUPABASE}/verify`),
    (route) => {
      record(route.request());
      seen.verify.push(route.request().postDataJSON());
      return route.fulfill({ json: session() });
    },
  );
  await page.route(
    (url) => url.pathname.endsWith(`${SUPABASE}/user`),
    (route) => {
      record(route.request());
      if (route.request().method() === "PUT") seen.passwords.push(route.request().postDataJSON());
      return route.fulfill({ json: session().user });
    },
  );
  await page.route(
    (url) => url.pathname.endsWith(`${SUPABASE}/logout`),
    (route) => {
      record(route.request());
      return route.fulfill({ status: 204, body: "" });
    },
  );
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/invites/")) record(request);
    if (path === "/api/invites/view") {
      return route.fulfill({ status: viewStatus, json: viewBody ?? view });
    }
    if (path === "/api/invites/account-link") return route.fulfill({ json: { tokenHash: "pkce-free-hashed-token-123" } });
    if (path === "/api/invites/me") return route.fulfill({ json: MINE });
    if (path === "/api/invites/accept") {
      seen.accept.push({ body: request.postDataJSON(), authorization: request.headers().authorization });
      return route.fulfill({ json: { kind: "organiser", organiserId: "org-new" } });
    }
    if (path === "/api/organisers/me") {
      return route.fulfill({
        json: {
          ownerUserId: "u-new",
          organiserId: "org-new",
          displayName: "Neon Collective",
          contactEmail: EMAIL,
          description: "Loud nights.",
          categories: ["live-music"],
          status: "approved",
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
        },
      });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [], eventIds: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return seen;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("a new organiser: Create account verifies the invite, sets the password, signs out elsewhere, then Join → dashboard", async ({ page }) => {
  const seen = await mockInvite(page);
  await page.goto(`/invite#token=${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: "Set up Neon Collective on Sheltüh" })).toBeVisible({ timeout: 60_000 });
  // The token left the address bar, and only the read happened.
  expect(new URL(page.url()).hash).toBe("");
  expect(seen.calls).toEqual(["POST /api/invites/view"]);

  await page.getByLabel("Password", { exact: true }).fill("Secret123");
  await page.getByLabel("Confirm password").fill("Secret123");
  await page.getByRole("button", { name: "Create account" }).click();

  const join = page.getByRole("heading", { level: 1, name: "Join Sheltüh as Neon Collective" });
  await expect(join).toBeVisible({ timeout: 30_000 });
  await expect(join).toBeFocused();
  expect(seen.verify).toEqual([expect.objectContaining({ token_hash: "pkce-free-hashed-token-123", type: "invite" })]);
  expect(seen.passwords).toEqual([expect.objectContaining({ password: "Secret123" })]);
  expect(seen.calls).toEqual([
    "POST /api/invites/view",
    "POST /api/invites/account-link",
    "POST auth/verify",
    "PUT auth/user",
    "POST auth/logout?scope=others",
    "GET /api/invites/me",
  ]);

  await page.getByRole("button", { name: "Join as Neon Collective" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  expect(seen.accept).toEqual([{ body: { inviteId: MINE.inviteId }, authorization: "Bearer e2e.invite.token" }]);
});

test("at 320px the invite page fits, and Create account is a 44px target", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockInvite(page);
  await page.goto(`/invite#token=${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: "Set up Neon Collective on Sheltüh" })).toBeVisible({ timeout: 60_000 });
  await noSidewaysScroll(page);
  const create = await page.getByRole("button", { name: "Create account" }).boundingBox();
  expect(create?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("an expired invite says so, focused, and nothing else is called", async ({ page }) => {
  const seen = await mockInvite(page, {
    viewStatus: 410,
    viewBody: { error: "This invite has expired.", code: "expired" },
  });
  await page.goto(`/invite#token=${TOKEN}`);
  const heading = page.getByRole("heading", { level: 1, name: "This invite has expired" });
  await expect(heading).toBeVisible({ timeout: 60_000 });
  await expect(heading).toBeFocused();
  expect(seen.calls).toEqual(["POST /api/invites/view"]);
});

test("an address with an account is sent to sign in, coming back to /invite", async ({ page }) => {
  await mockInvite(page, { view: { ...VIEW, account: "existing" } });
  await page.goto(`/invite#token=${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to accept your invite" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("main").getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Finvite$/);
});
