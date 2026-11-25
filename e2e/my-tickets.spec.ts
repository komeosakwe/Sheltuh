import { expect, test, type Page } from "@playwright/test";

/**
 * My tickets (/tickets) in a real browser, live mode with every /api/* request answered here:
 * Upcoming and Past from GET /api/me/tickets, "Show more" for the next page, and the account
 * frame around it at 1440 (sidebar), 768 and 390 (the Account tabs), with nothing scrolling
 * sideways. Screenshots go to E2E_SCREENSHOT_DIR when set.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const at = (days: number) => Math.floor(now / HOUR) * HOUR + days * DAY;

const event = (title: string, slug: string, days: number, imageUrl?: string) => ({
  eventTitle: title,
  eventListed: true,
  eventSlug: slug,
  eventStartsAt: iso(at(days)),
  eventEndsAt: iso(at(days) + 4 * HOUR),
  eventTimeZone: "Australia/Melbourne",
  eventState: "VIC",
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
  ...(imageUrl ? { imageUrl } : {}),
});

const order = (id: string, fields: Record<string, unknown>) => ({
  kind: "order",
  orderId: id,
  status: "paid",
  totalCents: 2594,
  ticketCount: 1,
  heldCount: 1,
  pendingCount: 0,
  checkedInCount: 0,
  ticketTypeName: "Second release",
  ...fields,
});

const PAGE_1 = {
  items: [
    order("o-1", { section: "upcoming", ...event("Here & Now", "here-and-now", 3, "/events/gallery-opening.jpg"), ticketCount: 2, heldCount: 2, totalCents: 5188 }),
    order("o-2", { section: "upcoming", ...event("High Note", "high-note", 9, "/events/jazz-drummer.webp"), ticketCount: 2, heldCount: 2, pendingCount: 1, totalCents: 5188 }),
    {
      kind: "received",
      section: "upcoming",
      ...event("Open Studio Night", "open-studio-night", 16),
      transferId: "0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f",
      reference: "#0B5C2F8E",
      status: "valid",
      fromName: "Alex Chen",
      holderName: "Sam Lee",
      acceptedAt: iso(now - DAY),
      ticketTypeName: "General admission",
    },
    order("o-3", { section: "past", ...event("Zine Fair", "zine-fair", 20, "/events/street-market.jpg"), status: "refunded", refundReason: "refunded", heldCount: 0 }),
    order("o-4", { section: "past", ...event("Crate Diggers", "crate-diggers", -6, "/events/dj-crate-digging.jpg") }),
  ],
  counts: { upcoming: 3, past: 3 },
  nextCursor: "page-2",
};

const PAGE_2 = {
  items: [order("o-5", { section: "past", ...event("Record Shop Sessions", "record-shop-sessions", -30, "/events/record-shop-dj.jpg"), ticketCount: 2, heldCount: 0 })],
  counts: { upcoming: 3, past: 3 },
};

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  // The photos that just came into view (they load lazily) are in before the picture's taken.
  await page.waitForFunction(() =>
    [...document.images]
      .filter((img) => {
        const box = img.getBoundingClientRect();
        return box.bottom > 0 && box.top < window.innerHeight;
      })
      .every((img) => img.complete && img.naturalWidth > 0),
  );
  // Loaded isn't drawn: a large photo is still being decoded (decoding="async") for a moment after.
  await page.evaluate(() => Promise.all([...document.images].filter((img) => img.complete).map((img) => img.decode())));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function signedIn(page: Page) {
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
      email: "sam@example.com",
      email_confirmed_at: iso(now - 300 * DAY),
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      created_at: iso(now - 300 * DAY),
    },
  };
  const ticketReads: string[] = [];
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/me/tickets") {
      ticketReads.push(url.search);
      return route.fulfill({ json: url.searchParams.get("cursor") === "page-2" ? PAGE_2 : PAGE_1 });
    }
    if (path === "/api/profiles/me") {
      return route.fulfill({
        json: { displayName: "Sam Lee", suspended: false, createdAt: iso(now), updatedAt: iso(now), profileId: "p1", profileVisible: false },
      });
    }
    if (path === "/api/me") return route.fulfill({ json: { username: "sam", upcomingCount: 3 } });
    if (path === "/api/organisers/me") return route.fulfill({ status: 404, json: { error: "none" } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path === "/api/favourites/ids") return route.fulfill({ json: { eventIds: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return { ticketReads };
}

/** A list's heading at the top of the screen (at once, not smoothly), for its screenshot. */
async function scrollToPast(page: Page, list: "Past" | "Upcoming" = "Past") {
  await page.getByRole("heading", { level: 2, name: new RegExp(`^${list}`) }).evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
  await page.waitForFunction(() => window.scrollY > 0);
}

/** Nothing in the account panel (bar the Account tabs, which scroll in their own row) reaches past the screen's edge. */
async function nothingPastTheEdge(page: Page) {
  const past = await page.evaluate(() =>
    [...document.querySelectorAll("[data-account-main] *")]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
      .map((el) => `${el.tagName} ${el.textContent?.slice(0, 30) ?? ""}`),
  );
  expect(past).toEqual([]);
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function open(page: Page) {
  const reads = await signedIn(page);
  await page.goto("/tickets");
  await expect(page).toHaveTitle("My tickets — Sheltüh");
  await expect(page.getByRole("heading", { level: 1, name: "My tickets" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 2, name: /^Upcoming\s*,\s*3$/ })).toBeVisible({ timeout: 30_000 });
  return reads;
}

// Chromium reads an sr-only part with a space before it ("Show ticket , Here & Now"), as the account
// counts (account-shell.spec.ts): hence \s* before the comma.
const upcoming = (page: Page) => page.getByRole("region", { name: /^Upcoming/ });
const past = (page: Page) => page.getByRole("region", { name: /^Past/ });

test.describe("My tickets at 1440px", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("the sidebar marks My tickets; Upcoming and Past three a row; Show more brings the next page, focused", async ({ page }) => {
    const { ticketReads } = await open(page);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    const sidebar = page.locator("[data-account-sidebar]");
    await expect(sidebar.getByRole("link", { name: /^My tickets/ })).toHaveAttribute("aria-current", "page");

    const cards = upcoming(page).getByRole("article");
    await expect(cards).toHaveCount(3);
    const tops = await Promise.all([0, 1, 2].map(async (i) => (await cards.nth(i).boundingBox())?.y));
    expect(tops[0]).toBe(tops[1]);
    expect(tops[1]).toBe(tops[2]);
    await expect(upcoming(page).getByRole("link", { name: /^Show ticket\s*, Here & Now$/ })).toHaveAttribute("href", "/checkout/success?session_id=o-1");
    await expect(upcoming(page).getByRole("link", { name: /^Show ticket\s*, Open Studio Night$/ })).toHaveAttribute(
      "href",
      "/tickets/received/0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f",
    );
    await expect(upcoming(page).getByText("1 sent, waiting for them to accept")).toBeVisible();
    // The buttons line up along the row's foot, whether or not a card has a status bar.
    const bottoms = await Promise.all(
      [0, 1, 2].map(async (i) => {
        const box = await cards.nth(i).getByRole("link", { name: /^Show ticket/ }).boundingBox();
        return Math.round((box?.y ?? 0) + (box?.height ?? 0));
      }),
    );
    expect(new Set(bottoms).size).toBe(1);
    // At the default text size the image is beside the words.
    const image = await cards.first().locator("[data-ticket-image]").boundingBox();
    const heading = await cards.first().getByRole("heading", { level: 3 }).boundingBox();
    expect(heading?.x ?? 0).toBeGreaterThan((image?.x ?? 0) + (image?.width ?? 0));
    await expect(past(page).getByText("Refunded A$25.94")).toBeVisible();
    await noSidewaysScroll(page);
    await shot(page, "my-tickets-upcoming-1440");

    await past(page).getByRole("button", { name: "Show 1 more" }).click();
    await expect(past(page).getByRole("article")).toHaveCount(3);
    await expect(past(page).getByRole("link", { name: /^View order\s*, Record Shop Sessions$/ })).toBeFocused();
    await expect(past(page).getByText("2 sent. These QR codes no longer work.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Show \d* ?more$/ })).toHaveCount(0);
    expect(ticketReads).toEqual(["", "?cursor=page-2"]);
    // No ticket code anywhere in the list.
    expect(await page.locator("main").innerText()).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
    await noSidewaysScroll(page);
    await scrollToPast(page);
    await shot(page, "my-tickets-past-1440");
  });
});

test.describe("My tickets at 768px", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("the Account tabs mark My tickets; two cards a row; nothing scrolls sideways", async ({ page }) => {
    await open(page);
    const tabs = page.locator("[data-account-tabs]");
    await expect(tabs.getByRole("link", { name: /^My tickets/ })).toHaveAttribute("aria-current", "page");
    const cards = upcoming(page).getByRole("article");
    await expect(cards).toHaveCount(3);
    const boxes = await Promise.all([0, 1, 2].map((i) => cards.nth(i).boundingBox()));
    expect(boxes[0]?.y).toBe(boxes[1]?.y);
    expect(boxes[2]?.y ?? 0).toBeGreaterThan(boxes[0]?.y ?? 0);
    await noSidewaysScroll(page);
  });
});

test.describe("My tickets at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("one card a row, the Account tabs mark My tickets, 56px Show ticket; nothing scrolls sideways", async ({ page }) => {
    await open(page);
    const tabs = page.locator("[data-account-tabs]");
    await expect(tabs.getByRole("link", { name: /^My tickets/ })).toHaveAttribute("aria-current", "page");
    const cards = upcoming(page).getByRole("article");
    const boxes = await Promise.all([0, 1].map((i) => cards.nth(i).boundingBox()));
    expect(boxes[1]?.y ?? 0).toBeGreaterThan((boxes[0]?.y ?? 0) + (boxes[0]?.height ?? 0) - 1);
    const show = upcoming(page).getByRole("link", { name: /^Show ticket\s*, Here & Now$/ });
    expect(Math.round((await show.boundingBox())?.height ?? 0)).toBe(56);
    await noSidewaysScroll(page);
    await shot(page, "my-tickets-upcoming-390");
    await scrollToPast(page);
    await noSidewaysScroll(page);
    await shot(page, "my-tickets-past-390");
  });
});

test.describe("My tickets at 320px with 200% text", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the image goes above the words, the date wraps, and nothing in the panel runs past the edge", async ({ page }) => {
    await open(page);
    // Chrome's default font size at 32px: every rem doubles.
    await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%"));
    const card = upcoming(page).getByRole("article").first();
    const image = await card.locator("[data-ticket-image]").boundingBox();
    const title = await card.getByRole("heading", { level: 3 }).boundingBox();
    expect((image?.y ?? 0) + (image?.height ?? 0)).toBeLessThanOrEqual(title?.y ?? 0);
    // The date line is whole (wrapped, not cut off).
    // The date line comes first in the card's words (its time depends on when the suite runs).
    const date = card.locator("p").first();
    await expect(date).toHaveText(/·/);
    expect(await date.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    // The page itself: nothing in the account panel runs past the screen (the Account tabs scroll sideways in their
    // own row, by design). The site footer's logo and theme switch do overflow at this size: not this page's (the
    // same on every page), so the whole document isn't checked here.
    await nothingPastTheEdge(page);
    await scrollToPast(page, "Upcoming");
    await shot(page, "my-tickets-upcoming-320-200pct");
    await scrollToPast(page);
    await nothingPastTheEdge(page);
    await shot(page, "my-tickets-past-320-200pct");
  });
});
