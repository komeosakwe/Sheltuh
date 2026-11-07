import { expect, test, type Page } from "@playwright/test";

/**
 * An admin's Orders page (/admin/events/[eventId]/orders): the organiser's
 * view for a platform-managed organiser's event. The table on desktop and
 * stacked cards on a phone, the way back to the admin edit page, and the
 * message when the API says 404 (an organiser's own event: only they see
 * their buyers). Live mode, signed in as an admin with a stored test session,
 * every /api/* request answered here.
 */

const DAY = 86_400_000;
const now = Date.now();
const EVENT = "00000000-0000-4000-8000-000000000003";
const OWN = "00000000-0000-4000-8000-000000000004";

function order(n: number, extra: Record<string, unknown> = {}) {
  return {
    reference: `K7M${n}Q2`,
    placedAt: "2026-11-04T09:05:00.000Z",
    status: "paid",
    buyerName: `Buyer Number ${n}`,
    buyerEmail: `buyer.number.${n}@a-rather-long-example-domain.example`,
    tickets: [{ ticketTypeName: "General admission", quantity: 2 }],
    paidCents: 6460,
    refundedCents: 0,
    ...extra,
  };
}

const SUMMARY = {
  reportsOpen: { count: 0 },
  eventsPending: { count: 0, startingSoon: 0, startingSoonHours: 72 },
  organisersPending: { count: 0 },
  emailsFailed: { count: 0 },
  emailsRetrying: { count: 0 },
  doorEvents: { count: 0, windowHours: 24 },
  eventsPublishedByOrganisers: { count: 0, windowHours: 72 },
};

async function mockAdminOrders(page: Page) {
  const seen: { authorization?: string }[] = [];
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
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/admin/summary") return route.fulfill({ json: SUMMARY });
    if (path === `/api/organisers/me/events/${EVENT}/orders`) {
      seen.push({ authorization: request.headers()["authorization"] });
      return route.fulfill({
        json: {
          event: { title: "Neon Static: warehouse night", slug: "neon-static", timeZone: "Australia/Melbourne", endsAt: new Date(now + 30 * DAY).toISOString() },
          detailsVisibleUntil: new Date(now + 400 * DAY).toISOString(),
          items: [order(1), order(2, { buyerName: null, buyerEmail: null, paidCents: 0, tickets: [{ ticketTypeName: "Free list", quantity: 1 }] })],
          total: 2,
        },
      });
    }
    // An organiser's own event: the API does not show its buyers to an admin.
    if (path === `/api/organisers/me/events/${OWN}/orders`) return route.fulfill({ status: 404, json: { error: "Event not found." } });
    if (path === "/api/organisers/me") return route.fulfill({ status: 404, json: { error: "No organiser." } });
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Admin", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return seen;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("Admin orders at 1280×900", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the table, with a way back to the admin edit page", async ({ page }) => {
    const seen = await mockAdminOrders(page);
    await page.goto(`/admin/events/${EVENT}/orders`);
    await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible({ timeout: 30_000 });
    const table = page.getByRole("table", { name: "Orders for Neon Static: warehouse night" });
    await expect(table).toBeVisible();
    const rows = table.getByRole("row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText("Buyer Number 1");
    await expect(rows.nth(1)).toContainText("A$64.60");
    await expect(rows.nth(2).getByText("—")).toHaveCount(2);
    await expect(page.getByRole("link", { name: /Edit event/ })).toHaveAttribute("href", `/admin/events/${EVENT}/edit`);
    // The same endpoint the organiser uses, with the admin's token (the server decides who may read which event).
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.authorization === "Bearer e2e.token.x")).toBe(true);
    await noSidewaysScroll(page);
  });

  test("an organiser's own event says only its organiser can see the buyers", async ({ page }) => {
    await mockAdminOrders(page);
    await page.goto(`/admin/events/${OWN}/orders`);
    await expect(page.getByRole("heading", { level: 1, name: "Orders not available" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Only the event’s organiser can see its buyers.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to events" })).toHaveAttribute("href", "/admin/events");
    await expect(page.getByRole("table")).toHaveCount(0);
  });
});

test.describe("Admin orders on a 390px phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("stacked cards and no sideways scroll", async ({ page }) => {
    await mockAdminOrders(page);
    await page.goto(`/admin/events/${EVENT}/orders`);
    const cards = page.getByRole("list", { name: "Orders for Neon Static: warehouse night" });
    await expect(cards).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("table")).toBeHidden();
    await expect(cards.getByRole("listitem")).toHaveCount(2);
    await expect(cards.getByRole("listitem").first()).toContainText("buyer.number.1@a-rather-long-example-domain.example");
    await noSidewaysScroll(page);
    expect((await page.getByLabel("Search orders").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
