import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";
import { stubStripeJs } from "./stripe-stub";

/**
 * The phone's sticky buy bar as the one Checkout (owner, 6 Nov 2026), in a real browser on `next dev` with /api
 * intercepted: at 390×844 the page has one visible primary action; pressing it with no name focuses the field
 * (and says so); the bar never covers the name field when it has focus; and a press posts the checkout with
 * the buyer's name. The event is Cinder Warehouse Sessions with its first release sold out and its second on
 * sale (the third waiting on the second), so the cards' states can be seen too.
 */

const DAY = 86_400_000;
const ORDER_ID = `ord_${"c1b4".repeat(8)}`;

const sample = sampleEvents.find((e) => e.slug === "cinder-warehouse-sessions");
if (!sample) throw new Error("no sample cinder-warehouse-sessions");

function asPublic(): PublicEvent {
  const start = Date.now() + 14 * DAY;
  const [first, second, third] = sample!.ticketTypes;
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
    endsAt: new Date(start + 5 * 3600_000).toISOString(),
    organiserName: sample!.organiserName,
    ticketTypes: [
      { ...first, soldOut: true, remaining: 0 },
      { ...second, opensAfter: undefined, opensAfterPrevious: undefined },
      third,
    ],
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
  };
}

async function mockApi(page: Page) {
  const checkouts: unknown[] = [];
  const pub = asPublic();
  const start = Date.now() + 14 * DAY;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/events/slug/${pub.slug}`) return route.fulfill({ json: pub });
    if (url.pathname === `/api/events/${pub.eventId}/checkout` && request.method() === "POST") {
      checkouts.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { url: `/checkout/pay?order=${ORDER_ID}`, orderId: ORDER_ID } });
    }
    if (url.pathname === `/api/orders/by-session/${ORDER_ID}/payment`) {
      return route.fulfill({
        json: {
          status: "open",
          clientSecret: "cs_test_e2e_secret_bar",
          expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
          eventTitle: pub.title,
          eventSlug: pub.slug,
          eventStartsAt: new Date(start).toISOString(),
          eventEndsAt: new Date(start + 5 * 3600_000).toISOString(),
          venueName: pub.venueName,
          suburb: pub.suburb,
          seated: false,
          lines: [{ ticketTypeName: "Second release", quantity: 1, unitTotalCents: 3760, lineTotalCents: 3760, buyerPaysFee: true }],
          subtotalCents: 3500,
          buyerFeeCents: 260,
          totalCents: 3760,
        },
      });
    }
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    if (/\/going(\/|$)/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return { checkouts };
}

test.describe("the sticky buy bar at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("one visible primary action; the panel's Checkout is hidden; the bar's total follows the summary", async ({ page }) => {
    await stubStripeJs(page);
    await mockApi(page);
    await page.goto(`/events/${sample!.slug}`);
    const tickets = page.locator("#tickets");
    const bar = page.locator("[data-buy-bar]");
    await expect(tickets.getByRole("heading", { name: "Select your tickets" })).toBeVisible({ timeout: 30_000 });
    // Nothing chosen: the bar keeps the event price (one release is on sale) and is the way to the tickets.
    await expect(bar).toContainText("A$37.60");
    await expect(bar.getByRole("button")).toHaveCount(0);
    await expect(bar.getByRole("link", { name: "Buy tickets" })).toBeVisible();

    const soldOut = tickets.getByRole("listitem").filter({ hasText: "First release" });
    await expect(soldOut).toContainText("Sold out");
    await expect(soldOut.getByRole("button")).toHaveCount(0);

    await tickets.getByRole("button", { name: "Increase quantity for Second release" }).click();
    await expect(bar).toContainText("A$37.60");
    await expect(bar).toContainText("incl. booking fee");
    await expect(tickets.getByText("Total").locator("xpath=following-sibling::dd")).toHaveText("A$37.60");

    // One visible primary action: the bar's. The panel's Checkout isn't rendered on a phone.
    await expect(bar.getByRole("button", { name: "Buy tickets" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Checkout" })).toBeHidden();
    // 48px thumb target, 44px steppers.
    expect((await bar.getByRole("button", { name: "Buy tickets" }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect((await tickets.getByRole("button", { name: "Increase quantity for Second release" }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("with no name, pressing the bar focuses the name field and says why, without covering it", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${sample!.slug}`);
    const tickets = page.locator("#tickets");
    await tickets.getByRole("button", { name: "Increase quantity for Second release" }).click({ timeout: 30_000 });
    const bar = page.locator("[data-buy-bar]");
    await bar.getByRole("button", { name: "Buy tickets" }).click();

    const name = tickets.getByLabel("Your name");
    await expect(name).toBeFocused();
    await expect(tickets.getByRole("alert")).toHaveText("Enter your name.");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    // The bar is on screen, and the field and its error are above it (WCAG 2.4.11).
    const barBox = (await bar.boundingBox())!;
    const nameBox = (await name.boundingBox())!;
    const errorBox = (await tickets.getByRole("alert").boundingBox())!;
    expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(barBox.y);
    expect(errorBox.y + errorBox.height).toBeLessThanOrEqual(barBox.y);
    expect(nameBox.y).toBeGreaterThanOrEqual(0);
  });

  test("typing the name and pressing the bar posts the checkout with the buyer's name and goes to payment", async ({ page }) => {
    await stubStripeJs(page);
    const seen = await mockApi(page);
    await page.goto(`/events/${sample!.slug}`);
    const tickets = page.locator("#tickets");
    await tickets.getByRole("button", { name: "Increase quantity for Second release" }).click({ timeout: 30_000 });
    await tickets.getByLabel("Your name").fill("Alex Doe");
    await page.locator("[data-buy-bar]").getByRole("button", { name: "Buy tickets" }).click();
    await expect(page).toHaveURL(`/checkout/pay?order=${ORDER_ID}`);
    expect(seen.checkouts).toEqual([
      { lineItems: [{ ticketTypeId: expect.stringContaining("cinder-warehouse-sessions-1"), quantity: 1 }], buyerName: "Alex Doe" },
    ]);
  });

  test("the name field is never under the bar while the page scrolls to it", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${sample!.slug}`);
    const tickets = page.locator("#tickets");
    await tickets.getByRole("button", { name: "Increase quantity for Second release" }).click({ timeout: 30_000 });
    await tickets.getByLabel("Your name").focus();
    // The page scrolls smoothly to it: wait for it to settle clear of the bar.
    await expect
      .poll(async () => {
        const barBox = (await page.locator("[data-buy-bar]").boundingBox())!;
        const nameBox = (await tickets.getByLabel("Your name").boundingBox())!;
        return barBox.y - (nameBox.y + nameBox.height);
      })
      .toBeGreaterThanOrEqual(0);
  });
});

test.describe("desktop keeps the panel's Checkout and has no buy bar", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("one Checkout, in the panel, enabled once a ticket is chosen", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${sample!.slug}`);
    const tickets = page.locator("#tickets");
    await tickets.getByRole("button", { name: "Increase quantity for Second release" }).click({ timeout: 30_000 });
    await expect(page.locator("[data-buy-bar]")).toBeHidden();
    await expect(tickets.getByRole("button", { name: "Checkout" })).toBeVisible();
    await expect(tickets.getByRole("button", { name: "Checkout" })).toBeEnabled();
  });
});
