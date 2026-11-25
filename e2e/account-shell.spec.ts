import { expect, test, type Page } from "@playwright/test";

/**
 * The account area in a real browser (live mode, every /api/* request answered here), as Latte's
 * 1120 frames lay it out: the black sidebar from 1024px, the Account tabs row below it (scrolling
 * sideways on a phone without the page doing so), Saved's grid with "Show 6 more", and Messages'
 * list beside (or above) the open conversation. Screenshots go to E2E_SCREENSHOT_DIR when set.
 */

const DAY = 86_400_000;
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const FAVS = Array.from({ length: 12 }, (_, i) => ({
  organiserId: "org-1",
  eventId: `e${i}`,
  slug: `e${i}`,
  title: `Saved event ${i + 1}`,
  description: "d",
  category: "art",
  venueName: "Open Studio",
  venueAddress: "1 St",
  suburb: "Coburg",
  state: "VIC",
  startsAt: iso(now + (i + 2) * DAY),
  endsAt: iso(now + (i + 2) * DAY + 3_600_000),
  organiserName: "Org",
  ticketTypes: [{ id: "t", name: "GA", priceCents: i % 3 === 0 ? 0 : 2000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  favouritedAt: iso(now - DAY),
}));

const CONVERSATIONS = ["Here & Now Collective", "High Note", "Open Studio"].map((name, i) => ({
  conversationId: `c${i + 1}`,
  otherDisplayName: name,
  status: "active",
  event: { title: "Here & Now", slug: "here-and-now" },
  lastMessage: { preview: "Doors open at 5 pm.", sentAt: iso(now - (i + 1) * 3_600_000), fromYou: false },
  unread: i === 0,
}));

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function signedIn(page: Page, profile: { profileVisible?: boolean } = {}) {
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
      email: "latte@example.com",
      email_confirmed_at: iso(now - 300 * DAY),
      app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: {},
      created_at: iso(now - 300 * DAY),
    },
  };
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/profiles/me") {
      return route.fulfill({
        json: {
          displayName: "Latte",
          suspended: false,
          createdAt: iso(now),
          updatedAt: iso(now),
          profileId: "p1",
          profileVisible: profile.profileVisible ?? false,
        },
      });
    }
    if (path === "/api/me") return route.fulfill({ json: { username: "latte", upcomingCount: 2 } });
    if (path === "/api/organisers/me") return route.fulfill({ status: 404, json: { error: "none" } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 3 } });
    if (path === "/api/conversations") return route.fulfill({ json: { items: CONVERSATIONS } });
    if (/^\/api\/conversations\/c\d\/messages$/.test(path)) {
      const id = path.split("/")[3];
      const conversation = CONVERSATIONS.find((c) => c.conversationId === id) ?? CONVERSATIONS[0];
      return route.fulfill({
        json: {
          conversation,
          items: [{ messageId: "1", body: "Doors open at 5 pm.", sentAt: iso(now - 3_600_000), fromYou: false }],
        },
      });
    }
    if (path.endsWith("/read")) return route.fulfill({ status: 204, body: "" });
    if (path === "/api/favourites/ids") return route.fulfill({ json: { eventIds: FAVS.map((f) => f.eventId) } });
    if (path === "/api/favourites") return route.fulfill({ json: { items: FAVS } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("account area at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("the sidebar: who's signed in, the five places with counts, the current one marked; three cards a row, six at a time", async ({
    page,
  }) => {
    await signedIn(page);
    await page.goto("/saved");
    const sidebar = page.locator("[data-account-sidebar]");
    await expect(sidebar.getByText("@latte · 2 upcoming")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("[data-account-tabs]")).toBeHidden();
    const nav = sidebar.getByRole("navigation", { name: "Account" });
    // Chromium reads the count's words with a space before the comma (as the header's counts, nav-account.spec.ts).
    await expect(nav.locator("[data-account-count]")).toHaveText(["2", "12", "3"]);
    await expect(nav.getByRole("link", { name: /^Saved\s*, 12 events$/ })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: /^Messages\s*, 3 unread$/ })).toHaveAttribute("href", "/messages");
    await expect(nav.getByRole("link", { name: /^My tickets\s*, 2 upcoming events$/ })).toHaveAttribute("href", "/help#where-are-my-tickets");
    await expect(nav.getByRole("link", { name: "Profile" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/account");
    const box = await sidebar.boundingBox();
    expect(box?.width).toBe(264);

    const cards = page.locator("[data-saved-card]");
    await expect(cards).toHaveCount(6);
    const tops = await Promise.all([0, 1, 2, 3].map(async (i) => (await cards.nth(i).boundingBox())?.y));
    expect(tops[0]).toBe(tops[1]);
    expect(tops[1]).toBe(tops[2]);
    expect(tops[3]).toBeGreaterThan(tops[0] ?? 0);
    await page.getByRole("button", { name: "Show 6 more" }).click();
    await expect(cards).toHaveCount(12);
    await expect(page.getByRole("link", { name: "Saved event 7" })).toBeFocused();
    await noSidewaysScroll(page);
    await shot(page, "account-shell-saved-1440");

    await sidebar.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  });

  test("Profile: its own page in the frame, the current place; the public profile once members can open it", async ({ page }) => {
    await signedIn(page, { profileVisible: true });
    await page.goto("/profile");
    const nav = page.locator("[data-account-sidebar]").getByRole("navigation", { name: "Account" });
    const profile = nav.getByRole("link", { name: "Profile" });
    // The link goes to the member page, so /profile is its location, not its page.
    await expect(profile).toHaveAttribute("aria-current", "location", { timeout: 60_000 });
    await expect(profile).toHaveAttribute("href", "/members/p1");
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Your profile" }).getByLabel("Display name")).toHaveValue("Latte");
    await expect(page.getByRole("link", { name: "See your public profile" })).toHaveAttribute("href", "/members/p1");
    await noSidewaysScroll(page);
    await shot(page, "account-shell-profile-1440");
  });
});

test.describe("account area at 768px", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("the tabs row instead of the sidebar; Messages' list beside the thread, which scrolls inside its panel", async ({ page }) => {
    await signedIn(page);
    await page.goto("/messages/c1");
    const tabs = page.locator("[data-account-tabs]");
    const current = tabs.getByRole("link", { name: /^Messages\s*, 3 unread$/ });
    await expect(current).toHaveAttribute("aria-current", "page", { timeout: 60_000 });
    await expect(page.locator("[data-account-sidebar]")).toBeHidden();
    expect(await current.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("2px");

    const list = page.getByRole("list", { name: "Conversations" });
    await expect(list.getByRole("link", { name: /Here & Now Collective/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "Here & Now Collective" })).toBeVisible();
    const listBox = await list.boundingBox();
    const threadBox = await page.getByRole("list", { name: "Messages with Here & Now Collective" }).boundingBox();
    expect(threadBox?.x).toBeGreaterThan((listBox?.x ?? 0) + (listBox?.width ?? 0));

    await list.getByRole("link", { name: /High Note/ }).click();
    await expect(page).toHaveURL(/\/messages\/c2$/);
    await expect(page.getByRole("heading", { level: 1, name: "High Note" })).toBeVisible();
    await expect(list.getByRole("link", { name: /High Note/ })).toHaveAttribute("aria-current", "page");
    await noSidewaysScroll(page);
    await shot(page, "account-shell-messages-768");
  });
});

test.describe("account area at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the tabs row scrolls sideways (44px tabs), the page doesn't; Settings stacks its cards", async ({ page }) => {
    await signedIn(page);
    await page.goto("/account");
    const tabs = page.locator("[data-account-tabs]");
    await expect(tabs.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page", { timeout: 60_000 });
    const row = tabs.locator("ul");
    const [scrollWidth, clientWidth] = await row.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    for (const link of await tabs.getByRole("link").all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    // The current tab is scrolled into reach by the keyboard: focus it and it's in view.
    await tabs.getByRole("link", { name: "Settings" }).focus();
    await expect(tabs.getByRole("link", { name: "Settings" })).toBeInViewport();
    await expect(page.getByRole("region", { name: "Sign-in" }).getByRole("button", { name: "Sign out" })).toBeVisible();
    await noSidewaysScroll(page);
    await shot(page, "account-shell-settings-390");
  });

  test("Profile in the tabs goes to /profile (not back to Settings), where it's the current tab", async ({ page }) => {
    await signedIn(page);
    await page.goto("/account");
    const tabs = page.locator("[data-account-tabs]");
    await expect(tabs.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page", { timeout: 60_000 });
    await tabs.getByRole("link", { name: "Profile" }).tap();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    await expect(tabs.locator("[aria-current]")).toHaveCount(1);
    await expect(page.getByRole("form", { name: "Your profile" }).getByLabel("Display name")).toHaveValue("Latte");
    // Hidden from members: nothing public to see yet, and Settings' other cards stay on Settings.
    await expect(page.getByRole("link", { name: "See your public profile" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Sign-in" })).toHaveCount(0);
    await noSidewaysScroll(page);
    await shot(page, "account-shell-profile-390");
  });
});
