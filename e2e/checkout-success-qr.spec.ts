import { expect, test, type Page } from "@playwright/test";

/**
 * The QR ticket on /checkout/success (docs/design/check-in.md §5.B) in a real
 * Chromium on `next dev`, with /api intercepted: the order lookup returns a
 * paid order with two real-format codes (and, separately, an old-style code,
 * a checked-in ticket and a refunded order). Proves the page renders, on each
 * ticket, the event's name, date and venue, a QR image, the backup code as
 * text and the ticket's status, at the spec's plate sizes, without sideways
 * scrolling. It does NOT prove the code
 * scans on a real phone or under a browser's automatic dark mode (§7: device
 * checks).
 */

const ORDER = {
  status: "paid",
  reference: "#7C1F2E0A",
  eventTitle: "Neon Static",
  eventSlug: "neon-static",
  eventStartsAt: "2027-03-06T09:00:00.000Z", // 8:00 pm AEDT
  eventEndsAt: "2027-03-06T12:30:00.000Z",
  venueName: "The Tote",
  suburb: "Collingwood",
  maskedEmail: "m***@example.com",
  subtotalCents: 6000,
  buyerFeeCents: 460,
  totalCents: 6460,
  tickets: [
    { ticketCode: "7KQM-2HXD", ticketTypeName: "General admission", checkedInAt: null },
    { ticketCode: "A2B3-C4D5", ticketTypeName: "General admission", checkedInAt: null },
  ],
};

async function stubApi(page: Page, order: unknown) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/orders/by-session/ord_e2e") return route.fulfill({ status: 200, json: order });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

const VIEWPORTS = [
  { name: "320px phone", width: 320, height: 568, plate: 203 },
  { name: "375px phone", width: 375, height: 667, plate: 232 },
  { name: "desktop", width: 1280, height: 800, plate: 232 },
];

for (const vp of VIEWPORTS) {
  test(`at ${vp.name}, each ticket shows a ${vp.plate}px QR with its code as text`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await stubApi(page, ORDER);
    await page.goto("/checkout/success?session_id=ord_e2e");

    await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible();
    for (const [i, { ticketCode }] of ORDER.tickets.entries()) {
      const qr = page.getByRole("img", { name: `QR code for ticket ${ticketCode}` });
      await qr.scrollIntoViewIfNeeded();
      await expect(qr).toBeVisible();
      await expect(page.getByText(ticketCode, { exact: true })).toBeVisible();
      await expect(page.getByText(`Ticket ${i + 1} of 2 · General admission`)).toBeVisible();
      const stub = page.getByRole("listitem").filter({ hasText: ticketCode });
      await expect(stub.getByText("Neon Static", { exact: true })).toBeVisible();
      await expect(stub.getByText("Sat 6 Mar, 8:00 pm – 11:30 pm", { exact: true })).toBeVisible();
      await expect(stub.getByText("The Tote, Collingwood, VIC", { exact: true })).toBeVisible();
      await expect(stub.getByText("Backup code", { exact: true })).toBeVisible();
      await expect(stub.getByText("Ready to scan", { exact: true })).toBeVisible();

      const box = await qr.boundingBox();
      expect(box?.width).toBeCloseTo(vp.plate, 0);
      expect(box?.height).toBeCloseTo(vp.plate, 0);
      // Black modules on a white plate, whatever the page colours.
      expect(await qr.locator("rect").getAttribute("fill")).toBe("#ffffff");
      expect(await qr.locator("path").getAttribute("fill")).toBe("#000000");
      expect(await qr.locator("path").evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(0, 0, 0)");
      expect(await qr.locator("rect").evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(255, 255, 255)");
    }
    await expect(page.getByText("Turn your brightness up at the door.")).toHaveCount(2);
    await expect(page.getByText("Each code works once. Don’t share it.")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("a checked-in ticket says when, and keeps its QR", async ({ page }) => {
  await stubApi(page, {
    ...ORDER,
    tickets: [{ ...ORDER.tickets[0], checkedInAt: "2027-03-06T09:42:00.000Z" }, ORDER.tickets[1]],
  });
  await page.goto("/checkout/success?session_id=ord_e2e");
  const first = page.getByRole("listitem").filter({ hasText: "7KQM-2HXD" });
  await expect(first.getByText(/^Checked in (Sat 6 Mar( 2027)?, )?8:42 pm$/)).toBeVisible();
  await expect(first.getByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "A2B3-C4D5" }).getByText("Ready to scan")).toBeVisible();
  await expect(page.getByText("Turn your brightness up at the door.")).toHaveCount(1);
});

test("a code that isn't a real one shows as text only, with no QR", async ({ page }) => {
  await stubApi(page, { ...ORDER, tickets: [{ ticketCode: "ABC123", ticketTypeName: "General admission", checkedInAt: null }] });
  await page.goto("/checkout/success?session_id=ord_e2e");
  await expect(page.getByText("ABC123", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code for ticket/ })).toHaveCount(0);
});

test("a refunded order shows the refund message and no QR or code", async ({ page }) => {
  await stubApi(page, { ...ORDER, status: "refunded", refundReason: "refunded", tickets: [] });
  await page.goto("/checkout/success?session_id=ord_e2e");
  await expect(page.getByText("This order has been refunded")).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code for ticket/ })).toHaveCount(0);
  await expect(page.getByText("7KQM-2HXD")).toHaveCount(0);
  await expect(page.getByText("The Tote, Collingwood")).toHaveCount(0);
});
