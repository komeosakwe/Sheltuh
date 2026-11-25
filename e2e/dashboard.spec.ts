import { expect, test, type Page } from "@playwright/test";

/**
 * The organiser's dashboard pages around the events list (which has its own spec,
 * e2e/organiser-events.spec.ts): no frame or nav until the organiser is approved, the nav on the
 * other organiser pages marking where they are (and not at the door), and a published event's page.
 * Live mode, signed in with a stored test session (no network: the Supabase URL is a local
 * placeholder), with every /api/* request answered here.
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

test("no organiser frame or nav until the organiser is approved", async ({ page }) => {
  await signedInWithEvents(page, [], { status: "pending" });
  await page.goto("/dashboard/events");
  await expect(page.getByText("Your organiser application is still pending review.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "Organiser" })).toHaveCount(0);
  await expect(page.locator("[data-organiser-shell]")).toHaveCount(0);
});

test("the organiser nav is on the other organiser pages, marking where you are, and not at the door", async ({ page }) => {
  // Five pages in one test: on a cold dev server each compiles on first visit.
  test.slow();
  await signedInWithEvents(page, DASHBOARD_EVENTS);
  for (const [path, current, state] of [
    ["/dashboard", "Overview", "page"],
    ["/dashboard/payouts", "Payouts", "page"],
    ["/dashboard/profile", "Profile", "page"],
    ["/dashboard/analytics", "Analytics", "page"],
    ["/dashboard/new", "Events", "true"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Organiser" }).getByRole("link", { name: current, exact: true })).toHaveAttribute(
      "aria-current",
      state,
      { timeout: 30_000 },
    );
  }
  await page.goto("/dashboard/evt-live/check-in");
  await expect(page.locator("[data-door]")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "Organiser" })).toHaveCount(0);
  await expect(page.locator("[data-organiser-shell]")).toHaveCount(0);
});

test("a published event's page lists sold / total and releases more tickets (phone width, 44px controls)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const live = event("evt-live", "Neon Static: warehouse night", {
    status: "published",
    ticketingLocked: true,
    ticketTypes: [
      ...PAID,
      { id: "vip", name: "VIP seats", priceCents: 9000, feePolicy: "buyer-pays", quantityAvailable: 20, seated: true },
    ],
    ticketsSold: { ga: 100, vip: 3 },
  });
  await signedInWithEvents(page, [live]);
  let released: unknown = null;
  await page.route("**/api/organisers/me/events/evt-live", (route) => route.fulfill({ json: live }));
  await page.route("**/api/events/evt-live/ticket-types/ga/release", (route) => {
    released = route.request().postDataJSON();
    return route.fulfill({
      json: { eventId: "evt-live", ticketTypeId: "ga", quantityAvailable: 150, quantitySold: 100 },
    });
  });
  await page.goto("/dashboard/evt-live");
  await expect(page.getByRole("heading", { name: "Release more tickets" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("100 sold / 100")).toBeVisible();
  await expect(page.getByText("VIP seats")).toHaveCount(0);

  const input = page.getByLabel("New total");
  const save = page.getByRole("button", { name: "Save" });
  for (const control of [input, save]) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await input.fill("100");
  await save.click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter more than 100." })).toBeVisible();

  await input.fill("150");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Released. Now 150 on sale." })).toBeVisible();
  await expect(page.getByText("100 sold / 150")).toBeVisible();
  expect(released).toEqual({ quantityAvailable: 150 });
});
