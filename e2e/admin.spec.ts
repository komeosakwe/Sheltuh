import { expect, test, type Page } from "@playwright/test";
import type { AdminEventRecord, AdminOrganiserRecord, AdminSummary, CheckInSummary } from "@/lib/api/types";

/**
 * The admin area in a real browser: the hub, the sub-nav and the main nav's
 * Admin badge driven by GET /api/admin/summary; the event queue's filters in
 * the URL, confirm before Approve, and focus and the status line after it;
 * the organiser list's filter and search in the URL; an admin's way back
 * from door check-in; no sideways scrolling at 320px. Live mode, signed in as an admin with a
 * stored test session (the Supabase URL is a local placeholder), with every
 * /api/* request answered here.
 */

const DAY = 86_400_000;
const now = Date.now();

const SUMMARY: AdminSummary = {
  reportsOpen: { count: 2, oldestAt: new Date(now - 3 * DAY).toISOString() },
  eventsPending: {
    count: 2,
    soonestStartsAt: new Date(now + DAY).toISOString(),
    startingSoon: 1,
    startingSoonHours: 72,
  },
  organisersPending: { count: 1, oldestAt: new Date(now - DAY).toISOString() },
  emailsFailed: { count: 0 },
  emailsRetrying: { count: 1 },
  doorEvents: { count: 1, windowHours: 24 },
};

function event(i: number, overrides: Partial<AdminEventRecord> = {}): AdminEventRecord {
  const start = now + i * DAY;
  return {
    organiserId: "org-1",
    eventId: `00000000-0000-4000-8000-00000000000${i}`,
    slug: `event-${i}`,
    title: `Event ${i}`,
    description: "Four bands, one room.",
    category: "live-music",
    venueName: "The Tote",
    venueAddress: "71 Johnston St",
    suburb: "Collingwood",
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 3 * 3600_000).toISOString(),
    organiserName: "Static Collective",
    ticketTypes: [{ id: "ga", name: "General", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 100 }],
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
    ticketingLocked: false,
    status: "pending_review",
    moderationLog: [],
    createdAt: new Date(now - DAY).toISOString(),
    updatedAt: new Date(now - DAY).toISOString(),
    organiserPlatformManaged: false,
    curation: { boost: 1, excluded: false },
    ...overrides,
  };
}

const ORGANISER: AdminOrganiserRecord = {
  ownerUserId: "u-org",
  organiserId: "org-1",
  displayName: "Neon Collective",
  contactEmail: "hello@neon.example",
  description: "Loud nights in small rooms.",
  categories: ["live-music"],
  status: "approved",
  createdAt: new Date(now - 30 * DAY).toISOString(),
  updatedAt: new Date(now - 30 * DAY).toISOString(),
  recentEdits: [],
};

const DOOR_SUMMARY: CheckInSummary = {
  event: {
    eventId: event(3).eventId,
    title: "Event 3",
    startsAt: event(3).startsAt,
    endsAt: event(3).endsAt,
  },
  checkedIn: 0,
  ticketsSold: 10,
  capacity: 100,
  byTicketType: [{ ticketTypeId: "ga", name: "General", checkedIn: 0, ticketsSold: 10, capacity: 100 }],
  recent: [],
};

/**
 * Signs in as an admin (unless `signedIn: false`) and answers the API;
 * returns the event-list and organiser-list queries seen.
 */
async function signedInAsAdmin(page: Page, { signedIn = true, summary = SUMMARY }: { signedIn?: boolean; summary?: AdminSummary } = {}) {
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
  const listQueries: string[] = [];
  const organiserQueries: string[] = [];
  let approved = false;
  if (signedIn) {
    await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  }
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/admin/summary") {
      return route.fulfill({
        json: approved ? { ...summary, eventsPending: { ...summary.eventsPending, count: 1 } } : summary,
      });
    }
    if (path === "/api/admin/events") {
      listQueries.push(url.search);
      const status = url.searchParams.get("status");
      if (status === "published") {
        return route.fulfill({ json: { items: [event(3, { status: "published", organiserPlatformManaged: true })] } });
      }
      const items = [event(1), event(2)].filter((e) => !(approved && e.eventId === event(1).eventId));
      return route.fulfill({ json: { items } });
    }
    if (path === "/api/admin/organisers") {
      organiserQueries.push(url.search);
      return route.fulfill({ json: { items: url.searchParams.get("status") === "approved" ? [ORGANISER] : [] } });
    }
    // An admin with no organiser of their own, at a Sheltüh-run event's door.
    if (path === "/api/organisers/me") return route.fulfill({ status: 404, json: { error: "No organiser." } });
    if (path === `/api/organisers/me/events/${event(3).eventId}/check-ins`) return route.fulfill({ json: DOOR_SUMMARY });
    if (/^\/api\/admin\/events\/[^/]+\/approve$/.test(path)) {
      approved = true;
      return route.fulfill({ json: event(1, { status: "published" }) });
    }
    if (path === "/api/events/slug/event-1") {
      // The admin record is a public event plus admin-only fields, which the page ignores.
      return route.fulfill({ json: event(1, { status: "published" }) });
    }
    if (/\/view$/.test(path)) return route.fulfill({ status: 204 });
    if (/\/going(\/|$)/.test(path)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    if (path === "/api/events/trending") return route.fulfill({ json: { items: [] } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Admin", suspended: false } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return { listQueries, organiserQueries };
}

// Chromium names a link "Reports , 2 open" (a space before the visually hidden count), as it does
// "Messages , 2 unread"; screen readers read both the same, so the names are matched loosely.

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of [
  { width: 320, height: 640 },
  { width: 1280, height: 900 },
]) {
  test.describe(`admin at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test("the hub says what needs you, with counts, in headed sections; the sub-nav carries them too", async ({ page }) => {
      await signedInAsAdmin(page);
      await page.goto("/admin");
      const needs = page.getByRole("region", { name: "Needs you" });
      await expect(needs.getByRole("link", { name: /^Event submissions/ })).toContainText(
        "2 waiting · 1 starts within 3 days",
        { timeout: 30_000 },
      );
      await expect(needs.getByRole("link", { name: /^Failed ticket emails/ })).toContainText("All clear");
      await expect(page.getByRole("heading", { level: 2 })).toHaveText([
        "Needs you",
        "Manage",
        "Done outside Sheltüh admin",
      ]);
      const subNav = page.getByRole("navigation", { name: "Admin" });
      await expect(subNav.getByRole("link", { name: /^Reports\s*, 2 open$/ })).toBeVisible();
      await expect(subNav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
      for (const link of await subNav.getByRole("link").all()) {
        const box = await link.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      if (vp.width === 320) {
        // Three rows of 44px links, and little else: on phones the links' own padding is the only gap.
        expect((await subNav.boundingBox())?.height ?? 0).toBeLessThanOrEqual(3 * 44 + 10);
      }
      await noSidewaysScroll(page);
    });

    test("the event queue: no sideways scrolling, and the published list keeps its filter in the URL", async ({ page }) => {
      const { listQueries } = await signedInAsAdmin(page);
      await page.goto("/admin/events");
      await expect(page.getByRole("heading", { level: 3, name: "Event 1" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("article", { name: "Event 1" })).toContainText("General: A$31.70 incl. booking fee");
      await noSidewaysScroll(page);

      await page.getByRole("group", { name: "Show events" }).getByRole("button", { name: "Published" }).click();
      await expect(page).toHaveURL(/\/admin\/events\?status=published$/);
      await expect(page.getByRole("link", { name: "Door check-in: Event 3" })).toBeVisible();
      expect(listQueries.at(-1)).toBe("?status=published&upcoming=1");
      await noSidewaysScroll(page);

      await page.reload();
      await expect(page.getByRole("group", { name: "Show events" }).getByRole("button", { name: "Published" })).toHaveAttribute(
        "aria-pressed",
        "true",
        { timeout: 30_000 },
      );
    });

    test("Find an organiser opens Approved, from the URL; a search keeps focus in the box", async ({ page }) => {
      const { organiserQueries } = await signedInAsAdmin(page);
      await page.goto("/admin");
      await page.getByRole("region", { name: "Manage" }).getByRole("link", { name: /^Find an organiser/ }).click();
      await expect(page).toHaveURL(/\/admin\/organisers\?status=approved$/);
      await expect(page.getByRole("button", { name: "Approved" })).toHaveAttribute("aria-pressed", "true", {
        timeout: 30_000,
      });
      await expect(page.getByRole("heading", { level: 3, name: "Neon Collective" })).toBeVisible();
      const box = page.getByRole("searchbox", { name: "Search by name, email or handle" });
      await box.fill("neon");
      await box.press("Enter");
      await expect(page).toHaveURL(/\/admin\/organisers\?status=approved&q=neon$/);
      await expect(page.getByText("Matching “neon”.", { exact: true })).toBeVisible();
      await expect(box).toBeFocused();
      expect(organiserQueries.at(-1)).toBe("?status=approved&q=neon");
      await noSidewaysScroll(page);
    });

    test("an admin's door check-in leads back to the admin door list", async ({ page }) => {
      await signedInAsAdmin(page);
      await page.goto(`/dashboard/${event(3).eventId}/check-in`);
      const back = page.getByRole("link", { name: "← Admin door list" });
      await expect(back).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1, name: "Event 3" })).toBeVisible();
      await noSidewaysScroll(page);
      await back.click();
      await expect(page).toHaveURL(/\/admin\/events\?status=published&view=door$/);
      await expect(page.getByRole("heading", { level: 2, name: /^Sheltüh-run events/ })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("link", { name: "Door check-in: Event 3" })).toBeVisible();
    });

    test("Trending page: no sideways scrolling", async ({ page }) => {
      await signedInAsAdmin(page);
      await page.goto("/admin/trending");
      await expect(page.getByText("Trending is hidden right now")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Admin");
      await noSidewaysScroll(page);
    });
  });
}

test.describe("approving by keyboard at 1280×900", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("searching and clearing the search keep focus in the search box", async ({ page }) => {
    const { listQueries } = await signedInAsAdmin(page);
    await page.goto("/admin/events");
    await expect(page.getByRole("heading", { level: 3, name: "Event 1" })).toBeVisible({ timeout: 30_000 });
    const box = page.getByRole("searchbox", { name: "Search by title or organiser" });
    await box.fill("event");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/admin\/events\?q=event$/);
    await expect(page.getByText("Matching “event”.", { exact: true })).toBeVisible();
    await expect(box).toBeFocused();
    expect(listQueries.at(-1)).toBe("?status=pending_review&q=event&upcoming=0");
    // The same search again reloads the list.
    const before = listQueries.length;
    await box.press("Enter");
    await expect.poll(() => listQueries.length).toBe(before + 1);
    await page.getByRole("button", { name: "Clear search" }).first().click();
    await expect(page).toHaveURL(/\/admin\/events$/);
    await expect(box).toBeFocused();
    await expect(box).toHaveValue("");
  });

  test("asks first, then announces the result and moves focus to the next event; the counts follow", async ({ page }) => {
    await signedInAsAdmin(page);
    await page.goto("/admin/events");
    const approve = page.getByRole("button", { name: "Approve Event 1…" });
    await expect(approve).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: /^Events\s*, 2 waiting$/ })).toBeVisible();
    await approve.focus();
    await page.keyboard.press("Enter");
    const cancel = page.getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Publish and email followers" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Published Event 1." })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Event 2" })).toBeFocused();
    await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: /^Events\s*, 1 waiting$/ })).toBeVisible();
  });
});

/** The header's height on a page, once its account links have settled. */
async function headerHeight(page: Page, path: string, ready: RegExp) {
  await page.goto(path);
  await expect(page.getByRole("link", { name: ready }).first()).toBeVisible({ timeout: 30_000 });
  const box = await page.locator("header").first().boundingBox();
  return Math.round(box?.height ?? 0);
}

test.describe("main nav", () => {
  for (const width of [1024, 1440]) {
    test(`the desktop header is the same height with and without the search bar at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signedInAsAdmin(page, { signedIn: false });
      const heights: Record<string, number> = {};
      for (const path of ["/", "/search", "/events/event-1"]) heights[path] = await headerHeight(page, path, /^Sign in$/);
      const values = Object.values(heights);
      expect(new Set(values).size, JSON.stringify(heights)).toBe(1);
      // --header-h (app/globals.css) is 70px on desktop: the header must fit it.
      expect(values[0], JSON.stringify(heights)).toBeLessThanOrEqual(70);
    });
  }

  test("the Admin badge doesn't change the header's height", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signedInAsAdmin(page);
    const withBadge = await headerHeight(page, "/", /^Admin\s*, 5 waiting$/);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await signedInAsAdmin(page, {
      summary: { ...SUMMARY, reportsOpen: { count: 0, oldestAt: null }, eventsPending: { ...SUMMARY.eventsPending, count: 0 }, organisersPending: { count: 0, oldestAt: null } },
    });
    const without = await headerHeight(page, "/", /^Admin$/);
    expect(withBadge).toBe(without);
  });

  test("the phone menu's Admin link carries the count too", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await signedInAsAdmin(page);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(
      page.getByRole("navigation", { name: "Site menu" }).getByRole("link", { name: /^Admin\s*, 5 waiting$/ }),
    ).toBeVisible({ timeout: 30_000 });
    await noSidewaysScroll(page);
  });
});
