import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { SAMPLE_SEAT_MAPS } from "@/lib/sample-seat-maps";
import { sampleEvents } from "@/lib/sample-events";
import { encodeAvailability } from "@/lib/seating/availability";
import { stubStripeJs, type StripeStub } from "./stripe-stub";

/**
 * Reserved seating in a real browser (docs/design/seating.md): from the
 * event page to the seat page, choosing seats on the map and in the list,
 * and pressing Checkout, at 320, 375 and desktop widths. The e2e server
 * runs in live mode with every /api/* request intercepted here: the demo
 * seated event (Off-Kilter) and its sample map are served as the live API
 * would. Checkout goes to our payment page (/checkout/pay), where Stripe.js
 * is a stub (e2e/stripe-stub.ts) that never reaches Stripe.
 */

const DAY = 86_400_000;
const event = sampleEvents.find((e) => e.id === "evt-off-kilter");
if (!event) throw new Error("no seated sample");
const sample = SAMPLE_SEAT_MAPS["evt-off-kilter"];

function asPublic(): PublicEvent {
  const start = Date.now() + 7 * DAY;
  return {
    organiserId: "org-demo",
    eventId: event!.id,
    slug: event!.slug,
    title: event!.title,
    description: event!.description,
    category: event!.category,
    venueName: event!.venueName,
    venueAddress: event!.venueAddress,
    suburb: event!.suburb,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 2 * 3600_000).toISOString(),
    organiserName: event!.organiserName,
    imageUrl: event!.imageUrl,
    ticketTypes: event!.ticketTypes,
    soldOut: false,
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
    seating: { version: sample.version },
  };
}

interface Seen {
  checkouts: unknown[];
  availability: number;
  cancels: string[];
  stripe: StripeStub;
}

/** The pending order's id, as the API returns it with the payment page's URL (ord_ + 32 hex). */
const ORDER_ID = `ord_${"e2e0".repeat(8)}`;
const SECRET = "cs_test_e2e_secret_seated";

/** GET …/payment for the held order: open, with two North Row A seats. */
function openPayment(seatCount: number) {
  const seats = [
    { section: "North", row: "A", seat: "1", kind: "standard" },
    { section: "North", row: "A", seat: "2", kind: "standard" },
  ].slice(2 - seatCount);
  return {
    status: "open",
    clientSecret: SECRET,
    expiresAt: new Date(Date.now() + 31 * 60_000).toISOString(),
    eventTitle: event!.title,
    eventSlug: event!.slug,
    seated: true,
    lines: [{ ticketTypeName: "Full price", quantity: seatCount, unitTotalCents: 3690, lineTotalCents: 3690 * seatCount, seats }],
    subtotalCents: 3500 * seatCount,
    buyerFeeCents: 190 * seatCount,
    totalCents: 3690 * seatCount,
  };
}

async function mockApi(page: Page, { takenAtCheckout }: { takenAtCheckout?: string[] } = {}): Promise<Seen> {
  const seen: Seen = { checkouts: [], availability: 0, cancels: [], stripe: await stubStripeJs(page) };
  const pub = asPublic();
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/events/slug/${pub.slug}`) return route.fulfill({ json: pub });
    if (url.pathname === `/api/events/${pub.eventId}/seat-map`) {
      return route.fulfill({ json: { eventId: pub.eventId, version: sample.version, seatCount: sample.seatCount, template: sample.template } });
    }
    if (url.pathname === `/api/events/${pub.eventId}/seat-availability`) {
      seen.availability += 1;
      return route.fulfill({
        json: {
          eventId: pub.eventId,
          version: sample.version,
          seatCount: sample.seatCount,
          unavailable: encodeAvailability(sample.seatCount, sample.unavailable),
        },
      });
    }
    if (url.pathname === `/api/events/${pub.eventId}/checkout` && request.method() === "POST") {
      seen.checkouts.push(request.postDataJSON());
      if (takenAtCheckout && seen.checkouts.length === 1) {
        return route.fulfill({
          status: 409,
          json: { error: "Some of those seats were just taken.", fieldErrors: { seats: "Taken." }, code: "seats_unavailable", seatIds: takenAtCheckout },
        });
      }
      return route.fulfill({
        status: 201,
        json: {
          url: `/checkout/pay?order=${ORDER_ID}`,
          holdExpiresAt: new Date(Date.now() + 35 * 60_000).toISOString(),
          orderId: ORDER_ID,
        },
      });
    }
    if (url.pathname === `/api/orders/by-session/${ORDER_ID}/payment` && request.method() === "GET") {
      const last = seen.checkouts.at(-1) as { seats?: { seatIds: string[] } } | undefined;
      return route.fulfill({ json: openPayment(last?.seats?.seatIds.length === 1 ? 1 : 2) });
    }
    if (url.pathname === `/api/orders/by-session/${ORDER_ID}/cancel` && request.method() === "POST") {
      seen.cancels.push(url.pathname);
      return route.fulfill({ json: { status: "released", eventTitle: pub.title, eventSlug: pub.slug } });
    }
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    if (/\/going(\/|$)/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return seen;
}

/** The seat page's h1 shows whole ("Choose seats", not "Choose se…"). */
async function headingNotTruncated(page: Page) {
  const clipped = await page.getByRole("heading", { level: 1, name: "Choose seats" }).evaluate((h) => {
    // The text's own width against the box (scrollWidth rounds, and misses a sub-pixel ellipsis).
    const range = document.createRange();
    range.selectNodeContents(h);
    return range.getBoundingClientRect().width > h.getBoundingClientRect().width;
  });
  expect(clipped).toBe(false);
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Whether `locator`'s box is entirely inside the viewport (focus not obscured by the bar: WCAG 2.4.11). */
async function fullyInViewport(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
  }, selector);
}

for (const vp of [
  { width: 320, height: 640, name: "320" },
  { width: 375, height: 812, name: "375" },
]) {
  test.describe(`seated event on a phone at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("buy bar → seat page → choose seats in the list → Checkout holds them; the payment page's Change seats releases them", async ({ page }) => {
      const seen = await mockApi(page);
      await page.goto(`/events/${event!.slug}`);
      const bar = page.locator("[data-buy-bar]");
      const choose = bar.getByRole("link", { name: "Choose seats" });
      await expect(choose).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("#tickets").getByRole("button", { name: /Increase quantity/ })).toHaveCount(0);
      await choose.click();

      await expect(page).toHaveURL(new RegExp(`/events/${event!.slug}/seats$`));
      await expect(page.getByRole("heading", { level: 1, name: "Choose seats" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("img", { name: /^Seat map of The Esplanade Studio\. 43 seats available/ })).toBeVisible();
      await noSidewaysScroll(page);
      await headingNotTruncated(page);
      // The seat bar stays close to the spec's 88px (plus the hairline).
      expect((await page.locator("[data-seat-bar]").boundingBox())?.height ?? 0).toBeLessThanOrEqual(90);

      await page.getByRole("tab", { name: "List" }).click();
      const rowA = page.getByRole("group", { name: "North, Row A" });
      await rowA.getByRole("checkbox", { name: /^Seat 1, Full price, A\$36\.90/ }).check();
      await rowA.getByRole("checkbox", { name: /^Seat 2, Full price/ }).check();
      const seatBar = page.locator("[data-seat-bar]");
      await expect(seatBar).toContainText("2 seats");
      await expect(seatBar).toContainText("A$73.80");
      await noSidewaysScroll(page);

      // The seat bar's details: every seat with its all-inclusive price, then the total.
      await seatBar.getByRole("button", { name: /2 seats/ }).click();
      await expect(page.getByRole("heading", { name: "Your seats" })).toBeFocused();
      await expect(seatBar).toContainText("North · Row A · Seat 1");
      await expect(seatBar).toContainText("Pressing Checkout holds them for 30 minutes while you pay.");

      const checkout = seatBar.getByRole("button", { name: "Checkout" });
      await expect(checkout).toBeVisible();
      expect((await checkout.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      // Stripe.js only loads on the payment page.
      expect(seen.stripe.requests).toEqual([]);
      await checkout.click();
      await expect(page).toHaveURL(`/checkout/pay?order=${ORDER_ID}`);
      expect(seen.checkouts).toEqual([{ seats: { mapVersion: 1, seatIds: ["N-A1", "N-A2"] } }]);

      // The payment page: the seats, the hold, and Stripe's form (the stub) with this order's secret.
      await expect(page.getByRole("heading", { level: 1, name: "Pay for your tickets" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("list", { name: "Checkout steps" })).toContainText("1 Choose seats");
      await expect(page.getByText(/^Your seats are held until .+\. Going back releases them\.$/)).toBeVisible();
      await expect(page.locator('iframe[title="Secure payment form (e2e stub)"]')).toBeVisible({ timeout: 30_000 });
      expect((await seen.stripe.seen()).secrets).toEqual([SECRET]);
      await noSidewaysScroll(page);
      expect(seen.cancels).toEqual([]);

      // Change seats: back to the seat page, which releases the hold at once.
      await page.getByRole("link", { name: "Change seats" }).click();
      await expect(page).toHaveURL(new RegExp(`/events/${event!.slug}/seats$`));
      await expect(page.getByText("You left the payment page, so the seats held for you have been released.").first()).toBeVisible({
        timeout: 30_000,
      });
      expect(seen.cancels).toEqual([`/api/orders/by-session/${ORDER_ID}/cancel`]);
    });

    test("choosing on the map: a tap at the overview zooms in, then a tap chooses", async ({ page }) => {
      await mockApi(page);
      await page.goto(`/events/${event!.slug}/seats`);
      const canvas = page.locator(".seat-map-canvas");
      await expect(canvas).toBeVisible({ timeout: 30_000 });
      const seat = page.locator('[role="img"] [data-seat="W-A1"] rect');
      // A fine pointer (Playwright's mouse) chooses from 12px; below that, the tap zooms first.
      const px = Number(await canvas.getAttribute("data-seat-px"));
      if (px < 12) {
        await seat.click({ force: true });
        await expect.poll(async () => Number(await canvas.getAttribute("data-seat-px"))).toBeGreaterThanOrEqual(24);
      }
      await page.locator('[role="img"] [data-seat="W-A1"] rect').click({ force: true });
      await expect(page.locator('[role="img"] [data-seat="W-A1"]')).toHaveAttribute("data-state", "selected");
      await expect(page.locator("[data-seat-bar]")).toContainText("1 seat");
      await noSidewaysScroll(page);
    });
  });
}

test.describe("seated event at 1280×900", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("event page → seat page; seats taken at Checkout are removed with an alert, then Checkout goes to the payment page", async ({ page }) => {
    const seen = await mockApi(page, { takenAtCheckout: ["N-A1"] });
    await page.goto(`/events/${event!.slug}`);
    const cta = page.locator("#tickets").getByRole("link", { name: "Choose your seats" });
    await expect(cta).toBeVisible({ timeout: 30_000 });
    await cta.click();
    await expect(page.getByRole("img", { name: /^Seat map of/ })).toBeVisible({ timeout: 30_000 });

    // Map: a mouse chooses seats directly; the tooltip names the seat and its price.
    const seat = page.locator('[role="img"] [data-seat="N-A1"] rect');
    await seat.hover({ force: true });
    await expect(page.getByText("North · Row A · Seat 1", { exact: true })).toBeVisible();
    await seat.click({ force: true });
    await page.locator('[role="img"] [data-seat="N-A2"] rect').click({ force: true });
    const summary = page.getByRole("heading", { name: "Your seats" }).locator("..");
    await expect(summary).toContainText("North · Row A · Seat 1");
    await expect(summary).toContainText("A$73.80");

    // Polls availability while visible (once on load, then every 10 seconds).
    expect(seen.availability).toBeGreaterThanOrEqual(1);

    const checkout = page.getByRole("button", { name: "Checkout" });
    await checkout.click();
    await expect(page.getByRole("alert").filter({ hasText: "Some seats were taken" })).toContainText(
      "Some seats were taken while you were choosing: North · Row A · Seat 1",
    );
    await expect(checkout).toBeFocused();
    await expect(page.locator('[role="img"] [data-seat="N-A1"]')).toHaveAttribute("data-state", "unavailable");
    await expect(summary).not.toContainText("North · Row A · Seat 1");

    await checkout.click();
    await expect(page).toHaveURL(`/checkout/pay?order=${ORDER_ID}`);
    expect(seen.checkouts).toEqual([
      { seats: { mapVersion: 1, seatIds: ["N-A1", "N-A2"] } },
      { seats: { mapVersion: 1, seatIds: ["N-A2"] } },
    ]);
    await expect(page.locator('iframe[title="Secure payment form (e2e stub)"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("region", { name: event!.title })).toContainText("North · Row A · Seat 2");
    expect((await seen.stripe.seen()).secrets).toEqual([SECRET]);

    // The browser's Back from the payment page: the hold is released at once, and Checkout works again.
    await page.goBack();
    await expect(page.getByText("You left the payment page, so the seats held for you have been released.").first()).toBeVisible({
      timeout: 30_000,
    });
    expect(seen.cancels).toEqual([`/api/orders/by-session/${ORDER_ID}/cancel`]);
    // Restored from the back/forward cache or loaded afresh, it's no longer "Holding your seats…".
    await expect(page.getByRole("button", { name: "Checkout" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Holding your seats…" })).toHaveCount(0);
  });

  test("the cancelled page releases the seats", async ({ page }) => {
    const posts: string[] = [];
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/orders/by-session/ord_e2e/cancel" && route.request().method() === "POST") {
        posts.push(url.pathname);
        return route.fulfill({ json: { status: "released", eventTitle: event!.title, eventSlug: event!.slug } });
      }
      return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
    });
    const response = await page.goto("/checkout/cancelled?order=ord_e2e");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByRole("heading", { level: 1, name: "Checkout cancelled" })).toBeFocused({ timeout: 30_000 });
    await expect(page.getByText(event!.title, { exact: true })).toBeVisible();
    await expect(page.getByText("your seats have been released for others")).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose seats again" })).toHaveAttribute("href", `/events/${event!.slug}/seats`);
    expect(posts.length).toBeGreaterThanOrEqual(1);
  });

  test("focus on the seat page never hides under anything, and Tab reaches the list", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${event!.slug}/seats`);
    await expect(page.getByRole("img", { name: /^Seat map of/ })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Map" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
    expect(await fullyInViewport(page, '[role="tab"][aria-selected="true"]')).toBe(true);
  });
});
