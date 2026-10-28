import { expect, test, type Page } from "@playwright/test";
import type { AdminEventRecord, AdminInviteRecord, AdminOrganiserRecord, AdminSummary, CheckInSummary } from "@/lib/api/types";

/**
 * The admin area in a real browser: the hub, the sub-nav and the main nav's
 * Admin badge driven by GET /api/admin/summary; the event queue's filters in
 * the URL, confirm before Approve, and focus and the status line after it;
 * the organiser list's filter and search in the URL; an admin's way back
 * from door check-in; inviting someone, then resending and revoking the
 * invite; no sideways scrolling at 320px. Live mode, signed in as an admin with a
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
  eventsPublishedByOrganisers: { count: 2, windowHours: 72 },
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
  /** POST /api/admin/events/{id}/unpublish bodies (null: none sent). */
  const unpublished: unknown[] = [];
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
      if (status === "published" && url.searchParams.get("recent") === "1") {
        // Newest first: one the organiser published 2 hours ago, one an admin approved yesterday.
        return route.fulfill({
          json: {
            items: [
              event(4, { status: "published", publishedBy: "organiser", publishedAt: new Date(now - 2 * 3600_000 - 60_000).toISOString() }),
              event(5, { status: "published", publishedBy: "sheltuh", publishedAt: new Date(now - 26 * 3600_000).toISOString() }),
            ],
          },
        });
      }
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
    if (/^\/api\/admin\/events\/[^/]+\/unpublish$/.test(path)) {
      unpublished.push(route.request().postDataJSON());
      return route.fulfill({ json: event(4, { status: "draft" }) });
    }
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
  return { listQueries, organiserQueries, unpublished };
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
      await expect(page.getByRole("article", { name: "Event 1" })).toContainText("General: A$32.30 incl. booking fee");
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

    test("Recently published: from the hub card, who published each, and Unpublish with a note for the organiser", async ({
      page,
    }) => {
      const { listQueries, unpublished } = await signedInAsAdmin(page);
      await page.goto("/admin");
      const card = page.getByRole("region", { name: "Manage" }).getByRole("link", { name: /^Recently published/ });
      await expect(card).toContainText("2 by organisers in the last 3 days", { timeout: 30_000 });
      await card.click();
      await expect(page).toHaveURL(/\/admin\/events\?status=published&view=recent$/);
      await expect(page.getByRole("heading", { level: 2, name: /^Recently published/ })).toBeVisible({ timeout: 30_000 });
      expect(listQueries.at(-1)).toBe("?status=published&recent=1");
      await expect(page.getByRole("button", { name: "Recently published" })).toHaveAttribute("aria-pressed", "true");
      const self = page.getByRole("article", { name: "Event 4" });
      await expect(self).toContainText("Published by the organiser · 2 h ago");
      await expect(page.getByRole("article", { name: "Event 5" })).toContainText("Published by Sheltüh · 26 h ago");
      await noSidewaysScroll(page);

      await self.getByRole("button", { name: "Unpublish Event 4…" }).click();
      const note = self.getByLabel("Reason (optional; the organiser sees this)");
      await expect(note).toBeFocused();
      await expect(self).toContainText("If they publish it again it comes to you for review.");
      // Off unless asked for: the organiser's next events stay as they are.
      const reviewFuture = self.getByRole("checkbox", { name: "Also review this organiser’s next events" });
      await expect(reviewFuture).not.toBeChecked();
      expect((await reviewFuture.locator("..").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await note.fill("The photo isn't of this event.");
      await noSidewaysScroll(page);
      await self.getByRole("button", { name: "Yes, unpublish" }).click();
      await expect(page.getByText("Unpublished Event 4. It’s off the site and back with the organiser as a draft, with your note.")).toBeVisible();
      expect(unpublished).toEqual([{ reason: "The photo isn't of this event." }]);
      await expect(page.getByRole("article", { name: "Event 4" })).toHaveCount(0);
    });

    test("Find an organiser opens Approved, from the URL; a search keeps focus in the box", async ({ page }) => {
      const { organiserQueries } = await signedInAsAdmin(page);
      await page.goto("/admin");
      await page.getByRole("region", { name: "Manage" }).getByRole("link", { name: /^Find an organiser/ }).click();
      await expect(page).toHaveURL(/\/admin\/organisers\?status=approved$/, { timeout: 30_000 });
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

/** Answers /api/admin/invites* (after signedInAsAdmin, so these routes win); returns what was posted. */
async function mockInvites(page: Page) {
  const posted: { path: string; body: unknown }[] = [];
  let invites: AdminInviteRecord[] = [];
  const record = (email: string, overrides: Partial<AdminInviteRecord> = {}): AdminInviteRecord => ({
    inviteId: "22222222-2222-4222-8222-222222222222",
    kind: "organiser",
    email,
    status: "pending",
    organiserName: "Neon Collective",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 14 * DAY).toISOString(),
    lastSentAt: new Date(now).toISOString(),
    sendCount: 1,
    ...overrides,
  });
  await page.route("**/api/admin/invites**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "GET" && path === "/api/admin/invites") {
      const status = url.searchParams.get("status") ?? "pending";
      return route.fulfill({ json: { items: invites.filter((i) => i.status === status) } });
    }
    posted.push({ path, body: request.postData() ? request.postDataJSON() : undefined });
    if (path === "/api/admin/invites") {
      const created = record("mia@example.com");
      invites = [created];
      return route.fulfill({ status: 201, json: { invite: created, emailSent: true } });
    }
    if (path.endsWith("/resend")) {
      invites = invites.map((i) => ({ ...i, sendCount: i.sendCount + 1 }));
      return route.fulfill({ json: { invite: invites[0], emailSent: true } });
    }
    if (path.endsWith("/revoke")) {
      invites = invites.map((i) => ({ ...i, status: "revoked" as const, revokedAt: new Date().toISOString() }));
      return route.fulfill({ json: invites[0] });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  // The page's organiser links section (e2e/organiser-links.spec.ts): none yet.
  await page.route("**/api/admin/organiser-links", (route) => route.fulfill({ json: { items: [] } }));
  return posted;
}

for (const vp of [
  { width: 320, height: 640 },
  { width: 1280, height: 900 },
]) {
  test(`invites at ${vp.width}×${vp.height}: invite an organiser, resend it, revoke it`, async ({ page }) => {
    await page.setViewportSize(vp);
    await signedInAsAdmin(page);
    const posted = await mockInvites(page);
    await page.goto("/admin");
    await page.getByRole("region", { name: "Manage" }).getByRole("link", { name: "Invite someone" }).click();
    await expect(page).toHaveURL(/\/admin\/invites$/);
    await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Invites" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("No invites waiting")).toBeVisible({ timeout: 30_000 });

    const form = page.getByRole("form", { name: "Invite someone" });
    await form.getByLabel("Their email", { exact: true }).fill("mia@example.com");
    await form.getByLabel("Their email again").fill("mia@example.com");
    await form.getByLabel("Organiser name").fill("Neon Collective");
    await expect(form.getByLabel("Contact email")).toHaveValue("mia@example.com");
    await form.getByLabel("Description").fill("Loud nights in small rooms.");
    await form.getByLabel("Live music").check();
    await form.getByLabel("They asked to be invited (required)").check();
    await noSidewaysScroll(page);
    await form.getByRole("button", { name: "Send invite" }).click();

    await expect(form.getByText("Invite sent to mia@example.com. The link works for 14 days.")).toBeVisible();
    expect(posted[0]).toEqual({
      path: "/api/admin/invites",
      body: {
        kind: "organiser",
        email: "mia@example.com",
        consent: true,
        organiser: {
          displayName: "Neon Collective",
          contactEmail: "mia@example.com",
          description: "Loud nights in small rooms.",
          categories: ["live-music"],
          websiteUrl: null,
        },
      },
    });

    const article = page.getByRole("article", { name: "mia@example.com" });
    await expect(article).toContainText("Organiser: Neon Collective");
    await article.getByRole("button", { name: "Resend" }).click();
    await expect(article).toContainText("(2 emails)");
    expect(posted[1].path).toMatch(/\/resend$/);

    await article.getByRole("button", { name: "Revoke…" }).click();
    await expect(article.getByRole("button", { name: "Cancel" })).toBeFocused();
    await article.getByRole("button", { name: "Revoke invite" }).click();
    await expect(page.getByRole("article", { name: "mia@example.com" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Invites waiting to be accepted" })).toBeFocused();
    expect(posted[2].path).toMatch(/\/revoke$/);
    await noSidewaysScroll(page);
  });
}

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
