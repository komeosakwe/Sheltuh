import { expect, test, type Page } from "@playwright/test";

/**
 * The organiser dashboard's Events tab (/dashboard/events; Latte's frames 433:7341, 492:14821,
 * 492:15144; organiser-dashboard plan OD-5) in a real browser at 1440, 1024, 768, 390 and 320: the
 * chips and their counts, the card grid (three across from 1280 inside the frame, two from 640, one
 * below), the filters, no sideways scroll, targets, keyboard and enlarged text. Live mode, signed in
 * with a stored test session, every /api/* request answered here.
 */

const DAY = 86_400_000;

function summary(id: string, title: string, stage: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    eventId: id,
    title,
    slug: id,
    stage,
    startsAt: new Date(now + 4 * DAY).toISOString(),
    endsAt: new Date(now + 4 * DAY + 4 * 3_600_000).toISOString(),
    timeZone: "Australia/Melbourne",
    state: "VIC",
    venueName: "",
    suburb: "Brunswick",
    ticketingMode: "sheltuh",
    free: false,
    ticketsSold: 0,
    capacity: 80,
    grossCents: 0,
    netCents: 0,
    ...overrides,
  };
}

/** Latte's six. */
const EVENTS = [
  summary("evt-here", "Here & Now", "live", { venueName: "Interconnect Studio", ticketsSold: 86, capacity: 120, grossCents: 223_000, imageUrl: "/events/record-shop-dj.jpg" }),
  summary("evt-open", "Open Studio", "live", { startsAt: new Date(Date.now() + 5 * DAY).toISOString(), suburb: "Coburg", free: true, ticketsSold: 12, capacity: 40, imageUrl: "/events/dj-crate-digging.jpg" }),
  summary("evt-zine", "Zine Fair", "sold_out", { startsAt: new Date(Date.now() + 18 * DAY).toISOString(), ticketsSold: 140, capacity: 140, grossCents: 308_000, imageUrl: "/events/street-market.jpg" }),
  summary("evt-late", "Late Night Listening", "draft", { startsAt: new Date(Date.now() + 25 * DAY).toISOString(), suburb: "Northcote" }),
  summary("evt-print", "Print Club", "draft", { startsAt: new Date(Date.now() + 33 * DAY).toISOString(), suburb: "Fitzroy", capacity: 30 }),
  summary("evt-summer", "Summer Sessions", "ended", { startsAt: new Date(Date.now() - 30 * DAY).toISOString(), endsAt: new Date(Date.now() - 30 * DAY + 4 * 3_600_000).toISOString(), suburb: "Coburg", ticketsSold: 96, capacity: 100, grossCents: 192_000, imageUrl: "/events/gallery-opening.jpg" }),
];
const IN_FILTER: Record<string, string[]> = {
  all: ["live", "sold_out", "draft", "ended", "in_review", "changes_needed", "unpublished"],
  live: ["live", "sold_out"],
  drafts: ["draft", "in_review", "changes_needed", "unpublished"],
  past: ["ended"],
};

async function signedInOrganiser(page: Page, events: ReturnType<typeof summary>[] = EVENTS, organiser: Record<string, unknown> = {}) {
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
    const url = new URL(route.request().url());
    const path = url.pathname;
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
          logoUrl: "/events/record-shop-dj.jpg",
          createdAt: new Date(now - 200 * DAY).toISOString(),
          updatedAt: new Date(now - 2 * DAY).toISOString(),
          payoutsEnabled: true,
          ...organiser,
        },
      });
    }
    if (path === "/api/organisers/me/events/summary") {
      const filter = url.searchParams.get("filter") ?? "all";
      const count = (f: string) => events.filter((e) => IN_FILTER[f].includes(e.stage)).length;
      return route.fulfill({
        json: {
          items: events.filter((e) => IN_FILTER[filter].includes(e.stage)),
          counts: {
            all: events.length,
            live: count("live"),
            drafts: count("drafts"),
            past: count("past"),
            byStage: Object.fromEntries(
              ["live", "sold_out", "ended", "in_review", "changes_needed", "unpublished", "draft"].map((s) => [s, events.filter((e) => e.stage === s).length]),
            ),
          },
        },
      });
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
  test.describe(`Events at ${vp.width}`, () => {
    test.use({ viewport: vp });

    test("chips with counts, the cards in the grid for the width, Events current, no sideways scroll", async ({ page }) => {
      await signedInOrganiser(page);
      await page.goto("/dashboard/events");
      const main = page.locator("[data-organiser-main]");
      await expect(main.getByRole("heading", { level: 1, name: "Your events" })).toBeVisible({ timeout: 30_000 });
      await expect(main.locator("[data-org-event-card]")).toHaveCount(6, { timeout: 30_000 });
      await expect(
        page.getByRole("navigation", { name: "Organiser" }).getByRole("link", { name: "Events", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(main.getByRole("group", { name: "Filter events" }).getByRole("button")).toHaveText(["All · 6", "Live · 3", "Drafts · 2", "Past · 1"]);
      await expect(main.getByRole("link", { name: "Create event" })).toHaveAttribute("href", "/dashboard/new");
      await expect(main.locator('[data-org-event-card="evt-zine"]')).toContainText("Sold out");
      await expect(main.locator('[data-org-event-card="evt-zine"]')).toContainText("140 / 140 sold · A$3,080");
      await expect(main.locator('[data-org-event-card="evt-late"]')).toContainText("0 / 80 sold · —");
      await expect(main.getByRole("link", { name: "Continue Late Night Listening" })).toHaveAttribute("href", "/dashboard/evt-late");
      // A published event says it's live and how to change it, as the list always did.
      const here = main.locator('[data-org-event-card="evt-here"]');
      await expect(here).toContainText("Live on Sheltüh. Contact Sheltüh to change it.");
      await expect(here.getByRole("link", { name: "Contact Sheltüh" })).toHaveAttribute("href", "mailto:support@sheltuh.com.au");

      // Columns: three from 1280 (col-lg inside the frame), two from 640, one below.
      const lefts = new Set<number>();
      for (const c of await main.locator("[data-org-event-card]").all()) lefts.add(Math.round((await c.boundingBox())?.x ?? 0));
      expect(lefts.size).toBe(vp.width >= 1280 ? 3 : vp.width >= 640 ? 2 : 1);

      await noSidewaysScroll(page);
      // Every card is a target the size of the card; the chips and ··· buttons fit inside the screen.
      for (const c of await main.locator("[data-org-event-card]").all()) {
        const box = await c.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vp.width);
      }
      for (const control of await main.locator("[data-events-filter], [aria-haspopup=menu]").all()) {
        const box = await control.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vp.width);
      }
    });
  });
}

test("a chip shows its events and keeps the filter in the address; the Overview's drafts link opens on Drafts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await signedInOrganiser(page);
  await page.goto("/dashboard/events");
  const main = page.locator("[data-organiser-main]");
  await expect(main.locator("[data-org-event-card]")).toHaveCount(6, { timeout: 30_000 });
  await main.getByRole("button", { name: "Live 3" }).click();
  await expect(main.locator("[data-org-event-card]")).toHaveCount(3);
  await expect(page).toHaveURL(/\/dashboard\/events\?filter=live$/);
  await expect(main.getByRole("status")).toHaveText("Showing 3 live events.");
  await page.reload();
  await expect(main.getByRole("button", { name: "Live 3" })).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  await page.goto("/dashboard/events?filter=drafts");
  await expect(main.getByRole("button", { name: "Drafts 2" })).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  await expect(main.locator("[data-org-event-card]")).toHaveCount(2);
  await expect(main.locator("[data-org-event-card]").first()).toContainText("Continue");
  // The nav's Events link (no filter) is All again, without a reload.
  await page.getByRole("navigation", { name: "Organiser" }).getByRole("link", { name: "Events", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/events$/, { timeout: 30_000 });
  await expect(main.getByRole("button", { name: "All 6" })).toHaveAttribute("aria-pressed", "true");
  await expect(main.locator("[data-org-event-card]")).toHaveCount(6);
});

test("a touch screen: chips, ··· and Create event are 44px tall", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await signedInOrganiser(page);
  await page.goto("/dashboard/events");
  const main = page.locator("[data-organiser-main]");
  await expect(main.locator("[data-org-event-card]")).toHaveCount(6, { timeout: 30_000 });
  for (const control of [
    ...(await main.locator("[data-events-filter]").all()),
    ...(await main.locator("[aria-haspopup=menu]").all()),
    main.getByRole("link", { name: "Create event" }),
  ]) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await noSidewaysScroll(page);
  await context.close();
});

test("keyboard: Create event, the chips, then each card's ··· and Manage; ··· opens its menu on Enter", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await signedInOrganiser(page);
  await page.goto("/dashboard/events");
  const main = page.locator("[data-organiser-main]");
  await expect(main.locator("[data-org-event-card]")).toHaveCount(6, { timeout: 30_000 });
  const create = main.getByRole("link", { name: "Create event" });
  await create.focus();
  for (const name of ["All 6", "Live 3", "Drafts 2", "Past 1"]) {
    await page.keyboard.press("Tab");
    await expect(main.getByRole("button", { name })).toBeFocused();
  }
  // The first card: its line's Contact Sheltüh, its ···, then Manage (which rings the whole card).
  await page.keyboard.press("Tab");
  await expect(main.locator('[data-org-event-card="evt-here"]').getByRole("link", { name: "Contact Sheltüh" })).toBeFocused();
  await page.keyboard.press("Tab");
  const more = main.getByRole("button", { name: "More for Here & Now" });
  await expect(more).toBeFocused();
  expect(await more.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Tab");
  const manage = main.getByRole("link", { name: "Manage Here & Now" });
  await expect(manage).toBeFocused();
  expect(await manage.evaluate((el) => getComputedStyle(el.closest("article") ?? el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "More for Here & Now" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["View public page", "Orders", "Analytics", "Check-in"]);
  await expect(menu.getByRole("menuitem", { name: "View public page" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
});

test("the undrawn states keep their words on the card, and Sheltüh's note", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInOrganiser(
    page,
    [
      summary("evt-review", "Late Bloom Markets", "in_review"),
      summary("evt-back", "Tape Swap", "changes_needed", { rejectionReason: "Add the venue's accessibility details." }),
      summary("evt-dad", "dad", "draft"),
    ],
    { payoutsEnabled: false },
  );
  await page.goto("/dashboard/events");
  const main = page.locator("[data-organiser-main]");
  await expect(main.locator("[data-org-event-card]")).toHaveCount(3, { timeout: 30_000 });
  await expect(main.locator('[data-org-event-card="evt-review"]')).toContainText("In review");
  await expect(main.locator('[data-org-event-card="evt-back"]')).toContainText("Sheltüh’s note: Add the venue's accessibility details.");
  const dad = main.locator('[data-org-event-card="evt-dad"]');
  await expect(dad).toContainText("Paid tickets: set up payouts before you publish it.");
  if (process.env.EVENTS_SHOTS) {
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.screenshot({ path: `${process.env.EVENTS_SHOTS}/events-undrawn-390.png`, fullPage: true });
  }
  // The line's link sits above the card's own link.
  await dad.getByRole("link", { name: "set up payouts" }).click();
  await expect(page).toHaveURL(/\/dashboard\/payouts$/, { timeout: 30_000 });
});

test("no events yet: Create your first event", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await signedInOrganiser(page, []);
  await page.goto("/dashboard/events");
  const create = page.getByRole("link", { name: "Create your first event" });
  await expect(create).toBeVisible({ timeout: 30_000 });
  await expect(create).toHaveAttribute("href", "/dashboard/new");
  await expect(page.getByRole("main").getByRole("link", { name: "Create event" })).toHaveCount(0);
  await noSidewaysScroll(page);
});

// Enlarged text: the browser's default font size doubled (32px), so rem sizes and breakpoints grow together.
for (const width of [320, 390, 768, 1440]) {
  test(`200% text at ${width}: everything stays inside the Events tab`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.enable");
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: 32, fixed: 26 } });
    await signedInOrganiser(page);
    await page.goto("/dashboard/events");
    await expect(page.locator("[data-org-event-card]")).toHaveCount(6, { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    // Nothing outside the site footer reaches past the screen's edge. (The footer's theme switch does at 320px with
    // 200% text: site-wide, outside this page.)
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((el) => !el.closest("footer") && !el.closest(".sr-only") && el.getBoundingClientRect().right > window.innerWidth + 1)
        .map((el) => `${el.tagName} ${(el.textContent ?? "").slice(0, 30)}`),
    );
    expect(wide).toEqual([]);
    const spills = await page.evaluate(() => {
      const root = document.querySelector("[data-events-tab]");
      if (!root) return ["no events tab"];
      const edge = root.getBoundingClientRect().right;
      return [...root.querySelectorAll("*")]
        .filter((el) => !el.closest(".sr-only"))
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && (box.right > edge + 1 || (el.matches("a, button, p, h1, h2") && el.scrollWidth > el.clientWidth + 1));
        })
        .map((el) => `${el.tagName} ${(el.textContent ?? "").slice(0, 30)}`);
    });
    expect(spills).toEqual([]);
  });
}

// EVENTS_SHOTS=<dir> saves full-page pictures at the frames' widths (for the side-by-sides with Latte's frames).
test("pictures for the side-by-sides", async ({ page }) => {
  const dir = process.env.EVENTS_SHOTS;
  test.skip(!dir, "set EVENTS_SHOTS to a folder");
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await signedInOrganiser(page);
    await page.goto("/dashboard/events");
    await page.locator("[data-org-event-card]").first().waitFor({ timeout: 30_000 });
    // Next's dev-tools badge isn't part of the page.
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${dir}/events-${width}.png`, fullPage: true });
  }
});
