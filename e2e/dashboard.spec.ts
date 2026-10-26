import { expect, test, type Page } from "@playwright/test";

/**
 * The organiser's dashboard (/dashboard) at phone and desktop widths: the
 * organiser sub-nav marks where they are, New event is an action beside the
 * heading (never marked current), and every event row says its status in
 * words and offers only the actions that apply. Live mode, signed in with a
 * stored test session (no network: the Supabase URL is a local placeholder),
 * with every /api/* request answered here.
 */

const DAY = 86_400_000;

function event(id: string, title: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    organiserId: "org-demo",
    eventId: id,
    slug: id,
    title,
    description: "d",
    category: "live-music",
    venueName: "The Corner",
    venueAddress: "57 Swan St",
    suburb: "Richmond",
    startsAt: new Date(now + 20 * DAY).toISOString(),
    endsAt: new Date(now + 20 * DAY + 3 * 3_600_000).toISOString(),
    organiserName: "Northside Noise",
    ticketTypes: [],
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
    ticketingLocked: false,
    status: "draft",
    moderationLog: [],
    createdAt: new Date(now - 10 * DAY).toISOString(),
    updatedAt: new Date(now - DAY).toISOString(),
    ...overrides,
  };
}

const PAID = [{ id: "ga", name: "General admission", priceCents: 2500, feePolicy: "buyer-pays", quantityAvailable: 100 }];

/** One of each state the dashboard says, and a seated published event (every action). */
const DASHBOARD_EVENTS = [
  event("evt-live", "Neon Static: warehouse night", {
    status: "published",
    ticketingLocked: true,
    seating: { version: 1, seatCount: 120 },
    ticketTypes: PAID,
  }),
  event("evt-dad", "dad", { suburb: "Taylors Lakes", ticketTypes: PAID }),
  event("evt-review", "Late Bloom Markets", { status: "pending_review", suburb: "Brunswick" }),
  event("evt-rejected", "Tape Swap", { status: "rejected", suburb: "Footscray" }),
  event("evt-unpublished", "Rooftop Sessions", { status: "draft", ticketingLocked: true, suburb: "Collingwood" }),
];

async function signedInWithEvents(page: Page, items: unknown[], organiser: Record<string, unknown> = {}) {
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
          ...organiser,
        },
      });
    }
    if (path === "/api/organisers/me/events") return route.fulfill({ json: { items } });
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

for (const vp of [
  { width: 320, height: 640 },
  { width: 1280, height: 900 },
]) {
  test.describe(`/dashboard at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test("the sub-nav marks Your events; New event is an action; rows show status and actions, 44px, no sideways scroll", async ({ page }) => {
      await signedInWithEvents(page, DASHBOARD_EVENTS, { payoutsEnabled: false });
      await page.goto("/dashboard");
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 2, name: "dad" })).toBeVisible({ timeout: 30_000 });

      const nav = page.getByRole("navigation", { name: "Organiser" });
      await expect(nav.getByRole("link", { name: "Your events" })).toHaveAttribute("aria-current", "page");
      for (const name of ["Payouts", "Analytics", "Public profile"]) {
        await expect(nav.getByRole("link", { name })).not.toHaveAttribute("aria-current");
      }
      const newEvent = main.getByRole("link", { name: "New event" });
      await expect(newEvent).not.toHaveAttribute("aria-current");
      await expect(newEvent).toHaveAttribute("href", "/dashboard/new");

      for (const status of ["Published", "Draft", "Waiting for review", "Rejected", "Unpublished"]) {
        await expect(main.locator("[data-event-row]").getByText(status, { exact: true })).toBeVisible();
      }
      // The payouts hint (paid draft, payouts not set up) is still there.
      await expect(main.locator('[data-event-row="evt-dad"]')).toContainText("Set up payouts to submit");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      const targets = [
        ...(await nav.getByRole("link").all()),
        newEvent,
        ...(await main.locator("[data-event-row] ul a").all()),
      ];
      expect(targets.length).toBeGreaterThan(10);
      for (const target of targets) {
        const box = await target.boundingBox();
        expect(box, await target.getAttribute("aria-label") ?? (await target.textContent()) ?? "").not.toBeNull();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vp.width);
      }

      const live = main.locator('[data-event-row="evt-live"]');
      await expect(live.getByRole("link")).toHaveText(["View", "Analytics", "Check-in", "Seat map", "View public page"]);
      await expect(main.getByRole("link", { name: "Edit dad" })).toHaveAttribute("href", "/dashboard/evt-dad");
    });
  });
}

test("keyboard: the sub-nav, then New event, then each row's actions, with a visible focus ring", async ({ page }) => {
  await signedInWithEvents(page, DASHBOARD_EVENTS);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 2, name: "dad" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("navigation", { name: "Organiser" }).getByRole("link", { name: "Public profile" }).focus();
  await page.keyboard.press("Tab");
  const newEvent = page.getByRole("main").getByRole("link", { name: "New event" });
  await expect(newEvent).toBeFocused();
  const outline = await newEvent.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "View Neon Static: warehouse night" })).toBeFocused();
});

test("an organiser with no events is invited to create their first", async ({ page }) => {
  await signedInWithEvents(page, []);
  await page.goto("/dashboard");
  const create = page.getByRole("link", { name: "Create your first event" });
  await expect(create).toBeVisible({ timeout: 30_000 });
  await expect(create).toHaveAttribute("href", "/dashboard/new");
});

test("the sub-nav is on the other organiser pages, marking where you are, and not at the door", async ({ page }) => {
  await signedInWithEvents(page, DASHBOARD_EVENTS);
  for (const [path, current, state] of [
    ["/dashboard/payouts", "Payouts", "page"],
    ["/dashboard/profile", "Public profile", "page"],
    ["/dashboard/analytics", "Analytics", "page"],
    ["/dashboard/new", "Your events", "true"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Organiser" }).getByRole("link", { name: current })).toHaveAttribute(
      "aria-current",
      state,
      { timeout: 30_000 },
    );
  }
  await page.goto("/dashboard/evt-live/check-in");
  await expect(page.locator("[data-door]")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "Organiser" })).toHaveCount(0);
});
