import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";
import { stubStripeJs } from "./stripe-stub";

/**
 * Group tickets as a buyer meets them (docs/architecture.md, "Group tickets"), in a real browser on `next dev`
 * with /api intercepted: the event page's "Group of 4" row, its quantity in groups, the checkout request
 * (quantity = groups), the payment summary's "Admits 4" and the order page's one ticket per person.
 * The buyer's side isn't behind NEXT_PUBLIC_GROUP_TICKETS (only authoring is), and the e2e server doesn't set
 * it, so the editor's "Add a group ticket" is covered by tests/EventEditorGroups.test.tsx instead.
 */

const DAY = 86_400_000;
const ORDER_ID = `ord_${"9a5e".repeat(8)}`;

const sample = sampleEvents.find((e) => e.slug === "paper-moon-ceramics-lab");
if (!sample) throw new Error("no sample paper-moon-ceramics-lab");
const group = sample.ticketTypes.find((t) => t.name === "Group of 4");
if (!group) throw new Error("no Group of 4 tier");

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
    endsAt: new Date(start + 3 * 3600_000).toISOString(),
    organiserName: sample!.organiserName,
    ticketTypes: sample!.ticketTypes,
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
  };
}

async function mockApi(page: Page) {
  const checkouts: unknown[] = [];
  const pub = asPublic();
  const start = Date.now() + 7 * DAY;
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
          clientSecret: "cs_test_e2e_secret_group",
          expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
          eventTitle: pub.title,
          eventSlug: pub.slug,
          eventStartsAt: new Date(start).toISOString(),
          eventEndsAt: new Date(start + 3 * 3600_000).toISOString(),
          venueName: pub.venueName,
          suburb: pub.suburb,
          seated: false,
          lines: [
            { ticketTypeName: "Group of 4", quantity: 2, admits: 4, unitTotalCents: 24000, lineTotalCents: 48000, buyerPaysFee: false },
          ],
          subtotalCents: 48000,
          buyerFeeCents: 0,
          totalCents: 48000,
        },
      });
    }
    if (url.pathname === `/api/orders/by-session/${ORDER_ID}`) {
      return route.fulfill({
        json: {
          status: "paid",
          reference: "#9A5E0001",
          eventTitle: pub.title,
          eventSlug: pub.slug,
          maskedEmail: "m***@example.com",
          subtotalCents: 24000,
          buyerFeeCents: 0,
          totalCents: 24000,
          tickets: [1, 2, 3, 4].map((position) => ({
            ticketCode: `GR0${position}-WXYZ`,
            ticketTypeName: "Group of 4",
            checkedInAt: null,
            group: { position, size: 4 },
          })),
        },
      });
    }
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    if (/\/going(\/|$)/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return { checkouts };
}

for (const vp of [
  { name: "1280", width: 1280, height: 900 },
  { name: "390", width: 390, height: 844 },
]) {
  test.describe(`group tickets at ${vp.name}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("the Group of 4 row, groups in the stepper, one checkout line per group, and a ticket per person", async ({ page }) => {
      await stubStripeJs(page);
      const seen = await mockApi(page);
      await page.goto(`/events/${sample!.slug}`);
      const tickets = page.locator("#tickets");
      const row = tickets.getByRole("listitem").filter({ hasText: "Group of 4" });
      await expect(row).toContainText("4 tickets · save A$20", { timeout: 30_000 });
      await expect(row).toContainText("A$240 for 4 incl. booking fee");

      await row.getByRole("button", { name: "Increase quantity for Group of 4" }).click();
      await row.getByRole("button", { name: "Increase quantity for Group of 4" }).click();
      await expect(tickets.getByRole("status")).toContainText("Group of 4: 2 groups, 8 tickets. Total A$480");
      await expect(tickets).toContainText("Tickets (8)");

      await tickets.getByLabel("Your name").fill("Alex Doe");
      // Below lg the sticky buy bar is the one Checkout (its total is the summary's); desktop's is in the panel.
      if (vp.width < 1024) {
        await expect(page.locator("[data-buy-bar]")).toContainText("A$480");
        await page.locator("[data-buy-bar]").getByRole("button", { name: "Buy tickets" }).click();
      } else {
        await tickets.getByRole("button", { name: "Checkout" }).click();
      }
      await expect(page).toHaveURL(`/checkout/pay?order=${ORDER_ID}`);
      // Quantity is groups: the server multiplies by the people the ticket type admits.
      expect(seen.checkouts).toEqual([{ lineItems: [{ ticketTypeId: group!.id, quantity: 2 }], buyerName: "Alex Doe" }]);

      const summary = page.getByRole("region", { name: sample!.title });
      await expect(summary).toContainText("Admits 4", { timeout: 30_000 });
      if (vp.width < 1024) await summary.getByRole("button", { name: "Show 8 tickets" }).click();
      await expect(summary).toContainText("2 × A$240 · Admits 4");

      await page.goto(`/checkout/success?session_id=${ORDER_ID}`);
      await expect(page.getByRole("heading", { level: 2, name: "Your tickets (4)" })).toBeVisible();
      for (const position of [1, 2, 3, 4]) {
        await expect(page.getByText(`Ticket ${position} of 4 · Group of 4 (${position} of 4)`)).toBeVisible();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
