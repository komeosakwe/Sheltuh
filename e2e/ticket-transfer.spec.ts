import { expect, test, type Page } from "@playwright/test";
import type { CustomerOrder, ReceivedTicket, TicketOffer } from "@/lib/api/types";

/**
 * Sending a ticket to a friend in a real browser (docs/architecture.md,
 * "Ticket transfers"), live mode with /api/* answered here: the buyer sends
 * from the ticket page (Manage order's dialog from 768, the full-screen
 * ticket's sheet on a phone), sees the toast and the "Waiting for Sam to
 * accept" strip, and cancels; the friend opens the accept link signed out,
 * goes to sign in and back (the token waits in the tab), accepts and lands
 * on their own ticket; the email's Decline asks first; the accept page's
 * headers keep the link out of Referers and search. No sideways scrolling.
 */

const DAY = 86_400_000;
const now = Date.now();
const ORD = "ord_0123456789abcdef0123456789abcdef";
const TID = "0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f";
const TOKEN = "T".repeat(40) + "k_-";
const startsAt = new Date(now + 20 * DAY).toISOString();
const endsAt = new Date(now + 20 * DAY + 4 * 3_600_000).toISOString();

const ORDER: CustomerOrder = {
  status: "paid",
  reference: "#A90133C9",
  eventTitle: "Here & Now",
  eventSlug: "here-and-now",
  eventListed: true,
  eventStartsAt: startsAt,
  eventEndsAt: endsAt,
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
  maskedEmail: "a***@email.com",
  subtotalCents: 2400,
  buyerFeeCents: 194,
  totalCents: 2594,
  tickets: [{ ticketCode: "BPT7-7P6W", ticketTypeName: "Second release", checkedInAt: null, ticketNumber: 1, canSend: true }],
  transfers: { canSend: true, closesAt: new Date(now + 20 * DAY - 2 * 3_600_000).toISOString() },
};

const PENDING: CustomerOrder = {
  ...ORDER,
  tickets: [
    {
      ...ORDER.tickets[0],
      canSend: false,
      transfer: { transferId: TID, status: "pending", toName: "Sam Lee", toMaskedEmail: "s***@email.com", expiresAt: new Date(now + 3 * DAY).toISOString(), canCancel: true },
    },
  ],
};

const OFFER: TicketOffer = {
  status: "open",
  fromName: "Alex Chen",
  toName: "Sam Lee",
  toMaskedEmail: "s***@email.com",
  expiresAt: new Date(now + 3 * DAY).toISOString(),
  eventTitle: "Here & Now",
  eventListed: true,
  eventSlug: "here-and-now",
  eventStartsAt: startsAt,
  eventEndsAt: endsAt,
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
  ticketTypeName: "Second release",
};

const RECEIVED: ReceivedTicket = {
  transferId: TID,
  reference: "#0B5C2F8E",
  fromName: "Alex Chen",
  holderName: "Sam Lee",
  acceptedAt: new Date(now).toISOString(),
  status: "valid",
  eventTitle: "Here & Now",
  eventListed: true,
  eventSlug: "here-and-now",
  eventStartsAt: startsAt,
  eventEndsAt: endsAt,
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
  ticket: { ticketCode: "K9QD-4XRT", ticketTypeName: "Second release", checkedInAt: null },
};

function session(id: string, email: string) {
  return {
    access_token: "e2e.token.x",
    token_type: "bearer",
    expires_in: 31_536_000,
    expires_at: Math.floor(now / 1000) + 31_536_000,
    refresh_token: "r",
    user: {
      id,
      aud: "authenticated",
      role: "authenticated",
      email,
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

/** Every /api/* answered here; the writes are recorded. */
async function stubApi(page: Page) {
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  let order: CustomerOrder = ORDER;
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST") writes.push({ path, body: request.postDataJSON() });
    if (path === `/api/orders/by-session/${ORD}`) return route.fulfill({ json: order });
    if (path === `/api/orders/by-session/${ORD}/ticket-transfers`) {
      order = PENDING;
      return route.fulfill({ status: 201, json: { transferId: TID, order } });
    }
    if (path === `/api/orders/by-session/${ORD}/ticket-transfers/${TID}/cancel`) {
      order = ORDER;
      return route.fulfill({ json: { order } });
    }
    if (path === "/api/ticket-transfers/view") return route.fulfill({ json: OFFER });
    if (path === "/api/ticket-transfers/accept") return route.fulfill({ json: { transferId: TID } });
    if (path === "/api/ticket-transfers/decline") return route.fulfill({ json: { status: "declined" } });
    if (path === `/api/me/received-tickets/${TID}`) return route.fulfill({ json: RECEIVED });
    if (path === "/api/profiles/me") return route.fulfill({ status: 404, json: { error: "No profile." } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return { writes };
}

async function fillSend(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Send this ticket" });
  await expect(dialog.getByLabel("Their name")).toBeFocused();
  await dialog.getByLabel("Their name").fill("Sam Lee");
  await dialog.getByLabel("Their email").fill("sam@email.com");
  await dialog.getByLabel("Your name").fill("Alex Chen");
  await dialog.getByRole("button", { name: "Send ticket" }).click();
  await expect(dialog).toBeHidden();
}

test("desktop: Manage order → Send ticket → toast → waiting strip → Cancel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { writes } = await stubApi(page);
  await page.goto(`/checkout/success?session_id=${ORD}`);
  await page.getByRole("button", { name: "Manage order" }).click();
  await page.getByRole("button", { name: /Send ticket to a friend/ }).click();
  const dialog = page.getByRole("dialog", { name: "Send this ticket" });
  // The 480 dialog with its ✕ (no Cancel button from 768).
  expect((await dialog.boundingBox())?.width).toBeCloseTo(480, 0);
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeHidden();
  // Escape closes it and focus goes back to the control that opened it (Manage order's own sheet has closed,
  // so the browser hands it to Manage order).
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Manage order" })).toBeFocused();

  await page.getByRole("button", { name: "Manage order" }).click();
  await page.getByRole("button", { name: /Send ticket to a friend/ }).click();
  await fillSend(page);
  expect(writes.find((w) => w.path.endsWith("/ticket-transfers"))?.body).toEqual({ ticket: 1, name: "Sam Lee", email: "sam@email.com", senderName: "Alex Chen" });
  await expect(page.getByRole("status").filter({ hasText: "Sent to Sam. We’ll email you when they accept." })).toBeVisible();
  await expect(page.getByText("Waiting for Sam to accept")).toBeVisible();
  // The QR still works while it waits.
  await expect(page.getByRole("img", { name: /BPT7-7P6W/ })).toBeVisible();

  const cancel = page.getByRole("button", { name: "Cancel sending this ticket" });
  expect((await cancel.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await cancel.click();
  await expect(page.getByText("Cancelled. Your QR code still works.")).toBeVisible();
  await expect(page.getByText("Waiting for Sam to accept")).toBeHidden();
  expect(writes.some((w) => w.path.endsWith("/cancel"))).toBe(true);
});

test("390 phone: the full-screen ticket's Send opens the bottom sheet; the toast shows over the ticket", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubApi(page);
  await page.goto(`/checkout/success?session_id=${ORD}`);
  await page.getByRole("button", { name: /Show ticket/ }).click();
  const screenDialog = page.getByRole("dialog", { name: "Your ticket" });
  await screenDialog.getByRole("button", { name: "Send", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Send this ticket" });
  // Full width, pinned to the bottom (once it has slid up), with Cancel last.
  await expect.poll(async () => {
    const box = await sheet.boundingBox();
    return box ? [Math.round(box.width), Math.round(box.y + box.height)] : null;
  }).toEqual([390, 844]);
  await expect(sheet.getByRole("button", { name: "Cancel" })).toBeVisible();
  await noSidewaysScroll(page);
  await fillSend(page);
  // The full-screen ticket stays up; the toast is inside it (the page behind is inert), wholly on screen and
  // below the top bar, so ✕ and the ticket count stay clear (its words may wrap: that's allowed).
  const words = screenDialog.getByText("Sent to Sam. We’ll email you when they accept.");
  await expect(words).toBeVisible();
  const box = await screenDialog.locator("[data-toast] > div").boundingBox();
  const close = await screenDialog.getByRole("button", { name: "Close ticket" }).boundingBox();
  if (!box || !close) throw new Error("the toast and ✕ should both be laid out");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(close.y + close.height);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  // Send has gone (the ticket's on offer now): focus is on ✕, not lost to the inert page.
  await expect(screenDialog.getByRole("button", { name: "Send", exact: true })).toBeHidden();
  await expect(screenDialog.getByRole("button", { name: "Close ticket" })).toBeFocused();
  // ✕ still takes a press with the toast up.
  await screenDialog.getByRole("button", { name: "Close ticket" }).click({ trial: true });
});

test("320 phone: the send sheet fits with no sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await stubApi(page);
  await page.goto(`/checkout/success?session_id=${ORD}`);
  await page.getByRole("button", { name: "Manage order" }).click();
  await page.getByRole("button", { name: /Send ticket to a friend/ }).click();
  await expect(page.getByRole("dialog", { name: "Send this ticket" })).toBeVisible();
  await noSidewaysScroll(page);
});

test("accept: signed out → Sign in → back (the token kept in the tab) → Accept → the friend's own ticket", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { writes } = await stubApi(page);
  await page.goto(`/tickets/accept#token=${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: "Alex sent you a ticket" })).toBeVisible();
  // The token is out of the address bar, and never in a query string.
  expect(new URL(page.url()).hash).toBe("");
  await expect(page.getByText("Sign in or create an account, then accept to get your own QR code.")).toBeVisible();
  await expect(page.getByRole("article").getByText("Accept the ticket to get your QR code")).toBeVisible();
  await noSidewaysScroll(page);

  await page.getByRole("link", { name: "Sign in to accept" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Ftickets%2Faccept$/);
  expect(page.url()).not.toContain(TOKEN);

  // Signed in (the stored session), back where `next` says.
  await page.evaluate((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session("u-sam", "sam@email.com"));
  await page.goto("/tickets/accept");
  await expect(page.getByText("Signed in as sam@email.com · Not you?")).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveValue("Sam Lee");
  await page.getByRole("button", { name: "Accept ticket" }).click();
  await expect(page).toHaveURL(new RegExp(`/tickets/received/${TID}$`));
  expect(writes.find((w) => w.path === "/api/ticket-transfers/accept")?.body).toEqual({ token: TOKEN, holderName: "Sam Lee" });
  await expect(page.getByRole("heading", { level: 1, name: "Here & Now" })).toBeVisible();
  await expect(page.getByRole("img", { name: /K9QD-4XRT/ }).first()).toBeAttached();
  await expect(page.getByText("From Alex Chen")).toBeVisible();
  // The token is forgotten once used.
  expect(await page.evaluate(() => sessionStorage.getItem("sheltuh:ticket-offer"))).toBeNull();
  // My tickets is the current place in the account tabs.
  await expect(page.locator('[aria-current="location"]', { hasText: "My tickets" }).first()).toBeAttached();
});

test("the email's Decline (&decline=1) asks first; Decline ticket declines without signing in", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { writes } = await stubApi(page);
  await page.goto(`/tickets/accept#token=${TOKEN}&decline=1`);
  await expect(page.getByRole("heading", { level: 2, name: "Decline this ticket?" })).toBeVisible();
  expect(writes.some((w) => w.path === "/api/ticket-transfers/decline")).toBe(false);
  await page.getByRole("button", { name: "Decline ticket" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "You declined the ticket" })).toBeFocused();
  await expect(page.getByText("We’ve let Alex know.")).toBeVisible();
  expect(writes.find((w) => w.path === "/api/ticket-transfers/decline")?.body).toEqual({ token: TOKEN });
});

test("the accept page and a received ticket are kept out of Referers and search indexes", async ({ page }) => {
  await stubApi(page);
  for (const path of ["/tickets/accept", `/tickets/received/${TID}`]) {
    const response = await page.goto(path);
    expect(response?.headers()["referrer-policy"], path).toBe("no-referrer");
    expect(response?.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  }
});
