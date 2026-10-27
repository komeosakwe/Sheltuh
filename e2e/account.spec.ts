import { expect, test, type Page } from "@playwright/test";

/**
 * /account in a real browser (live mode, every /api/* request answered here):
 * profile first, then the link rows, Sign-in, and Delete your profile behind
 * a disclosure, at a 375px phone and a 1280px desktop. Screenshots go to
 * E2E_SCREENSHOT_DIR when it's set.
 */

const DAY = 86_400_000;
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

const PROFILE = {
  displayName: "Mia T.",
  suspended: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  profileId: "0b6c1f3e-5d0a-4a8e-9b1f-6f2a3c4d5e6f",
  profileVisible: false,
  bio: "Painter and noise fan.",
  instagramHandle: "mia.t",
  hasAvatar: false,
};

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Signed in as mia@example.com (email and Google), an organiser, with a profile; PATCHes are recorded. */
async function signedIn(page: Page) {
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
      app_metadata: { provider: "email", providers: ["email", "google"] },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  const patches: unknown[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/profiles/me" && request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      return route.fulfill({ json: { ...PROFILE, ...body } });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: PROFILE });
    if (path === "/api/organisers/me") {
      return route.fulfill({
        json: {
          organiserId: "8c4f6f8e-0d5b-4a51-9a3e-2f6f0b0d1a11",
          displayName: "Northside Noise",
          contactEmail: "mia@example.com",
          description: "Loud nights.",
          categories: ["live-music"],
          status: "approved",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      });
    }
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [], eventIds: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return patches;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function height(page: Page, locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not rendered");
  return box.height;
}

for (const vp of [
  { name: "375", width: 375, height: 812 },
  { name: "1280", width: 1280, height: 800 },
]) {
  test.describe(`/account at ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("profile first (photo, name, bio, Instagram, switch, one Save), then link rows, Sign-in, and a closed Delete", async ({
      page,
    }) => {
      const patches = await signedIn(page);
      await page.goto("/account");
      const card = page.getByRole("region", { name: "Your profile" });
      await expect(card.getByLabel("Display name")).toHaveValue("Mia T.", { timeout: 60_000 });
      const links = page.getByRole("navigation", { name: "Your account" });
      await expect(links.getByRole("link", { name: "Your events" })).toHaveAttribute("href", "/dashboard");

      // Order on the page: the profile card, the links, Sign-in, Delete.
      const tops = await Promise.all(
        [card, links, page.getByRole("heading", { name: "Sign-in" }), page.getByRole("button", { name: "Delete your profile" })].map(
          async (l) => (await l.boundingBox())?.y ?? -1,
        ),
      );
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
      expect(tops[0]).toBeGreaterThan(0);

      // The profile's photo control and its name field are on the first screen.
      await expect(card.getByText("Choose a photo")).toBeInViewport();
      await expect(card.getByLabel("Display name")).toBeInViewport();

      // 48px link rows, in order; 44px+ controls.
      const rows = links.getByRole("link");
      await expect(rows).toHaveText(["Your events", "Organisers you follow", "Messages", "Blocked members"]);
      for (let i = 0; i < 4; i++) expect(await height(page, rows.nth(i))).toBeGreaterThanOrEqual(48);
      expect(await height(page, page.getByRole("button", { name: "Sign out" }))).toBeGreaterThanOrEqual(44);
      expect(await height(page, card.getByText("Choose a photo"))).toBeGreaterThanOrEqual(44);
      expect(await height(page, card.getByRole("checkbox", { name: "Show my profile to other members" }).locator(".."))).toBeGreaterThanOrEqual(44);
      await expect(page.getByText("Sign-in methods: Email and password, Google")).toBeVisible();

      // Delete is collapsed until asked for.
      const disclosure = page.getByRole("button", { name: "Delete your profile" });
      await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("button", { name: "Delete profile", exact: true })).toBeHidden();
      await noSidewaysScroll(page);
      await shot(page, `account-${vp.name}`);

      // One Save sends the name and the rest together.
      await card.getByLabel("Display name").fill("Mia Thompson");
      await card.getByLabel("Bio (optional)").fill("Riso and noise.");
      await card.getByRole("button", { name: "Save profile" }).click();
      await expect(card.getByRole("status").filter({ hasText: "Saved." })).toContainText(
        "Events you’ve joined now show Mia Thompson.",
      );
      expect(patches).toEqual([{ displayName: "Mia Thompson", bio: "Riso and noise." }]);

      await disclosure.click();
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("button", { name: "Delete profile", exact: true })).toBeVisible();
      await noSidewaysScroll(page);
      await shot(page, `account-${vp.name}-delete-open`);
    });
  });
}
