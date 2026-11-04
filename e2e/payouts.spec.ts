import { expect, test, type Page } from "@playwright/test";
import type { AdminSummary, AdminTransfer, AdminTransfersPage, OrganiserPayouts } from "@/lib/api/types";

/**
 * Delayed payouts in a real browser: the organiser's Payouts page (totals and
 * a list per event, Load more) and the admin's /admin/payouts (filters with
 * counts, owed and last run, Retry, a confirm before Cancel), at 375px and
 * 1280px with no sideways scrolling. Live mode with a stored test session; every
 * /api/* request is answered here. Set PAYOUTS_SHOTS=<dir> to save screenshots there.
 */

const DAY = 86_400_000;
const now = Date.now();
const SHOTS = process.env.PAYOUTS_SHOTS;

function session(admin: boolean) {
  return {
    access_token: "e2e.token.x",
    token_type: "bearer",
    expires_in: 31_536_000,
    expires_at: Math.floor(now / 1000) + 31_536_000,
    refresh_token: "r",
    user: {
      id: admin ? "u-admin" : "u1",
      aud: "authenticated",
      role: "authenticated",
      email: admin ? "admin@sheltuh.example" : "mia@example.com",
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: admin ? { provider: "email", role: "admin" } : { provider: "email" },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
}

async function signIn(page: Page, admin: boolean) {
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session(admin));
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

function payoutEvent(i: number) {
  const ended = now - (i + 1) * DAY;
  return {
    eventId: `evt-${i}`,
    title: `Neon Static ${i}`,
    endsAt: new Date(ended).toISOString(),
    paidOutCents: i === 3 ? 12_000 : 0,
    pendingCents: i < 2 ? 4550 + i * 100 : 0,
    sentCents: i === 2 ? 9000 : 0,
    ...(i < 2 ? { dueAt: new Date(ended + 2 * DAY).toISOString() } : {}),
  };
}

async function organiserApi(page: Page) {
  const queries: string[] = [];
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
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
    if (path === "/api/organisers/me/payouts") {
      queries.push(url.search);
      const second = url.searchParams.get("cursor") === "c1";
      const body: OrganiserPayouts = {
        delayedPayouts: true,
        payoutDelayHours: 48,
        totals: { paidOutCents: 12_000, pendingCents: 9_100, sentCents: 9_000 },
        items: second ? [payoutEvent(3)] : [payoutEvent(0), payoutEvent(1), payoutEvent(2)],
        ...(second ? {} : { nextCursor: "c1" }),
      };
      return route.fulfill({ json: body });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return { queries };
}

const SUMMARY: AdminSummary = {
  reportsOpen: { count: 0, oldestAt: null },
  eventsPending: { count: 0, soonestStartsAt: null, startingSoon: 0, startingSoonHours: 72 },
  organisersPending: { count: 0, oldestAt: null },
  emailsFailed: { count: 0 },
  emailsRetrying: { count: 0 },
  doorEvents: { count: 0, windowHours: 24 },
  eventsPublishedByOrganisers: { count: 0, windowHours: 72 },
  // The failed and the held transfer of the list below.
  transfersOpen: { count: 2 },
};

function transfer(id: number, overrides: Partial<AdminTransfer> = {}): AdminTransfer {
  return {
    transferId: String(id),
    orderReference: `#7C1F2E0${id}`,
    orderStatus: "paid",
    eventTitle: `Neon Static ${id}`,
    eventEndsAt: new Date(now - 3 * DAY).toISOString(),
    organiserName: "Static Collective",
    amountCents: 4550,
    status: "failed",
    attempts: 5,
    lastError: "balance_insufficient",
    createdAt: new Date(now - 3 * DAY).toISOString(),
    updatedAt: new Date(now - DAY).toISOString(),
    ...overrides,
  };
}

async function adminApi(page: Page) {
  const queries: string[] = [];
  const actions: { path: string; body: unknown }[] = [];
  let cancelled = false;
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/admin/summary") return route.fulfill({ json: SUMMARY });
    if (path === "/api/admin/transfers") {
      queries.push(url.search);
      const body: AdminTransfersPage = {
        counts: { failed: cancelled ? 0 : 1, held: 1, retry: 0, sending: 0, sent: 12, cancelled: cancelled ? 1 : 0 },
        owedToOrganisersCents: cancelled ? 4550 : 9100,
        lastRun: { finishedAt: new Date(now - 2 * 3600_000).toISOString(), claimed: 4, sent: 2, retrying: 0, failed: 1 },
        items: [
          ...(cancelled ? [] : [transfer(1)]),
          transfer(2, { status: "held", lastError: "disputed", attempts: 0 }),
        ],
      };
      return route.fulfill({ json: body });
    }
    if (/^\/api\/admin\/transfers\/[^/]+\/action$/.test(path)) {
      actions.push({ path, body: route.request().postDataJSON() });
      cancelled = true;
      return route.fulfill({ json: transfer(1, { status: "cancelled", lastError: "cancelled_by_admin" }) });
    }
    if (path === "/api/organisers/me") return route.fulfill({ status: 404, json: { error: "No organiser." } });
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Admin", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return { queries, actions };
}

for (const vp of [
  { width: 375, height: 800 },
  { width: 1280, height: 900 },
]) {
  test.describe(`delayed payouts at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test("organiser Payouts: copy, totals, per-event amounts, Load more, 44px, no sideways scroll", async ({ page }) => {
      await signIn(page, false);
      const { queries } = await organiserApi(page);
      await page.goto("/dashboard/payouts");
      const main = page.getByRole("main");

      await expect(main.getByText("We send your share about 2 days after your event ends.")).toBeVisible({ timeout: 30_000 });
      await expect(main.getByRole("heading", { name: "Stripe account" })).toBeVisible();
      await expect(main.getByText("A$121.00", { exact: false }).or(main.getByText("A$120"))).toBeVisible();
      const first = main.getByRole("heading", { name: "Neon Static 0" }).locator("xpath=ancestor::li");
      await expect(first).toContainText("A$45.50, due");
      await expect(main.getByRole("heading", { name: "Neon Static 3" })).toHaveCount(0);

      const loadMore = main.getByRole("button", { name: "Load more" });
      expect((await loadMore.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await loadMore.click();
      await expect(main.getByRole("heading", { name: "Neon Static 3" })).toBeVisible();
      await expect(loadMore).toHaveCount(0);
      // (The dev server's StrictMode may run the first load twice.)
      expect(queries[0]).toBe("?limit=20");
      expect(queries.filter((q) => q.includes("cursor"))).toEqual(["?limit=20&cursor=c1"]);

      await noSidewaysScroll(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/organiser-${vp.width}.png`, fullPage: true });
    });

    test("admin Payouts: owed, filters with counts, Retry and Cancel (confirm), nav link, no sideways scroll", async ({ page }) => {
      await signIn(page, true);
      const { queries, actions } = await adminApi(page);
      await page.goto("/admin/payouts");
      const main = page.getByRole("main");

      await expect(main.getByText("Owed to organisers: A$91")).toBeVisible({ timeout: 30_000 });
      await expect(main.getByText(/Last run .*: 2 sent, 0 retrying, 1 failed \(4 picked up\)\./)).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Payouts" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(main.getByRole("button", { name: "Open (2)" })).toHaveAttribute("aria-pressed", "true");
      expect(queries[0]).toBe("?status=open");
      // The sub-nav carries the count of what needs an admin; there is no explanatory text under the heading.
      await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: /^Payouts\s*, 2 to check$/ })).toBeVisible();
      await expect(main.getByText(/about 2 days after their event ends/)).toHaveCount(0);

      const failed = main.getByRole("heading", { name: "Order #7C1F2E01: Neon Static 1" }).locator("xpath=ancestor::article");
      const held = main.getByRole("heading", { name: "Order #7C1F2E02: Neon Static 2" }).locator("xpath=ancestor::article");
      await expect(failed).toContainText("Not enough in the Stripe balance");
      await expect(failed.getByRole("button")).toHaveText(["Retry", "Cancel"]);
      await expect(held.getByRole("button")).toHaveText(["Release", "Cancel"]);
      for (const button of await main.getByRole("button", { name: /^(Retry|Release|Cancel)$/ }).all()) {
        expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      await noSidewaysScroll(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-${vp.width}.png`, fullPage: true });

      // Cancel asks first.
      await failed.getByRole("button", { name: "Cancel" }).click();
      const dialog = page.getByRole("dialog", { name: "Cancel this transfer?" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Keep it" }).click();
      await expect(dialog).toBeHidden();
      expect(actions).toHaveLength(0);

      await failed.getByRole("button", { name: "Cancel" }).click();
      await dialog.getByRole("button", { name: "Cancel transfer" }).click();
      await expect(main.getByRole("heading", { name: "Order #7C1F2E01: Neon Static 1" })).toHaveCount(0);
      expect(actions).toEqual([{ path: "/api/admin/transfers/1/action", body: { action: "cancel" } }]);
      await expect(main.getByText("Owed to organisers: A$45.50")).toBeVisible();
      await expect(main.getByRole("button", { name: "Cancelled (1)" })).toBeVisible();
      await noSidewaysScroll(page);
    });
  });
}
