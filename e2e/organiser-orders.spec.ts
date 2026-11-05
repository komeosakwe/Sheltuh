import { expect, test, type Page } from "@playwright/test";

/**
 * The organiser's Orders page (/dashboard/events/[id]/orders): the table on
 * desktop and stacked cards on a phone, search, Show more and the CSV export.
 * Live mode, signed in with a stored test session, with every /api/* request
 * answered here (nothing reaches a real API).
 */

const DAY = 86_400_000;
const EVENT = "evt-orders";

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

const FIRST_PAGE = [
  order(1),
  order(2, { buyerName: null, buyerEmail: null, paidCents: 0, tickets: [{ ticketTypeName: "Free list", quantity: 1 }] }),
  order(3, { status: "refunded", refundedCents: 1500 }),
];

function page_(items: unknown[], extra: Record<string, unknown> = {}) {
  return {
    event: { title: "Neon Static: warehouse night", slug: "neon-static", timeZone: "Australia/Melbourne", endsAt: new Date(Date.now() + 30 * DAY).toISOString() },
    detailsVisibleUntil: new Date(Date.now() + 400 * DAY).toISOString(),
    items,
    total: items.length,
    ...extra,
  };
}

interface Seen {
  lists: URL[];
  /** Every request URL (any /api path), to prove a search text is never in one. */
  urls: string[];
  /** The JSON bodies POSTed to .../orders/search. */
  searches: { q?: string; cursor?: string; limit?: number }[];
  csv: { authorization?: string }[];
}

async function mockOrders(page: Page): Promise<Seen> {
  const seen: Seen = { lists: [], urls: [], searches: [], csv: [] };
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
    const request = route.request();
    seen.urls.push(request.url());
    const url = new URL(request.url());
    const path = url.pathname;
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
    if (path === `/api/organisers/me/events/${EVENT}/orders`) {
      seen.lists.push(url);
      if (url.searchParams.get("cursor")) return route.fulfill({ json: page_([order(4)], { total: 4 }) });
      return route.fulfill({ json: page_(FIRST_PAGE, { nextCursor: "c2", total: 4 }) });
    }
    if (path === `/api/organisers/me/events/${EVENT}/orders/search` && request.method() === "POST") {
      const body = request.postDataJSON() as { q?: string; cursor?: string; limit?: number };
      seen.searches.push(body);
      return route.fulfill({ json: page_([order(1)], { total: 1 }) });
    }
    if (path === `/api/organisers/me/events/${EVENT}/orders.csv`) {
      seen.csv.push({ authorization: request.headers()["authorization"] });
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "private, no-store" },
        body: "Name,Email\r\n",
      });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
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

test.describe("Orders at 1280×900", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the table, search, Show more and the CSV export", async ({ page }) => {
    const seen = await mockOrders(page);
    await page.goto(`/dashboard/events/${EVENT}/orders`);
    await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible({ timeout: 30_000 });

    const table = page.getByRole("table", { name: "Orders for Neon Static: warehouse night" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText(["Name", "Email", "Tickets", "Paid", "Placed", "Status"]);
    const rows = table.getByRole("row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1)).toContainText("Buyer Number 1");
    await expect(rows.nth(1)).toContainText("2 × General admission");
    await expect(rows.nth(1)).toContainText("A$64.60");
    await expect(rows.nth(1)).toContainText("Paid");
    await expect(rows.nth(2)).toContainText("Free");
    await expect(rows.nth(2).getByText("—")).toHaveCount(2);
    await expect(rows.nth(3)).toContainText("Part refunded A$15");
    // Never an internal order id on the page.
    expect(await page.content()).not.toMatch(/ord_[0-9a-f]{8}/);
    await noSidewaysScroll(page);

    // Search: one request, 300 ms after the last keystroke.
    const search = page.getByLabel("Search orders");
    const count = page.getByRole("main").getByRole("status");
    await search.pressSequentially("buyer", { delay: 30 });
    await expect(count).toHaveText("1 order matches “buyer”.");
    expect(seen.searches.map((b) => b.q)).toEqual(["buyer"]);
    // The text searched for is in the POST body only: no request URL has it, and no GET carries q.
    expect(seen.urls.filter((u) => u.includes("buyer") || /[?&]q=/.test(u))).toEqual([]);
    expect(seen.lists.filter((u) => u.searchParams.has("q"))).toEqual([]);
    await expect(table.getByRole("row")).toHaveCount(2);
    await search.fill("");
    await expect(count).toHaveText("4 orders.");

    // Show more appends the next page.
    await page.getByRole("button", { name: "Show more" }).click();
    await expect(table.getByRole("row")).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
    expect(seen.lists.at(-1)?.searchParams.get("cursor")).toBe("c2");

    // Export CSV: authorised request, a file, and the use note beside the button.
    await expect(page.getByText("Use these details only for this event. Don't add them to a mailing list.")).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    expect((await download).suggestedFilename()).toBe("sheltuh-neon-static-orders.csv");
    expect(seen.csv).toEqual([{ authorization: "Bearer e2e.token.x" }]);
  });
});

test.describe("Orders on a 375px phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("stacked cards, no sideways scroll, and a 44px export", async ({ page }) => {
    await mockOrders(page);
    await page.goto(`/dashboard/events/${EVENT}/orders`);
    const cards = page.getByRole("list", { name: "Orders for Neon Static: warehouse night" });
    await expect(cards).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("table")).toBeHidden();
    await expect(cards.getByRole("listitem")).toHaveCount(3);
    await expect(cards.getByRole("listitem").first()).toContainText("buyer.number.1@a-rather-long-example-domain.example");
    await noSidewaysScroll(page);
    expect((await page.getByRole("button", { name: "Export CSV" }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((await page.getByLabel("Search orders").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
