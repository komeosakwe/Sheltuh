import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import type { GoingAttendee } from "@/lib/api/types";
import { weekendWindow } from "@/lib/home-sections";

/**
 * The owner's two mockups of 8 Nov 2026, in a real browser (live mode, every /api/* answered here):
 * the home's This weekend (the feature head, its own cards in a sideways rail at every width, the
 * going strip from a trending count) and the event page's Who's going row (the count, up to five
 * faces, View attendees to the panel). Events are re-timed into this weekend's window
 * whatever day the suite runs.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function weekendSlots(now: number): [number, number][] {
  const window = weekendWindow(new Date(now));
  const from = Math.max(window.start, now);
  // Late on a Sunday there's no room to start one: they're under way instead (which still counts).
  return window.end - from > 4 * HOUR
    ? [
        [from + HOUR, from + 2 * HOUR],
        [from + 2 * HOUR, from + 3 * HOUR],
      ]
    : [
        [now - HOUR, now + 3 * HOUR],
        [now - 2 * HOUR, now + 3 * HOUR],
      ];
}

function fixtures(now: number): PublicEvent[] {
  const [a, b] = weekendSlots(now);
  const base = {
    organiserId: "org-demo",
    description: "A night of live music.",
    category: "live-music" as const,
    organiserName: "MONTE",
    ticketingMode: "sheltuh" as const,
    externalFree: false,
    externalProvider: null,
  };
  return [
    {
      ...base,
      eventId: "evt-here-now",
      slug: "here-and-now",
      title: "Here & Now",
      venueName: "INTERCONNECT STUDIO",
      venueAddress: "16 Catherine St",
      suburb: "Coburg North",
      startsAt: new Date(a[0]).toISOString(),
      endsAt: new Date(a[1]).toISOString(),
      imageUrl: "/events/record-shop-dj.jpg",
      // A$24.00 + the booking fee (lib/fees.ts) = A$25.94.
      ticketTypes: [{ id: "hn-ga", name: "General admission", priceCents: 2400, feePolicy: "buyer-pays", quantityAvailable: 100 }],
    },
    {
      ...base,
      eventId: "evt-high-note",
      slug: "high-note-turns-3",
      title: "High Note Turns 3",
      venueName: "Northcote Theatre",
      venueAddress: "216 High St",
      suburb: "Northcote",
      startsAt: new Date(b[0]).toISOString(),
      endsAt: new Date(b[1]).toISOString(),
      ticketTypes: [
        { id: "hi-1", name: "Standing", priceCents: 6274, feePolicy: "buyer-pays", quantityAvailable: 100 },
        { id: "hi-2", name: "Seated", priceCents: 8000, feePolicy: "buyer-pays", quantityAvailable: 100 },
      ],
    },
    {
      ...base,
      eventId: "evt-later",
      slug: "later-gig",
      title: "Later Gig",
      venueName: "Gallery",
      venueAddress: "1 Smith St",
      suburb: "Fitzroy",
      startsAt: new Date(now + 9 * DAY).toISOString(),
      endsAt: new Date(now + 9 * DAY + 2 * HOUR).toISOString(),
      ticketTypes: [{ id: "l-1", name: "Entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 100 }],
    },
  ];
}

const ATTENDEES: GoingAttendee[] = [
  { attendeeId: "a1", displayName: "Kofi A.", isYou: false, profileId: "p1", hasAvatar: false },
  { attendeeId: "a2", displayName: "Ama B.", isYou: false },
  { attendeeId: "a3", displayName: "Jide C.", isYou: false },
  { attendeeId: "a4", displayName: "Lena D.", isYou: false },
];

async function signedIn(page: Page) {
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
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
}

async function mockApi(page: Page, { going = 42 }: { going?: number } = {}) {
  const events = fixtures(Date.now());
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/events") {
      if (url.searchParams.get("recent") === "only") return route.fulfill({ json: { items: [] } });
      return route.fulfill({ json: { items: events, nextCursor: undefined } });
    }
    if (path === "/api/events/trending") {
      return route.fulfill({
        json: {
          items: [
            { event: events[0], label: "going", goingCount: 42 },
            { event: events[1], label: "going", goingCount: 118 },
            { event: events[2], label: "popular" },
          ],
        },
      });
    }
    const slug = path.match(/^\/api\/events\/slug\/(.+)$/);
    if (slug) {
      const event = events.find((e) => e.slug === decodeURIComponent(slug[1]));
      return event ? route.fulfill({ json: event }) : route.fulfill({ status: 404, json: { error: "Event not found." } });
    }
    if (/\/going$/.test(path)) return route.fulfill({ json: { count: going, countHidden: going < 3, closed: false } });
    if (/\/going\/me$/.test(path)) return route.fulfill({ json: { going: false, eligible: false, hasProfile: true } });
    if (/\/going\/attendees$/.test(path)) return route.fulfill({ json: { items: ATTENDEES } });
    if (path === "/api/profiles/me") {
      return route.fulfill({
        json: { displayName: "Mia T.", suspended: false, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      });
    }
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [] } });
    if (/\/view$/.test(path)) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

const sidewaysOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("This weekend at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the feature head, about 1.15 cards across, the going strip from the trending count, and named actions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi(page);
    await page.goto("/");
    const section = page.getByRole("region", { name: "This weekend" });
    await expect(section).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    // A real h2, the dates under it, and All events to /events.
    await expect(section.getByRole("heading", { level: 2 })).toHaveText("This weekend");
    await expect(section.getByText(/^(?:Fri \d+( \w+)? – Sun \d+ \w+|Until Sun \d+ \w+)$/)).toBeVisible();
    const all = section.getByRole("link", { name: "All events" });
    await expect(all).toHaveAttribute("href", "/events");
    expect((await all.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    const cards = section.locator("[data-event-card]");
    await expect(cards).toHaveCount(2);
    const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
    if (!a || !b) throw new Error("cards not laid out");
    const across = (390 - a.x) / (a.width + 12);
    expect(across).toBeGreaterThan(1.1);
    expect(across).toBeLessThan(1.25);
    expect(b.x + b.width).toBeGreaterThan(390);

    const first = cards.first();
    await expect(first.getByRole("heading", { level: 3 })).toHaveText("Here & Now");
    await expect(first.locator("[data-card-going]")).toHaveText("42 going");
    await expect(cards.nth(1).locator("[data-card-going]")).toHaveText("118 going");
    await expect(first.locator("[data-card-foot]")).toContainText("A$25.94 incl. booking fee");
    await expect(cards.nth(1).locator("[data-card-foot]")).toContainText("From A$67");
    await expect(first).not.toContainText(/featured/i);

    // Save (signed out: sign in, then back to save) and the arrow, each a 44px target named for the event.
    const save = first.getByRole("link", { name: "Sign in to save Here & Now" });
    const open = first.getByRole("link", { name: "Open Here & Now" });
    for (const target of [save, open]) {
      const box = await target.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(open).toHaveAttribute("href", "/events/here-and-now");
    // Keyboard focus rings the card from its title link (a visible outline, never removed).
    await first.locator("[data-card-link]").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const ring = await first.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(ring).toBe("solid");
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

    await open.click();
    await expect(page).toHaveURL(/\/events\/here-and-now$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Here & Now", { timeout: 30_000 });
  });
});

for (const width of [320, 1280, 1440]) {
  test.describe(`This weekend and Who's going? at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("no sideways page scroll on the home or the event page", async ({ page }) => {
      await mockApi(page);
      await page.goto("/");
      await expect(page.getByRole("region", { name: "This weekend" }).locator("[data-event-card]").first()).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
      if (width >= 640) {
        const card = await page.getByRole("region", { name: "This weekend" }).locator("[data-event-card]").first().boundingBox();
        expect(Math.round(card?.width ?? 0)).toBe(256);
      }
      await page.goto("/events/here-and-now");
      await expect(page.getByRole("region", { name: "Who’s going?" })).toBeVisible({ timeout: 30_000 });
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("Who's going? on the event page at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("signed in: the count and the faces after Save/Share (before the tickets); View attendees goes to the panel", async ({ page }) => {
    await signedIn(page);
    await mockApi(page);
    await page.goto("/events/here-and-now");
    const card = page.getByRole("region", { name: "Who’s going?" });
    await expect(card).toBeVisible({ timeout: 30_000 });
    // Named for screen readers by an aria-label (no extra heading); the row leads with the count (the redesign's event mock).
    await expect(card).toHaveAttribute("aria-label", "Who’s going?");
    await expect(card.getByRole("heading")).toHaveCount(0);
    await expect(card).toContainText("42 going");
    await expect(card).toContainText("Ticket holders opt in");
    // All four names this member was sent (up to five are drawn), and no "+N".
    await expect(card.locator("[data-going-face]")).toHaveCount(4);
    await expect(card.locator("[data-going-rest]")).toHaveCount(0);
    // A face with a visible profile links to it.
    await expect(card.getByRole("link", { name: "Kofi A.’s profile" })).toHaveAttribute("href", "/members/p1");

    // Below lg, under Save and Share (16px), so they stay above the bar, and inside the page's 16px margins.
    const box = await card.boundingBox();
    const actions = await page.locator("[data-event-actions]").boundingBox();
    if (!box || !actions) throw new Error("not laid out");
    expect(Math.round(box.y - (actions.y + actions.height))).toBe(16);
    expect(Math.round(box.x)).toBe(16);
    expect(Math.round(box.width)).toBe(358);

    const view = card.getByRole("link", { name: "View attendees for Here & Now" });
    const target = await view.boundingBox();
    expect(target?.height ?? 0).toBeGreaterThanOrEqual(48);
    await view.focus();
    expect(await view.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#whos-going$/);
    const panel = page.getByRole("region", { name: "Who's going" });
    await expect(panel).toBeInViewport();
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("signed out: the count alone, no faces or +N; hidden when fewer than three are going", async ({ page }) => {
    await mockApi(page);
    await page.goto("/events/here-and-now");
    const card = page.getByRole("region", { name: "Who’s going?" });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("42 going");
    await expect(card.locator("[data-going-faces]")).toHaveCount(0);
    await expect(card.locator("[data-going-rest]")).toHaveCount(0);

    await page.unrouteAll();
    await mockApi(page, { going: 2 });
    await page.reload();
    await expect(page.getByRole("region", { name: "Who's going" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Who’s going?" })).toHaveCount(0);
  });
});
