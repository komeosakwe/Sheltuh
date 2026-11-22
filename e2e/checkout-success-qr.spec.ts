import { expect, test, type Page } from "@playwright/test";

/**
 * The ticket page, /checkout/success (Latte's 1120 My ticket frames around
 * the orange-outline ticket; QR rules in docs/design/check-in.md §5.B), in a
 * real Chromium on `next dev`, with /api intercepted: the order lookup
 * returns a paid order with two real-format codes (and, separately, an
 * old-style code, a checked-in ticket and a refunded order). Proves the page
 * renders, on each ticket, the event's name, date and venue, a QR image and
 * the backup code as text, at the page's plate sizes and layout at 390, 768
 * and 1440, without sideways scrolling; and that the phone's full-screen
 * ticket and the page's sheets open, trap focus and close. It does NOT prove the code
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

// The page ticket's QR: 165 (5px modules) on phones, 198 (6px) from 768. `ticket`: the ticket's own width.
const VIEWPORTS = [
  { name: "320px phone", width: 320, height: 568, plate: 165, ticket: 288 },
  { name: "390px phone", width: 390, height: 844, plate: 165, ticket: 358 },
  { name: "768px tablet", width: 768, height: 1024, plate: 198, ticket: 296 },
  { name: "1440px desktop", width: 1440, height: 900, plate: 198, ticket: 360 },
];

for (const vp of VIEWPORTS) {
  test(`at ${vp.name}, each ticket shows a ${vp.plate}px QR with its code as text`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await stubApi(page, ORDER);
    await page.goto("/checkout/success?session_id=ord_e2e");

    await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible();
    // One ticket shows at a time, at every width: "Ticket 1 of 2" between Previous and Next.
    const tickets = page.getByRole("region", { name: "Your tickets" });
    for (const [i, { ticketCode }] of ORDER.tickets.entries()) {
      if (i > 0) {
        const next = tickets.getByRole("button", { name: "Next ticket" });
        await next.click();
        await expect(next).toBeFocused();
        await expect(next).toHaveAttribute("aria-disabled", "true");
      }
      await expect(tickets.getByText(`Ticket ${i + 1} of 2`, { exact: true })).toBeVisible();
      // The other ticket is hidden on screen (it prints).
      await expect(page.getByRole("img", { name: `QR code for ticket ${ORDER.tickets[1 - i].ticketCode}` })).toBeHidden();
      const qr = page.getByRole("img", { name: `QR code for ticket ${ticketCode}` });
      await qr.scrollIntoViewIfNeeded();
      await expect(qr).toBeVisible();
      await expect(page.getByText(ticketCode, { exact: true })).toBeVisible();
      await expect(page.getByText(`Show this at the door · ticket ${i + 1} of 2`)).toBeVisible();
      const stub = page.getByRole("listitem").filter({ hasText: ticketCode });
      const ticket = stub.getByRole("article");
      await expect(ticket.getByText("Neon Static", { exact: true })).toBeVisible();
      await expect(ticket.getByText("Sat 6 Mar", { exact: true })).toBeVisible();
      await expect(ticket.getByText("8–11:30 pm", { exact: true })).toBeVisible();
      await expect(ticket.getByText("General admission", { exact: true })).toBeVisible();
      // The compact phone ticket leaves the venue line out (it's under the page's title); from 768 it's on the ticket.
      if (vp.width >= 768) await expect(ticket.getByText("The Tote · Collingwood", { exact: true })).toBeVisible();
      else await expect(ticket.getByText("The Tote · Collingwood", { exact: true })).toBeHidden();
      // The orange-outline ticket: a Signal Orange frame round a white inside, in its column's width.
      expect(await ticket.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 72, 0)");
      expect(await ticket.locator("> div").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
      expect((await ticket.boundingBox())?.width).toBeCloseTo(vp.ticket, 0);

      const box = await qr.boundingBox();
      expect(box?.width).toBeCloseTo(vp.plate, 0);
      expect(box?.height).toBeCloseTo(vp.plate, 0);
      // Black modules on a white plate, whatever the page colours.
      expect(await qr.locator("rect").getAttribute("fill")).toBe("#ffffff");
      // The modules and the centre ü (docs/design/ticket-email.md §6), both black.
      const modules = qr.locator('path[data-qr="modules"]');
      expect(await modules.getAttribute("fill")).toBe("#000000");
      expect(await modules.evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(0, 0, 0)");
      const mark = qr.locator('svg[data-qr="mark"] path');
      await expect(mark).toHaveCount(1);
      expect(await mark.evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(0, 0, 0)");
      expect(await qr.locator("rect").evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(255, 255, 255)");
    }
    const hint = page.getByText("Turn your brightness up. If the QR code won’t scan, door staff can type in the backup code.");
    await expect(hint).toHaveCount(2);
    // The shown ticket's (the second, now).
    if (vp.width >= 768) await expect(hint.last()).toBeVisible();
    else await expect(hint.last()).toBeHidden();
    await expect(page.getByText("Each code works once. Don’t share it.")).toBeVisible();
    await expect(page.getByText("Sat 6 Mar · 8:00 – 11:30 pm AEDT")).toBeVisible();

    // The layout: the ticket beside the details from 768, above them on phones. "Show ticket" is for phones.
    const ticketBox = await page.locator("article:visible").first().boundingBox();
    const titleBox = await page.getByRole("heading", { level: 1 }).boundingBox();
    if (!ticketBox || !titleBox) throw new Error("the ticket and the title should both be laid out");
    if (vp.width >= 768) expect(titleBox.x).toBeGreaterThan(ticketBox.x + ticketBox.width);
    else expect(titleBox.y).toBeGreaterThan(ticketBox.y + ticketBox.height);
    const show = page.getByRole("button", { name: "Show ticket 2 of 2" });
    if (vp.width >= 768) await expect(show).toBeHidden();
    else await expect(show).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("on a phone, Show ticket opens the ticket full screen for scanning; Next moves on; Escape returns to the button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubApi(page, ORDER);
  await page.goto("/checkout/success?session_id=ord_e2e");
  const show = page.getByRole("button", { name: "Show ticket 1 of 2" });
  await show.click();
  const dialog = page.getByRole("dialog", { name: "Your ticket" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Ticket 1 of 2", { exact: true })).toBeVisible();
  const qr = dialog.getByRole("img", { name: "QR code for ticket 7KQM-2HXD" });
  await expect(qr).toBeVisible();
  expect((await qr.boundingBox())?.width).toBeCloseTo(264, 0);
  // Focus is inside the dialog, and the page behind can't be reached.
  expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);
  await dialog.getByRole("button", { name: "Next ticket" }).click();
  await expect(dialog.getByText("Ticket 2 of 2", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "QR code for ticket A2B3-C4D5" })).toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(show).toBeFocused();
});

for (const vp of [
  { name: "a bottom sheet on a phone", width: 390, height: 844 },
  { name: "a 480 dialog on a tablet", width: 768, height: 1024 },
]) {
  test(`View receipt opens ${vp.name}: focus stays inside, Escape closes it and focus goes back`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await stubApi(page, ORDER);
    await page.goto("/checkout/success?session_id=ord_e2e");
    const open = page.getByRole("button", { name: "View receipt" });
    await open.click();
    const sheet = page.getByRole("dialog", { name: "Order #7C1F2E0A" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("2 × General admission")).toBeVisible();
    await expect(sheet.getByText("A$64.60")).toBeVisible();
    // Once it has slid in (a short transition, off with reduced motion).
    await expect.poll(async () => { const b = await sheet.boundingBox(); return b ? Math.round(b.y + b.height) : 0; }).toBeLessThanOrEqual(vp.height);
    await page.waitForTimeout(300);
    const box = await sheet.boundingBox();
    if (!box) throw new Error("the sheet should be laid out");
    if (vp.width < 768) {
      // Pinned to the bottom, full width, its height hugging the content.
      expect(box.width).toBeCloseTo(vp.width, 0);
      expect(box.y + box.height).toBeCloseTo(vp.height, 0);
      expect(box.height).toBeLessThan(vp.height / 2);
      await expect(sheet.getByRole("button", { name: "Close" })).toHaveCount(1);
    } else {
      expect(box.width).toBeCloseTo(480, 0);
      expect(box.x).toBeCloseTo((vp.width - 480) / 2, 0);
    }
    // Tab stays inside the sheet.
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement?.closest("dialog") !== null)).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(open).toBeFocused();
  });
}

test("a checked-in ticket says when, and keeps its QR", async ({ page }) => {
  await stubApi(page, {
    ...ORDER,
    tickets: [{ ...ORDER.tickets[0], checkedInAt: "2027-03-06T09:42:00.000Z" }, ORDER.tickets[1]],
  });
  await page.goto("/checkout/success?session_id=ord_e2e");
  const first = page.getByRole("listitem").filter({ hasText: "7KQM-2HXD" });
  // In words, on the orange stamp over the (dimmed) QR, with the door's time.
  await expect(first.getByText(/Checked in$/)).toBeVisible();
  await expect(first.getByText(/^(Sat 6 Mar( 2027)?, )?8:42 pm · Enjoy the night$/)).toBeVisible();
  await expect(first.getByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "A2B3-C4D5" }).getByText("Checked in")).toHaveCount(0);
  await expect(page.getByText(/^Turn your brightness up\./)).toHaveCount(1);
  // Codes are the one place mono stays (owner decision, 13 Nov 2026): the backup code and the order
  // reference in IBM Plex Mono, so 0/O and 1/l read apart; the label above the code is Instrument Sans.
  const mono = (el: Element) => getComputedStyle(el).fontFamily;
  expect(await first.getByText("7KQM-2HXD", { exact: true }).evaluate(mono)).toMatch(/^"IBM Plex Mono", /);
  expect(await first.getByText(/Enjoy the night$/).evaluate(mono)).toMatch(/^"Instrument Sans", /);
  expect(await page.getByText("Order #7C1F2E0A Confirmed", { exact: true }).evaluate(mono)).toMatch(/^"IBM Plex Mono", /);
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
