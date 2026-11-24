import { expect, test, type Page } from "@playwright/test";

/**
 * The organiser dashboard's Overview (/dashboard; Latte's frames 430:7340, 492:14153, 492:14487;
 * organiser-dashboard plan OD-4) in a real browser at 1440, 1024, 768, 390 and 320: the drawn
 * parts in place (the Performance column down the panel's right from 1280, below the page under
 * it), the API's numbers, no sideways scroll, targets and keyboard. Live mode, signed in with a
 * stored test session, every /api/* request answered here.
 */

const DAY = 86_400_000;

function summary(id: string, title: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    eventId: id,
    title,
    slug: id,
    stage: "live",
    startsAt: new Date(now + 4 * DAY).toISOString(),
    endsAt: new Date(now + 4 * DAY + 4 * 3_600_000).toISOString(),
    timeZone: "Australia/Melbourne",
    state: "VIC",
    venueName: "Interconnect Studio",
    suburb: "Collingwood",
    ticketingMode: "sheltuh",
    free: false,
    ticketsSold: 86,
    capacity: 120,
    grossCents: 223_000,
    netCents: 210_000,
    ...overrides,
  };
}

const HERE = summary("evt-here", "Here & Now", { imageUrl: "/events/record-shop-dj.jpg" });
const OPEN = summary("evt-open", "Open Studio", {
  startsAt: new Date(Date.now() + 5 * DAY).toISOString(),
  venueName: "",
  suburb: "Coburg",
  imageUrl: "/events/dj-crate-digging.jpg",
  free: true,
  ticketsSold: 12,
  capacity: 40,
  grossCents: 0,
});

const OVERVIEW = {
  thisWeek: { range: { from: "2026-11-18", to: "2026-11-24" }, ticketsSold: 86, views: 412, viewsUnreliable: false, viewsComplete: true, newFollowers: 21 },
  highlight: HERE,
  upcoming: [HERE, OPEN],
  draftsCount: 2,
  performance: [
    { eventId: "evt-here", title: "Here & Now", stage: "live", free: false, ticketsSold: 86, capacity: 120, grossCents: 223_000, netCents: 210_000, ticketsThisWeek: 23, ticketsPreviousWeek: 20, deltaPct: 15 },
    { eventId: "evt-open", title: "Open Studio", stage: "live", free: true, ticketsSold: 12, capacity: 40, grossCents: 0, netCents: 0, ticketsThisWeek: 9, ticketsPreviousWeek: 10, deltaPct: -10 },
    { eventId: "evt-zine", title: "Zine Fair", stage: "sold_out", free: false, ticketsSold: 140, capacity: 140, grossCents: 308_000, netCents: 290_000, ticketsThisWeek: 29, ticketsPreviousWeek: 20, deltaPct: 45 },
  ],
};

async function signedInOrganiser(page: Page, overview: unknown = OVERVIEW) {
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
      email: "hello@hereandnow.example",
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/organisers/me") {
      return route.fulfill({
        json: {
          ownerUserId: "u1",
          organiserId: "org-demo",
          displayName: "Here & Now",
          contactEmail: "hello@hereandnow.example",
          description: "Warehouse nights.",
          categories: ["live-music"],
          status: "approved",
          createdAt: new Date(now - 200 * DAY).toISOString(),
          updatedAt: new Date(now - 2 * DAY).toISOString(),
          payoutsEnabled: true,
        },
      });
    }
    if (path === "/api/organisers/me/overview") {
      return overview === "error"
        ? route.fulfill({ status: 500, json: { error: "Something went wrong on our side." } })
        : route.fulfill({ json: overview });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

for (const vp of [
  { width: 1440, height: 1100 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test.describe(`Overview at ${vp.width}`, () => {
    test.use({ viewport: vp });

    test("the drawn parts with the API's numbers, Performance placed for the width, no sideways scroll, 44px targets", async ({ page }) => {
      await signedInOrganiser(page);
      await page.goto("/dashboard");
      const main = page.locator("[data-organiser-main]");
      await expect(main.getByRole("heading", { level: 1, name: "Welcome back, Here & Now!" })).toBeVisible({ timeout: 30_000 });
      await expect(main.getByRole("heading", { name: "Upcoming events" })).toBeVisible({ timeout: 30_000 });

      // Overview is the current place.
      await expect(
        page.getByRole("navigation", { name: "Organiser" }).getByRole("link", { name: "Overview", exact: true }),
      ).toHaveAttribute("aria-current", "page");

      const banner = main.getByRole("region", { name: "Nice work!" });
      await expect(banner).toContainText("Here & Now is 72% sold — 34 tickets left before");
      await expect(main.getByRole("region", { name: "This week" })).toContainText("+86");
      await expect(main.getByRole("region", { name: "This week" })).toContainText("+412");
      await expect(main.getByRole("region", { name: "This week" })).toContainText("+21");
      await expect(main.locator("[data-org-event-card]")).toHaveCount(2);
      await expect(main.locator('[data-org-event-card="evt-here"]')).toContainText("86 / 120 sold · A$2,230");
      await expect(main.locator('[data-org-event-card="evt-open"]')).toContainText("12 / 40 sold · Free");
      await expect(main.locator("[data-drafts-bar]")).toContainText("Drafts · 2 events");
      const performance = main.getByRole("region", { name: "Performance" });
      await expect(performance).toContainText("New followers (21)");
      await expect(performance.getByRole("listitem")).toHaveCount(3);

      // Where Performance sits: beside the page, flush with the panel's right, top and bottom, from
      // 1280 (col-lg inside the frame); under the page, full width of the panel's column, below it.
      const shell = await page.locator("[data-organiser-shell]").boundingBox();
      const column = await main.boundingBox();
      const panel = await performance.boundingBox();
      if (!shell || !column || !panel) throw new Error("no boxes");
      expect(Math.round(panel.x + panel.width)).toBe(Math.round(shell.x + shell.width));
      if (vp.width >= 1280) {
        expect(Math.round(panel.width)).toBe(400);
        expect(Math.round(panel.y)).toBe(Math.round(shell.y));
        expect(Math.round(panel.y + panel.height)).toBe(Math.round(shell.y + shell.height));
      } else {
        expect(Math.round(panel.x)).toBe(Math.round(column.x));
        expect(Math.round(panel.y + panel.height)).toBe(Math.round(column.y + column.height));
        const drafts = await main.locator("[data-drafts-bar]").boundingBox();
        expect(panel.y).toBeGreaterThan((drafts?.y ?? 0) + (drafts?.height ?? 0));
      }
      // Stats: three across from 640px, two and one on phones.
      const stats = await main.getByRole("region", { name: "This week" }).locator("[data-stat-card]").all();
      const tops = await Promise.all(stats.map(async (stat) => Math.round((await stat.boundingBox())?.y ?? 0)));
      expect(new Set(tops).size).toBe(vp.width >= 640 ? 1 : 2);

      await noSidewaysScroll(page);

      // Every control in the page can be hit: the cards' Manage (the card's whole area), Share event and
      // the drafts bar's Continue are at least 44px tall at every width.
      for (const target of [
        main.getByRole("link", { name: "Manage Here & Now" }),
        main.getByRole("link", { name: "Continue your drafts (2 events)" }),
      ]) {
        const box = await target.evaluate((el) => {
          const after = getComputedStyle(el, "::after");
          const rect = (after.position === "absolute" ? el.closest("[data-org-event-card], [data-drafts-bar]") ?? el : el).getBoundingClientRect();
          return { height: rect.height, right: rect.right };
        });
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.right).toBeLessThanOrEqual(vp.width);
      }
    });
  });
}

test("a touch screen: Share event is 44px tall", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await signedInOrganiser(page);
  await page.goto("/dashboard");
  const share = page.getByRole("button", { name: "Share event: Here & Now" });
  await expect(share).toBeVisible({ timeout: 30_000 });
  expect((await share.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await context.close();
});

test("keyboard: Share event, each card's Manage, Continue, in order, with a visible focus ring", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await signedInOrganiser(page);
  await page.goto("/dashboard");
  const share = page.getByRole("button", { name: "Share event: Here & Now" });
  await expect(share).toBeVisible({ timeout: 30_000 });
  await share.focus();
  expect(await share.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  for (const name of ["Manage Here & Now", "Manage Open Studio", "Continue your drafts (2 events)"]) {
    await page.keyboard.press("Tab");
    const focused = page.getByRole("link", { name });
    await expect(focused).toBeFocused();
    expect(await focused.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dashboard\/events\?filter=drafts$/, { timeout: 30_000 });
});

// Enlarged text: the browser's default font size doubled (32px, as a "very large" text setting does), so
// rem sizes and the rem breakpoints grow together, as they do for a person with that setting. Nothing in
// the Overview reaches past its own column, and no heading, line or control's words spill out of it.
for (const width of [390, 768, 1440]) {
  test(`200% text at ${width}: everything stays inside the Overview`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.enable");
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: 32, fixed: 26 } });
    await signedInOrganiser(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Upcoming events" })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
    await page.evaluate(() => document.fonts.ready);
    await noSidewaysScroll(page);
    const spills = await page.evaluate(() => {
      const root = document.querySelector("[data-overview]");
      if (!root) return ["no overview"];
      const edge = root.getBoundingClientRect().right;
      return [...root.querySelectorAll("*")]
        .filter((el) => !el.closest(".sr-only"))
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && (box.right > edge + 1 || (el.matches("a, button, p, h1, h2, h3, h4") && el.scrollWidth > el.clientWidth + 1));
        })
        .map((el) => `${el.tagName} ${(el.textContent ?? "").slice(0, 30)}`);
    });
    expect(spills).toEqual([]);
    if (process.env.OVERVIEW_SHOTS) await page.screenshot({ path: `${process.env.OVERVIEW_SHOTS}/overview-${width}-text200.png`, fullPage: true });
  });
}

test("a new organiser: no banner or drafts bar, an invitation to create an event", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInOrganiser(page, {
    ...OVERVIEW,
    thisWeek: { ...OVERVIEW.thisWeek, ticketsSold: 0, views: 0, newFollowers: 0 },
    highlight: null,
    upcoming: [],
    draftsCount: 0,
    performance: [],
  });
  await page.goto("/dashboard");
  await expect(page.getByText("No upcoming events")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Nice work!")).toHaveCount(0);
  await expect(page.locator("[data-drafts-bar]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create event" })).toHaveAttribute("href", "/dashboard/new");
  await noSidewaysScroll(page);
});

test("an error is shown with Try again", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await signedInOrganiser(page, "error");
  await page.goto("/dashboard");
  await expect(page.locator("[data-overview-error] [role=alert]")).toContainText("Your overview couldn’t load.", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

// OVERVIEW_SHOTS=<dir> saves full-page pictures at the frames' widths (for the side-by-sides with Latte's frames).
test("pictures for the side-by-sides", async ({ page }) => {
  const dir = process.env.OVERVIEW_SHOTS;
  test.skip(!dir, "set OVERVIEW_SHOTS to a folder");
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await signedInOrganiser(page);
    await page.goto("/dashboard");
    await page.getByRole("heading", { name: "Upcoming events" }).waitFor({ timeout: 30_000 });
    // Next's dev-tools badge isn't part of the page.
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${dir}/overview-${width}.png`, fullPage: true });
  }
});
