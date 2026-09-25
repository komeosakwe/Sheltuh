import { expect, test, type Route } from "@playwright/test";

/**
 * True browser-level (Chromium) tests of the live public feed's pagination,
 * run against a real `next dev` server with the network layer intercepted
 * via page.route() — never a real backend or database. See tests/LiveEventFeed.test.tsx
 * for the component-level (jsdom) coverage of the same request/response
 * shapes; this file additionally proves the real page wires them up: actual
 * DOM rendering, real click handling, and real fetch() calls leaving the
 * browser.
 */

interface FakeEvent {
  eventId: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  venueName: string;
  venueAddress: string;
  suburb: string;
  startsAt: string;
  endsAt: string;
  organiserName: string;
  ticketTypes: { id: string; name: string; priceCents: number; feePolicy: string; quantityAvailable: number }[];
}

function makeEvent(index: number, overrides: Partial<FakeEvent> = {}): FakeEvent {
  return {
    eventId: `evt-${index}`,
    slug: `evt-${index}`,
    title: `Event ${index}`,
    description: "d",
    category: "live-music",
    venueName: "v",
    venueAddress: "a",
    suburb: "s",
    startsAt: "2026-12-01T09:00:00.000Z",
    endsAt: "2026-12-01T12:00:00.000Z",
    organiserName: "Org",
    ticketTypes: [{ id: "t1", name: "GA", priceCents: 1000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    ...overrides,
  };
}

const RAW_PAGE_SIZE = 10;

/**
 * Simulates a worst-case paginated backend (query, then filter): the cursor
 * advances over *raw* table order in fixed-size pages, and category
 * filtering is applied only *after* each raw page is fetched — so a page can
 * come back with zero matching items while `nextCursor` still points further
 * in. The real API filters in SQL, but the feed shouldn't depend on that.
 */
function paginate(all: FakeEvent[], cursor: string | null, category: string | null) {
  const start = cursor ? Number(cursor) : 0;
  const rawPage = all.slice(start, start + RAW_PAGE_SIZE);
  const nextCursor = start + RAW_PAGE_SIZE < all.length ? String(start + RAW_PAGE_SIZE) : undefined;
  const items = category ? rawPage.filter((e) => e.category === category) : rawPage;
  return { items, nextCursor };
}

async function mockEventsApi(route: Route, all: FakeEvent[]) {
  const url = new URL(route.request().url());
  const cursor = url.searchParams.get("cursor");
  const category = url.searchParams.get("category");
  const { items, nextCursor } = paginate(all, cursor, category);
  await route.fulfill({ json: { items, nextCursor } });
}

test("loads more than 20 records across multiple 'Load more' clicks", async ({ page }) => {
  const all = Array.from({ length: 25 }, (_, i) => makeEvent(i + 1));
  await page.route("**/api/events*", (route) => mockEventsApi(route, all));

  await page.goto("/");
  await expect(page.getByText("Event 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Showing 10 events")).toBeVisible();

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Showing 20 events")).toBeVisible();
  await expect(page.getByText("Event 20", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Showing 25 events")).toBeVisible();
  await expect(page.getByText("Event 25", { exact: true })).toBeVisible();

  // All 25 loaded — the button disappears once nextCursor runs out.
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("skips an empty filtered page that still has a cursor, reaching matches on a later page", async ({ page }) => {
  // Only two "art" events exist, both past the first raw page of 10 —
  // filtering the first raw page for "art" alone yields zero results even
  // though the overall result set is non-empty.
  const all = [
    ...Array.from({ length: 15 }, (_, i) => makeEvent(i + 1, { category: "live-music" })),
    makeEvent(16, { category: "art", title: "Art Show A" }),
    makeEvent(17, { category: "art", title: "Art Show B" }),
    ...Array.from({ length: 8 }, (_, i) => makeEvent(i + 18, { category: "live-music" })),
  ];
  await page.route("**/api/events*", (route) => mockEventsApi(route, all));

  await page.goto("/");
  await expect(page.getByText("Event 1", { exact: true })).toBeVisible();

  await page.getByLabel("Category").selectOption("art");

  // The empty first "art" page is skipped automatically — the real matches
  // (from the second raw page) show up without the user doing anything else,
  // and "no events match" is never shown along the way.
  await expect(page.getByText("Art Show A")).toBeVisible();
  await expect(page.getByText("Art Show B")).toBeVisible();
  await expect(page.getByText(/no events match/i)).toHaveCount(0);
  await expect(page.getByText("Event 1", { exact: true })).toHaveCount(0); // the stale live-music page 1 is gone
});

test("discards a stale response after the filter changes again before the first request resolves", async ({
  page,
}) => {
  const all = [makeEvent(1, { category: "live-music", title: "Music Event" }), makeEvent(2, { category: "art", title: "Art Event" })];

  let resolveSlowRequest: (() => void) | undefined;
  await page.route("**/api/events*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("category") === "live-music") {
      // Hang the very first (later-superseded) request until the test releases it.
      await new Promise<void>((resolve) => {
        resolveSlowRequest = resolve;
      });
    }
    await mockEventsApi(route, all);
  });

  await page.goto("/");
  await page.getByLabel("Category").selectOption("live-music");
  await expect.poll(() => resolveSlowRequest !== undefined).toBe(true);

  await page.getByLabel("Category").selectOption("art");
  await expect(page.getByText("Art Event")).toBeVisible();

  // Now let the superseded live-music request resolve late — it must not
  // clobber the art results that are already showing.
  resolveSlowRequest?.();
  await page.waitForTimeout(200);
  await expect(page.getByText("Art Event")).toBeVisible();
  await expect(page.getByText("Music Event")).toHaveCount(0);
});
