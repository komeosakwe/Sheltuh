import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";
import { stubStripeJs } from "./stripe-stub";

/**
 * The embedded payment page, /checkout/pay (docs/design/checkout-pay.md), in
 * a real browser: from the event page's Checkout to the order summary beside
 * Stripe's form, its headers, phones, and the return page when a payment
 * wasn't completed. The e2e server runs in live mode with a placeholder
 * publishable key; every /api/* request is answered here and Stripe.js is a
 * stub (e2e/stripe-stub.ts), so nothing reaches Stripe. The real Stripe form
 * (cards, declines, 3DS, wallets) is not exercised.
 */

const DAY = 86_400_000;
const ORDER_ID = `ord_${"c0ffee00".repeat(4)}`;
const SECRET = "cs_test_e2e_secret_ga";

const sample = sampleEvents.find((e) => e.slug === "neon-static");
if (!sample) throw new Error("no sample neon-static");
const ga = sample.ticketTypes.find((t) => t.name === "General admission");
if (!ga) throw new Error("no General admission tier");

function asPublic(): PublicEvent {
  const start = Date.now() + 7 * DAY;
  return {
    organiserId: "org-demo",
    eventId: sample!.id,
    slug: sample!.slug,
    title: sample!.title,
    description: sample!.description,
    category: sample!.category,
    venueName: sample!.venueName,
    venueAddress: sample!.venueAddress,
    suburb: sample!.suburb,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 4 * 3600_000).toISOString(),
    organiserName: sample!.organiserName,
    imageUrl: sample!.imageUrl,
    ticketTypes: sample!.ticketTypes,
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
  };
}

function openPayment() {
  const start = Date.now() + 7 * DAY;
  return {
    status: "open",
    clientSecret: SECRET,
    expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    eventTitle: sample!.title,
    eventSlug: sample!.slug,
    eventStartsAt: new Date(start).toISOString(),
    eventEndsAt: new Date(start + 4 * 3600_000).toISOString(),
    venueName: sample!.venueName,
    suburb: sample!.suburb,
    seated: false,
    lines: [{ ticketTypeName: "General admission", quantity: 1, unitTotalCents: 3170, lineTotalCents: 3170, buyerPaysFee: true }],
    subtotalCents: 3000,
    buyerFeeCents: 170,
    totalCents: 3170,
  };
}

interface Seen {
  checkouts: unknown[];
  /** Every /api request as "METHOD /path". */
  calls: string[];
}

async function mockApi(page: Page, { orderPending = false }: { orderPending?: boolean } = {}): Promise<Seen> {
  const seen: Seen = { checkouts: [], calls: [] };
  const pub = asPublic();
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    seen.calls.push(`${request.method()} ${url.pathname}`);
    if (url.pathname === `/api/events/slug/${pub.slug}`) return route.fulfill({ json: pub });
    if (url.pathname === `/api/events/${pub.eventId}/checkout` && request.method() === "POST") {
      seen.checkouts.push(request.postDataJSON());
      // As the API answers now: our own payment page, not Stripe's.
      return route.fulfill({ status: 201, json: { url: `/checkout/pay?order=${ORDER_ID}`, orderId: ORDER_ID } });
    }
    if (url.pathname === `/api/orders/by-session/${ORDER_ID}/payment` && request.method() === "GET") {
      return route.fulfill({ json: openPayment(), headers: { "cache-control": "private, no-store" } });
    }
    if (url.pathname === `/api/orders/by-session/${ORDER_ID}` && request.method() === "GET" && orderPending) {
      return route.fulfill({ json: { status: "pending" } });
    }
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    if (/\/going(\/|$)/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return seen;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("general admission at 1280×900", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Checkout → our payment page: the summary beside Stripe's form, given the order's client secret", async ({ page }) => {
    const stripe = await stubStripeJs(page);
    const seen = await mockApi(page);
    await page.goto(`/events/${sample!.slug}`);
    const tickets = page.locator("#tickets");
    await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click({ timeout: 30_000 });
    await expect(tickets).toContainText("You'll pay on the next page, in a secure form from Stripe, our payment provider.");
    await expect(tickets.getByRole("list", { name: "How booking works" })).toContainText("2 Pay");
    // The event page never loads Stripe.js.
    expect(stripe.requests).toEqual([]);

    await tickets.getByRole("button", { name: "Checkout" }).click();
    await expect(page).toHaveURL(`/checkout/pay?order=${ORDER_ID}`);
    expect(seen.checkouts).toEqual([{ lineItems: [{ ticketTypeId: ga!.id, quantity: 1 }] }]);

    await expect(page.getByRole("heading", { level: 1, name: "Pay for your tickets" })).toBeVisible({ timeout: 30_000 });
    const summary = page.getByRole("region", { name: sample!.title });
    await expect(summary).toContainText("1 × A$31.70 incl. fee");
    await expect(summary.locator("[data-order-total]")).toHaveText("A$31.70");
    await expect(summary).toContainText("Includes A$1.70 in booking fees.");
    await expect(page.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", `/events/${sample!.slug}`);
    // Under the form (the footer has its own links too).
    const legal = page.getByText(/^By paying you agree to the Purchase Terms/);
    await expect(legal.getByRole("link", { name: "Purchase Terms" })).toHaveAttribute("href", "/purchase-terms");
    await expect(legal.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");

    // Stripe's form (the stub) is mounted with this order's secret and the platform's key.
    await expect(page.locator('iframe[title="Secure payment form (e2e stub)"]')).toBeVisible();
    await expect(page.getByText("Payment form ready")).toBeAttached();
    expect(await stripe.seen()).toEqual({ keys: ["pk_test_e2e_placeholder"], secrets: [SECRET], destroyed: 0 });
    expect(stripe.requests.length).toBeGreaterThanOrEqual(1);
    // Summary and form side by side from lg.
    const summaryBox = await summary.boundingBox();
    const formBox = await page.locator("[data-payment-slot]").boundingBox();
    expect(summaryBox && formBox && summaryBox.x + summaryBox.width <= formBox.x).toBe(true);
    // The page only read: POST was the event page's Checkout, nothing else.
    expect(seen.calls.filter((call) => !call.startsWith("GET ")).filter((call) => !call.endsWith("/view"))).toEqual([
      `POST /api/events/${sample!.id}/checkout`,
    ]);

    // The browser's Back: the event page's Checkout works again (not stuck on "Opening checkout…").
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/events/${sample!.slug}$`));
    await expect(page.locator("#tickets").getByRole("button", { name: "Opening checkout…" })).toHaveCount(0, { timeout: 30_000 });
  });

  test("the page is sent with no-referrer and noindex (the order id is a credential)", async ({ page }) => {
    await stubStripeJs(page);
    await mockApi(page);
    const response = await page.goto(`/checkout/pay?order=${ORDER_ID}`);
    const headers = response?.headers() ?? {};
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page).toHaveTitle("Checkout — Sheltüh");
  });
});

for (const vp of [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
]) {
  test.describe(`payment page on a ${vp.width}px phone`, () => {
    test.use({ viewport: vp });

    test("no sideways scroll; the total shows without opening anything; the lines fold away", async ({ page }) => {
      const stripe = await stubStripeJs(page);
      await mockApi(page);
      await page.goto(`/checkout/pay?order=${ORDER_ID}`);
      await expect(page.locator('iframe[title="Secure payment form (e2e stub)"]')).toBeVisible({ timeout: 30_000 });
      await noSidewaysScroll(page);
      const summary = page.getByRole("region", { name: sample!.title });
      await expect(summary.locator("[data-order-total]")).toBeVisible();
      await expect(summary.getByText("General admission")).toBeHidden();
      const toggle = summary.getByRole("button", { name: "Show 1 ticket" });
      expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await toggle.click();
      await expect(summary.getByText("General admission")).toBeVisible();
      await expect(summary.getByRole("button", { name: "Hide tickets" })).toHaveAttribute("aria-expanded", "true");
      // Summary before the form on phones.
      const summaryBox = await summary.boundingBox();
      const formBox = await page.locator("[data-payment-slot]").boundingBox();
      expect(summaryBox && formBox && summaryBox.y + summaryBox.height <= formBox.y).toBe(true);
      await noSidewaysScroll(page);
      expect((await stripe.seen()).secrets).toEqual([SECRET]);
    });
  });
}

test.describe("when Stripe's form doesn't come", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const STUB_FRAME = 'iframe[title="Secure payment form (e2e stub)"]';
  const PAYMENT_GET = `GET /api/orders/by-session/${ORDER_ID}/payment`;
  // The slot's own alert (Next's route announcer is a role="alert" too).
  const formAlert = (page: Page) => page.locator("[data-payment-slot]").getByRole("alert");

  test("Stripe can't set the form up: our alert (not an endless loader), and Try again mounts a new one", async ({ page }) => {
    const stripe = await stubStripeJs(page, { modes: ["reject", "mount"] });
    const seen = await mockApi(page);
    await page.goto(`/checkout/pay?order=${ORDER_ID}`);
    const alert = formAlert(page);
    await expect(alert).toContainText("The payment form didn’t load.", { timeout: 30_000 });
    await expect(alert).toContainText("You haven’t been charged.");
    await expect(page.getByText("Loading the payment form…")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Pay for your tickets" })).toBeFocused();
    // The summary stays.
    await expect(page.getByRole("region", { name: sample!.title }).locator("[data-order-total]")).toHaveText("A$31.70");
    expect(seen.calls.filter((call) => call === PAYMENT_GET)).toHaveLength(1);

    const again = page.getByRole("button", { name: "Try again" });
    expect((await again.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await again.click();
    await expect(page.locator(STUB_FRAME)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Payment form ready")).toBeAttached();
    await expect(formAlert(page)).toHaveCount(0);
    // The checkout was asked for again, and the form created again with the same secret.
    expect(seen.calls.filter((call) => call === PAYMENT_GET)).toHaveLength(2);
    expect((await stripe.seen()).secrets).toEqual([SECRET, SECRET]);
  });

  test("a form that hasn't appeared after 20 s: the same alert, and Try again", async ({ page }) => {
    await page.clock.install();
    const stripe = await stubStripeJs(page, { modes: ["hang", "mount"] });
    await mockApi(page);
    await page.goto(`/checkout/pay?order=${ORDER_ID}`);
    await expect(page.getByText("Loading the payment form…")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await stripe.seen()).secrets).toEqual([SECRET]);
    // A keyboard user (so focus moved by script would show :focus-visible).
    await page.keyboard.press("Tab");
    // The page's clock also runs on by itself: checked at once, not retried.
    await page.clock.fastForward(19_000);
    expect(await formAlert(page).count()).toBe(0);
    await expect(page.getByText("Loading the payment form…")).toBeVisible();
    await page.clock.fastForward(1_500);
    await expect(formAlert(page)).toContainText("The payment form didn’t load.");
    await expect(page.getByText("Loading the payment form…")).toHaveCount(0);
    // Focus goes to the h1, which isn't a control: no ring, even though the global :focus-visible applies.
    const h1 = page.getByRole("heading", { level: 1, name: "Pay for your tickets" });
    await expect(h1).toBeFocused();
    expect(await h1.evaluate((el) => [el.matches(":focus-visible"), getComputedStyle(el).outlineStyle])).toEqual([true, "none"]);

    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(STUB_FRAME)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Payment form ready")).toBeAttached();
    expect((await stripe.seen()).secrets).toEqual([SECRET, SECRET]);
  });

  test("Stripe's iframe is in place before it's drawn: still loading until it has a height", async ({ page }) => {
    await stubStripeJs(page, { modes: ["delayed-size"], sizeDelayMs: 2_000 });
    await mockApi(page);
    await page.goto(`/checkout/pay?order=${ORDER_ID}`);
    await expect(page.locator(STUB_FRAME)).toBeAttached({ timeout: 30_000 });
    // Inserted, 0 high: the loader stays, the slot keeps its height, nothing announced yet.
    await expect(page.getByText("Loading the payment form…")).toBeVisible();
    await expect(page.getByText("Payment form ready")).toHaveCount(0);
    expect((await page.locator("[data-payment-slot]").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(500);

    await expect(page.getByText("Payment form ready")).toBeAttached({ timeout: 10_000 });
    await expect(page.getByText("Loading the payment form…")).toHaveCount(0);
    await expect(page.locator(STUB_FRAME)).toBeVisible();
  });
});

test.describe("return page", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("back from Stripe without paying: payment not completed, and Return to payment mounts the form again", async ({ page }) => {
    const stripe = await stubStripeJs(page);
    const seen = await mockApi(page, { orderPending: true });
    await page.goto(`/checkout/success?session_id=${ORDER_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Payment not completed" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("You haven’t been charged. Your checkout is still open, so you can try again.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", `/events/${sample!.slug}`);
    await noSidewaysScroll(page);
    // The return page doesn't load Stripe.js.
    expect(stripe.requests).toEqual([]);

    await page.getByRole("link", { name: "Return to payment" }).click();
    await expect(page).toHaveURL(`/checkout/pay?order=${ORDER_ID}`);
    await expect(page.locator('iframe[title="Secure payment form (e2e stub)"]')).toBeVisible({ timeout: 30_000 });
    expect((await stripe.seen()).secrets).toEqual([SECRET]);
    // Both pages only read.
    expect(seen.calls.filter((call) => !call.startsWith("GET "))).toEqual([]);
  });
});
