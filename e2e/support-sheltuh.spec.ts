import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { SAMPLE_SEAT_MAPS } from "@/lib/sample-seat-maps";
import { sampleEvents } from "@/lib/sample-events";
import { encodeAvailability } from "@/lib/seating/availability";
import type { SheltuhEvent } from "@/lib/types";
import { stubStripeJs } from "./stripe-stub";

/**
 * Support Sheltüh at checkout (components/checkout/SupportSheltuh.tsx) in a
 * real browser: the one-tap chips above Checkout on the event page and the
 * seat page, the total they change, the amount in the checkout request, and
 * its line on the payment page. The e2e server runs in live mode with every
 * /api/* request answered here and Stripe.js stubbed (e2e/stripe-stub.ts),
 * so nothing reaches the API or Stripe.
 */

const DAY = 86_400_000;
const GA_ORDER = `ord_${"5a5a5a5a".repeat(4)}`;
const SEATED_ORDER = `ord_${"5e5e5e5e".repeat(4)}`;

function find(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`no sample ${slug}`);
  return event;
}

const neon = find("neon-static");
const offKilter = find("off-kilter-a-new-play");
const seatSample = SAMPLE_SEAT_MAPS[offKilter.id];

function asPublic(event: SheltuhEvent, seated = false): PublicEvent {
  const start = Date.now() + 7 * DAY;
  return {
    organiserId: "org-demo",
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    suburb: event.suburb,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 3 * 3600_000).toISOString(),
    organiserName: event.organiserName,
    imageUrl: event.imageUrl,
    ticketTypes: event.ticketTypes,
    soldOut: false,
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
    ...(seated ? { seating: { version: seatSample.version } } : {}),
  };
}

/** The payment page's answer for the GA order: one General admission and whatever support was sent. */
function gaPayment(supportCents: number) {
  return {
    status: "open",
    clientSecret: "cs_test_e2e_secret_support",
    expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    eventTitle: neon.title,
    eventSlug: neon.slug,
    seated: false,
    lines: [{ ticketTypeName: "General admission", quantity: 1, unitTotalCents: 3170, lineTotalCents: 3170, buyerPaysFee: true }],
    subtotalCents: 3000,
    buyerFeeCents: 170,
    ...(supportCents > 0 ? { supportCents } : {}),
    totalCents: 3170 + supportCents,
  };
}

async function mockApi(page: Page) {
  const checkouts: Record<string, unknown>[] = [];
  const pubs = [asPublic(neon), asPublic(offKilter, true)];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pub = pubs.find((p) => url.pathname === `/api/events/slug/${p.slug}`);
    if (pub) return route.fulfill({ json: pub });
    if (url.pathname === `/api/events/${offKilter.id}/seat-map`) {
      return route.fulfill({
        json: { eventId: offKilter.id, version: seatSample.version, seatCount: seatSample.seatCount, template: seatSample.template },
      });
    }
    if (url.pathname === `/api/events/${offKilter.id}/seat-availability`) {
      return route.fulfill({
        json: {
          eventId: offKilter.id,
          version: seatSample.version,
          seatCount: seatSample.seatCount,
          unavailable: encodeAvailability(seatSample.seatCount, seatSample.unavailable),
        },
      });
    }
    const checkout = /^\/api\/events\/([^/]+)\/checkout$/.exec(url.pathname);
    if (checkout && request.method() === "POST") {
      checkouts.push(request.postDataJSON() as Record<string, unknown>);
      const orderId = checkout[1] === offKilter.id ? SEATED_ORDER : GA_ORDER;
      return route.fulfill({ status: 201, json: { url: `/checkout/pay?order=${orderId}`, orderId } });
    }
    if (url.pathname === `/api/orders/by-session/${GA_ORDER}/payment`) {
      const last = checkouts.at(-1);
      return route.fulfill({ json: gaPayment(typeof last?.supportCents === "number" ? last.supportCents : 0) });
    }
    if (url.pathname === `/api/orders/by-session/${SEATED_ORDER}/cancel`) {
      return route.fulfill({ json: { status: "released", eventTitle: offKilter.title, eventSlug: offKilter.slug } });
    }
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    if (/\/going(\/|$)/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return { checkouts };
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("general admission at 1280×900", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("tap A$5: the total goes up, Checkout sends supportCents 500, and the payment page shows its line", async ({ page }) => {
    await stubStripeJs(page);
    const seen = await mockApi(page);
    await page.goto(`/events/${neon.slug}`);
    const tickets = page.locator("#tickets");
    await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click({ timeout: 30_000 });

    const support = tickets.getByRole("group", { name: "Support Sheltüh" });
    await expect(support).toBeVisible();
    // Nothing pre-selected.
    for (const name of ["A$2", "A$5", "A$10", "Other"]) await expect(support.getByRole("radio", { name })).not.toBeChecked();
    const total = tickets.getByText("Total", { exact: true }).locator("xpath=following-sibling::dd");
    await expect(total).toHaveText("A$31.70");

    // One tap, on the chip itself (the label).
    await support.locator("label", { hasText: "A$5" }).click();
    await expect(support.getByRole("radio", { name: "A$5" })).toBeChecked();
    await expect(total).toHaveText("A$36.70");
    await expect(tickets.locator("dl").first()).toContainText("Support Sheltüh");
    const chipBox = await support.locator("label", { hasText: "A$5" }).boundingBox();
    expect(chipBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await tickets.getByRole("button", { name: "Checkout" }).click();
    await expect(page).toHaveURL(`/checkout/pay?order=${GA_ORDER}`);
    expect(seen.checkouts).toEqual([{ lineItems: [{ ticketTypeId: "neon-static-ga", quantity: 1 }], supportCents: 500 }]);

    const summary = page.getByRole("region", { name: neon.title });
    await expect(summary).toBeVisible({ timeout: 30_000 });
    await expect(summary.locator("[data-support-line]")).toContainText("Support Sheltüh");
    await expect(summary.locator("[data-support-line]")).toContainText("A$5");
    await expect(summary.locator("[data-order-total]")).toHaveText("A$36.70");
    await expect(summary).toContainText("Includes A$1.70 in booking fees and A$5 for Support Sheltüh.");
  });

  test("tapping the chosen chip again removes it, in the browser's own radio handling", async ({ page }) => {
    const seen = await mockApi(page);
    await page.goto(`/events/${neon.slug}`);
    const tickets = page.locator("#tickets");
    await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click({ timeout: 30_000 });
    const support = tickets.getByRole("group", { name: "Support Sheltüh" });
    const chip = support.locator("label", { hasText: "A$10" });
    await chip.click();
    await expect(support.getByRole("radio", { name: "A$10" })).toBeChecked();
    await chip.click();
    await expect(support.getByRole("radio", { name: "A$10" })).not.toBeChecked();
    await expect(tickets.locator("dl").first()).not.toContainText("Support Sheltüh");
    // Checkout then sends none.
    await tickets.getByRole("button", { name: "Checkout" }).click();
    await expect(page).toHaveURL(`/checkout/pay?order=${GA_ORDER}`);
    expect(seen.checkouts).toEqual([{ lineItems: [{ ticketTypeId: "neon-static-ga", quantity: 1 }] }]);
  });

  test("keyboard: Tab into the group, arrows choose, Space on the chosen one removes it, focus visible", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${neon.slug}`);
    const tickets = page.locator("#tickets");
    await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click({ timeout: 30_000 });
    const support = tickets.getByRole("group", { name: "Support Sheltüh" });
    const two = support.getByRole("radio", { name: "A$2" });
    const five = support.getByRole("radio", { name: "A$5" });
    // From the + stepper, Tab moves on until the first chip (nothing chosen: the first radio takes focus).
    for (let i = 0; i < 6 && !(await two.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press("Tab");
    await expect(two).toBeFocused();
    await expect(two).not.toBeChecked();
    // The focus ring is drawn on the chip (the radio itself is visually hidden).
    const outline = await two.evaluate((el) => getComputedStyle(el.nextElementSibling as Element).outlineStyle);
    expect(outline).toBe("solid");

    await page.keyboard.press("ArrowRight");
    await expect(five).toBeFocused();
    await expect(five).toBeChecked();
    await expect(tickets.getByText("Total", { exact: true }).locator("xpath=following-sibling::dd")).toHaveText("A$36.70");
    await page.keyboard.press("Space");
    await expect(five).not.toBeChecked();
    await expect(five).toBeFocused();

    // Or the Remove button.
    await page.keyboard.press("Space");
    await expect(five).toBeChecked();
    await tickets.getByRole("button", { name: "Remove Support Sheltüh" }).focus();
    await page.keyboard.press("Enter");
    await expect(five).not.toBeChecked();
    await expect(two).toBeFocused();
  });

  test("Other: an amount out of range is refused inline; a valid one is sent", async ({ page }) => {
    await stubStripeJs(page);
    const seen = await mockApi(page);
    await page.goto(`/events/${neon.slug}`);
    const tickets = page.locator("#tickets");
    await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click({ timeout: 30_000 });
    const support = tickets.getByRole("group", { name: "Support Sheltüh" });
    // A$5 first, then Other: the chips stay laid out (Chromium once drew them at zero size here).
    await support.locator("label", { hasText: "A$5" }).click();
    await support.locator("label", { hasText: "Other" }).click();
    const field = tickets.getByLabel("Other amount");
    await expect(field).toBeFocused();
    for (const name of ["A$2", "A$5", "A$10", "Other"]) {
      expect((await support.locator("label:has(input[type=radio])", { hasText: name }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await field.fill("501");
    // Leaving the field says what's wrong, by it.
    await page.keyboard.press("Tab");
    await expect(tickets.getByRole("alert")).toHaveText("The most you can add is A$500.");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    // Checkout refuses it and takes focus back to the field.
    await tickets.getByRole("button", { name: "Checkout" }).click();
    await expect(field).toBeFocused();
    expect(seen.checkouts).toEqual([]);
    await field.fill("12.50");
    await expect(tickets.getByRole("alert")).toHaveCount(0);
    await expect(tickets.getByText("Total", { exact: true }).locator("xpath=following-sibling::dd")).toHaveText("A$44.20");
    await tickets.getByRole("button", { name: "Checkout" }).click();
    await expect(page).toHaveURL(`/checkout/pay?order=${GA_ORDER}`);
    expect(seen.checkouts).toEqual([{ lineItems: [{ ticketTypeId: "neon-static-ga", quantity: 1 }], supportCents: 1250 }]);
  });
});

/**
 * An Other amount that isn't valid, the field still focused, then one press on Checkout: the press
 * blurs the field, which shows the error. It must take the hint's place without moving Checkout,
 * or the press (down on Checkout, up somewhere else) misses it. After one press Checkout has run:
 * it refused the amount and put focus back in the field.
 */
async function invalidOtherThenCheckout(page: Page) {
  await page.goto(`/events/${neon.slug}`);
  const tickets = page.locator("#tickets");
  await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click({ timeout: 30_000 });
  const support = tickets.getByRole("group", { name: "Support Sheltüh" });
  await support.locator("label", { hasText: "Other" }).click();
  const field = tickets.getByLabel("Other amount");
  await expect(field).toBeFocused();
  await field.fill("0.5");
  await expect(tickets.getByRole("alert")).toHaveCount(0);
  const button = tickets.getByRole("button", { name: "Checkout" });
  await button.scrollIntoViewIfNeeded();
  const before = (await button.boundingBox())!;
  return { tickets, field, button, before };
}

test.describe("Checkout's first press after an invalid Other amount, at 1280×900 (mouse)", () => {
  // Reduced motion: a pressed .btn moves down 1px otherwise (globals.css), which isn't a layout shift.
  test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });

  test("one press: the error shows in the hint's place, Checkout doesn't move, and focus goes to the field", async ({ page }) => {
    const seen = await mockApi(page);
    const { tickets, field, button, before } = await invalidOtherThenCheckout(page);
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    // The blur on mouse down has shown the error by now; Checkout must still be under the pointer.
    await expect(tickets.getByRole("alert")).toHaveText("The smallest amount is A$1.");
    expect(await button.boundingBox()).toEqual(before);
    await page.mouse.up();
    await expect(field).toBeFocused();
    expect(await button.boundingBox()).toEqual(before);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(tickets.getByText("In Australian dollars, from A$1 to A$500.")).toHaveCount(0);
    expect(seen.checkouts).toEqual([]);
  });
});

test.describe("Checkout's first press after an invalid Other amount, on a 320px touch phone", () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });

  test("one tap: Checkout doesn't move, and focus goes to the field", async ({ page }) => {
    const seen = await mockApi(page);
    const { tickets, field, button, before } = await invalidOtherThenCheckout(page);
    await page.touchscreen.tap(before.x + before.width / 2, before.y + before.height / 2);
    await expect(tickets.getByRole("alert")).toHaveText("The smallest amount is A$1.");
    await expect(field).toBeFocused();
    expect(await button.boundingBox()).toEqual(before);
    expect(seen.checkouts).toEqual([]);
  });

  test("the longest Other error fits the slot's two lines, so nothing below it moves", async ({ page }) => {
    await mockApi(page);
    const { tickets, field, button, before } = await invalidOtherThenCheckout(page);
    const slot = tickets.locator("[data-support-other-message]");
    await expect(slot).toHaveText("In Australian dollars, from A$1 to A$500.");
    const slotBefore = (await slot.boundingBox())!;
    for (const [text, message] of [
      ["abc", "Enter an amount in dollars, like 7 or 7.50."],
      ["501", "The most you can add is A$500."],
      ["7.505", "Use whole cents, like 7.50."],
      ["0.5", "The smallest amount is A$1."],
    ]) {
      await field.fill(text);
      await field.blur();
      await expect(tickets.getByRole("alert")).toHaveText(message);
      expect((await slot.boundingBox())!.height, message).toBe(slotBefore.height);
      expect(await button.boundingBox(), message).toEqual(before);
    }
  });
});

test.describe("large text (root font size 200%) at 320×640", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the chips go to one column and no label spills out of its chip", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/events/${neon.slug}`);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const tickets = page.locator("#tickets");
    await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click({ timeout: 30_000 });
    const support = tickets.getByRole("group", { name: "Support Sheltüh" });
    await support.locator("label", { hasText: "A$10" }).click();
    await support.scrollIntoViewIfNeeded();
    const boxes = [];
    for (const name of ["A$2", "A$5", "A$10", "Other"]) boxes.push((await support.locator("label", { hasText: name }).boundingBox())!);
    // One above the other, the same x.
    expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBe(1);
    for (let i = 1; i < boxes.length; i += 1) expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
    const overflow = await support.locator("label span").evaluateAll((spans) => spans.map((el) => el.scrollWidth - el.clientWidth));
    expect(Math.max(...overflow)).toBeLessThanOrEqual(0);
    // The group itself stays inside the page.
    const group = (await support.boundingBox())!;
    expect(group.x).toBeGreaterThanOrEqual(0);
    expect(group.x + group.width).toBeLessThanOrEqual(320);
  });
});

for (const vp of [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
]) {
  test.describe(`general admission on a phone at ${vp.width}`, () => {
    test.use({ viewport: vp });

    test("the chips fit without sideways scroll, are 44px+ tall, and A$5 changes the total", async ({ page }) => {
      await mockApi(page);
      await page.goto(`/events/${neon.slug}`);
      const tickets = page.locator("#tickets");
      await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click({ timeout: 30_000 });
      const support = tickets.getByRole("group", { name: "Support Sheltüh" });
      await support.scrollIntoViewIfNeeded();
      for (const name of ["A$2", "A$5", "A$10", "Other"]) {
        const box = await support.locator("label", { hasText: name }).boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= vp.width).toBe(true);
      }
      await support.locator("label", { hasText: "A$5" }).click();
      await expect(tickets.getByText("Total", { exact: true }).locator("xpath=following-sibling::dd")).toHaveText("A$36.70");
      // The widest chosen chip, "✓ A$10", fits inside its chip.
      await support.locator("label", { hasText: "A$10" }).click();
      const overflow = await support.locator("label", { hasText: "A$10" }).locator("span").evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await support.locator("label", { hasText: "Other" }).click();
      for (const name of ["A$2", "A$5", "A$10", "Other"]) {
        expect((await support.locator("label:has(input[type=radio])", { hasText: name }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await noSidewaysScroll(page);
    });
  });
}

test.describe("seated checkout at 1280×900", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("choose a seat, tap A$5: the total goes up and the seated checkout sends supportCents 500", async ({ page }) => {
    await stubStripeJs(page);
    const seen = await mockApi(page);
    await page.goto(`/events/${offKilter.slug}/seats`);
    await expect(page.getByRole("heading", { level: 1, name: "Choose seats" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "List" }).click();
    await page.getByRole("group", { name: "North, Row A" }).getByRole("checkbox", { name: /^Seat 1, Full price/ }).check();

    const support = page.getByRole("group", { name: "Support Sheltüh" });
    await expect(support).toBeVisible();
    for (const name of ["A$2", "A$5", "A$10", "Other"]) await expect(support.getByRole("radio", { name })).not.toBeChecked();
    const totals = page.getByText("Total", { exact: true }).locator("xpath=..");
    await expect(totals).toContainText("A$36.90");
    await support.locator("label", { hasText: "A$5" }).click();
    await expect(totals).toContainText("A$41.90");

    await page.getByRole("button", { name: "Checkout" }).click();
    await expect(page).toHaveURL(`/checkout/pay?order=${SEATED_ORDER}`);
    expect(seen.checkouts).toEqual([{ seats: { mapVersion: seatSample.version, seatIds: ["N-A1"] }, supportCents: 500 }]);
  });
});

test.describe("seated checkout on a phone at 375", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the chips are in the seat bar's details, the bar's total follows them, and Checkout sends the amount", async ({ page }) => {
    await stubStripeJs(page);
    const seen = await mockApi(page);
    await page.goto(`/events/${offKilter.slug}/seats`);
    await expect(page.getByRole("heading", { level: 1, name: "Choose seats" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "List" }).click();
    await page.getByRole("group", { name: "North, Row A" }).getByRole("checkbox", { name: /^Seat 1, Full price/ }).check();
    const seatBar = page.locator("[data-seat-bar]");
    await expect(seatBar).toContainText("A$36.90");
    await seatBar.getByRole("button", { name: /1 seat/ }).click();

    const support = seatBar.getByRole("group", { name: "Support Sheltüh" });
    await expect(support).toBeVisible();
    await support.locator("label", { hasText: "A$2" }).click();
    await expect(support.getByRole("radio", { name: "A$2" })).toBeChecked();
    await expect(seatBar).toContainText("A$38.90 incl. fees and support");
    await noSidewaysScroll(page);

    await seatBar.getByRole("button", { name: "Checkout" }).click();
    await expect(page).toHaveURL(`/checkout/pay?order=${SEATED_ORDER}`);
    expect(seen.checkouts).toEqual([{ seats: { mapVersion: seatSample.version, seatIds: ["N-A1"] }, supportCents: 200 }]);
  });
});

test.describe("payment page on a phone at 375", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the Support Sheltüh line shows with the ticket lines folded away", async ({ page }) => {
    await stubStripeJs(page);
    const seen = await mockApi(page);
    await page.goto(`/events/${neon.slug}`);
    const tickets = page.locator("#tickets");
    await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click({ timeout: 30_000 });
    await tickets.getByRole("group", { name: "Support Sheltüh" }).locator("label", { hasText: "A$2" }).click();
    await tickets.getByRole("button", { name: "Checkout" }).click();
    await expect(page).toHaveURL(`/checkout/pay?order=${GA_ORDER}`);
    expect(seen.checkouts.at(-1)?.supportCents).toBe(200);

    const summary = page.getByRole("region", { name: neon.title });
    await expect(summary).toBeVisible({ timeout: 30_000 });
    const toggle = summary.getByRole("button", { name: "Show 1 ticket" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(summary.getByText("General admission")).toBeHidden();
    await expect(summary.locator("[data-support-line]")).toBeVisible();
    await expect(summary.locator("[data-support-line]")).toContainText("A$2");
    await expect(summary.locator("[data-order-total]")).toHaveText("A$33.70");
  });
});
