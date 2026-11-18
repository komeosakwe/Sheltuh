import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The buyer's ticket email (docs/architecture.md, "Buyer email checks") in a
 * real browser: the event page's "Email for your tickets" with its "Did you
 * mean …?" and the server's refusal, at 1440 and 390; the confirmation page
 * of the browser that paid (its order access token, from the checkout's 201,
 * goes back in the x-order-access header, never the address) with its one
 * change; and support's change on /admin/emails. Live mode, every /api/*
 * request answered here.
 */

const DAY = 86_400_000;
const now = Date.now();
const ORDER_ID = `ord_${"beefcafe".repeat(4)}`;
const TOKEN = "7a".repeat(32);

const sample = sampleEvents.find((e) => e.slug === "neon-static");
if (!sample) throw new Error("no sample neon-static");
const ga = sample.ticketTypes.find((t) => t.name === "General admission");
if (!ga) throw new Error("no General admission tier");

function asPublic(): PublicEvent {
  const start = now + 7 * DAY;
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

function paidOrder(email: string, emailChange: object) {
  return {
    status: "paid",
    reference: "#BEEFCAFE",
    eventTitle: sample!.title,
    eventSlug: sample!.slug,
    email,
    emailChange,
    subtotalCents: 3000,
    buyerFeeCents: 230,
    totalCents: 3230,
    tickets: [{ ticketCode: "7KQM-2HXD", ticketTypeName: "General admission", checkedInAt: null }],
  };
}

interface Seen {
  checkouts: Record<string, unknown>[];
  orderReads: { url: string; access?: string }[];
  changes: { url: string; access?: string; body: unknown }[];
}

/**
 * The event page and the confirmation page. The first checkout is refused for an address that can't receive
 * email (with the server's suggestion); the next one answers 201 with the order access token and leads
 * straight to the confirmation page.
 */
async function mockBuyerApi(page: Page): Promise<Seen> {
  const seen: Seen = { checkouts: [], orderReads: [], changes: [] };
  const pub = asPublic();
  let email = "alex@outlok.co";
  let changed = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const access = request.headers()["x-order-access"];
    if (url.pathname === `/api/events/slug/${pub.slug}`) return route.fulfill({ json: pub });
    if (url.pathname === `/api/events/${pub.eventId}/checkout` && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      seen.checkouts.push(body);
      if (body.buyerEmail === "alex@outlok.co") {
        const message = "That email address can't receive email. Check the part after the @.";
        return route.fulfill({
          status: 400,
          json: { error: message, fieldErrors: { buyerEmail: message }, code: "email_no_mail", suggestion: "alex@outlook.com" },
        });
      }
      email = String(body.buyerEmail);
      return route.fulfill({
        status: 201,
        json: { url: `/checkout/success?session_id=${ORDER_ID}`, orderId: ORDER_ID, orderAccess: TOKEN },
      });
    }
    if (url.pathname === `/api/orders/by-session/${ORDER_ID}` && request.method() === "GET") {
      seen.orderReads.push({ url: request.url(), access });
      if (access !== TOKEN) return route.fulfill({ json: { ...paidOrder(email, {}), email: undefined, emailChange: undefined, maskedEmail: "a***@outlook.com" } });
      return route.fulfill({
        json: paidOrder(email, changed ? { allowed: false, reason: "email_already_changed" } : { allowed: true }),
        headers: { "cache-control": "private, no-store" },
      });
    }
    if (url.pathname === `/api/orders/by-session/${ORDER_ID}/email` && request.method() === "POST") {
      const body = request.postDataJSON() as { email: string };
      seen.changes.push({ url: request.url(), access, body });
      if (access !== TOKEN) return route.fulfill({ status: 404, json: { error: "Order not found." } });
      email = body.email;
      changed = true;
      return route.fulfill({ json: { result: "changed", order: paidOrder(email, { allowed: false, reason: "email_already_changed" }) } });
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

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`the ticket email at ${viewport.width}px`, () => {
    test.use({ viewport, ...(viewport.width < 1024 ? { hasTouch: true } : {}) });

    test("Did you mean …? once typing pauses, the server's refusal with its suggestion, then the paying browser's one change", async ({ page }) => {
      const seen = await mockBuyerApi(page);
      await page.goto(`/events/${sample!.slug}`);
      const tickets = page.locator("#tickets");
      await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click({ timeout: 30_000 });
      await tickets.getByLabel("Your name").fill("Alex Doe");
      const email = tickets.getByLabel("Email for your tickets");
      // Paid orders ask for it now, and nothing says Stripe will.
      await expect(email).toBeVisible();
      await expect(tickets).not.toContainText("Stripe will ask");

      // A known typo: the hint once typing pauses, while focus is still in the field; Use this puts it in.
      await email.fill("alex@gmial.com");
      await expect(tickets.getByText(/Did you mean/)).toHaveText("Did you mean alex@gmail.com?");
      await expect(email).toBeFocused();
      // Next in the Tab order: Use this, right after the field.
      await email.press("Tab");
      await expect(tickets.getByRole("button", { name: "Use this" })).toBeFocused();
      const use = tickets.getByRole("button", { name: "Use this" });
      const box = (await use.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      await use.click();
      await expect(email).toHaveValue("alex@gmail.com");
      await expect(email).toBeFocused();
      await noSidewaysScroll(page);

      // An address the server refuses: its error on the field, with its suggestion.
      await email.fill("alex@outlok.co");
      await tickets.getByRole("button", { name: "Checkout" }).click();
      await expect(tickets.getByRole("alert")).toHaveText("That email address can't receive email. Check the part after the @.");
      await expect(email).toBeFocused();
      await expect(email).toHaveAttribute("aria-invalid", "true");
      await expect(tickets.getByText(/Did you mean/)).toHaveText("Did you mean alex@outlook.com?");
      await noSidewaysScroll(page);
      await tickets.getByRole("button", { name: "Use this" }).click();
      await expect(tickets.getByRole("alert")).toHaveCount(0);

      await tickets.getByRole("button", { name: "Checkout" }).click();
      await expect(page).toHaveURL(`/checkout/success?session_id=${ORDER_ID}`, { timeout: 30_000 });
      expect(seen.checkouts.map((c) => c.buyerEmail)).toEqual(["alex@outlok.co", "alex@outlook.com"]);

      // The confirmation page: this browser kept the token and sends it in a header, never the address.
      await expect(page.getByText("Tickets sent to alex@outlook.com.")).toBeVisible({ timeout: 30_000 });
      expect(seen.orderReads.length).toBeGreaterThan(0);
      expect(seen.orderReads.every((read) => read.access === TOKEN && !read.url.includes(TOKEN))).toBe(true);
      expect(page.url()).not.toContain(TOKEN);

      // Escape closes the form, focus back on Change it.
      const open = page.getByRole("button", { name: "Wrong email? Change it" });
      await open.click();
      const field = page.getByLabel("New email for your tickets");
      await expect(field).toBeFocused();
      await field.press("Escape");
      await expect(field).toHaveCount(0);
      await expect(open).toBeFocused();

      await open.click();
      await expect(field).toBeFocused();
      await expect(field).toHaveValue("alex@outlook.com");
      await expect(field).toHaveAttribute("enterkeyhint", "send");
      await field.fill("alex.doe@outlook.com");
      // Enter sends it (a phone's Send key too): no tap on the button needed.
      await field.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: "Email changed" })).toHaveText(
        "Email changed. Tickets are on their way to alex.doe@outlook.com. To change it again, contact support@sheltuh.com.au.",
      );
      await expect(page.getByRole("group", { name: "Ticket email" })).toBeFocused();
      await expect(page.getByText(/Tickets sent to/)).toHaveCount(0);
      await expect(page.getByText(/You’ve already changed this email once/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Wrong email? Change it" })).toHaveCount(0);
      expect(seen.changes).toEqual([
        { url: expect.not.stringContaining(TOKEN), access: TOKEN, body: { email: "alex.doe@outlook.com" } },
      ]);
      await noSidewaysScroll(page);
    });
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`a typo, then Checkout straight away, at ${viewport.width}px`, () => {
    test.use({ viewport, ...(viewport.width < 1024 ? { hasTouch: true } : {}) });

    test("the click lands: nothing moves under it, and the checkout is sent with what was typed", async ({ page }) => {
      const seen = await mockBuyerApi(page);
      await page.goto(`/events/${sample!.slug}`);
      const tickets = page.locator("#tickets");
      await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click({ timeout: 30_000 });
      await tickets.getByLabel("Your name").fill("Alex Doe");
      const email = tickets.getByLabel("Email for your tickets");
      const checkout = tickets.getByRole("button", { name: "Checkout" });
      await checkout.scrollIntoViewIfNeeded();
      // Typed key by key, then straight to Checkout: no blur trick, no pause for the hint.
      await email.pressSequentially("alex@gmial.com", { delay: 20 });
      // Where Checkout is the moment typing stops (well inside the hint's 500 ms), clicked at that point: a
      // locator's click would wait for the button to stop moving and follow it, passing even if the hint moved it.
      const box = await checkout.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(page).toHaveURL(`/checkout/success?session_id=${ORDER_ID}`, { timeout: 30_000 });
      expect(seen.checkouts.map((c) => c.buyerEmail)).toEqual(["alex@gmial.com"]);
    });
  });
}

test.describe("another device opening the order's link", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no token: the masked email and support's address, and no change", async ({ page }) => {
    const seen = await mockBuyerApi(page);
    await page.goto(`/checkout/success?session_id=${ORDER_ID}`);
    await expect(page.getByText("Tickets sent to a***@outlook.com.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Wrong email\? Contact/)).toContainText("support@sheltuh.com.au");
    await expect(page.getByRole("button", { name: "Wrong email? Change it" })).toHaveCount(0);
    expect(seen.orderReads.every((read) => read.access === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Support's change on /admin/emails
// ---------------------------------------------------------------------------

const SUMMARY = {
  reportsOpen: { count: 0 },
  eventsPending: { count: 0, startingSoon: 0, startingSoonHours: 72 },
  organisersPending: { count: 0 },
  emailsFailed: { count: 0 },
  emailsRetrying: { count: 0 },
  doorEvents: { count: 0, windowHours: 24 },
  eventsPublishedByOrganisers: { count: 0, windowHours: 72 },
};

function adminJob(extra: Record<string, unknown> = {}) {
  return {
    jobId: "41",
    kind: "ticket_email",
    status: "sent",
    attempts: 1,
    createdAt: new Date(now - 3600_000).toISOString(),
    sentAt: new Date(now - 3500_000).toISOString(),
    orderReference: "#BEEFCAFE",
    orderStatus: "paid",
    eventTitle: sample!.title,
    maskedEmail: "a***@outlook.com",
    emailChanges: [
      { changedBy: "buyer", oldMaskedEmail: "a***@outlook.com", newMaskedEmail: "a***@outlook.com", changedAt: new Date(now - 1800_000).toISOString() },
    ],
    ...extra,
  };
}

async function mockAdmin(page: Page) {
  const seen: { lists: string[]; changes: { body: unknown; authorization?: string }[] } = { lists: [], changes: [] };
  const session = {
    access_token: "e2e.token.x",
    token_type: "bearer",
    expires_in: 31_536_000,
    expires_at: Math.floor(now / 1000) + 31_536_000,
    refresh_token: "r",
    user: {
      id: "u-admin",
      aud: "authenticated",
      role: "authenticated",
      email: "admin@sheltuh.example",
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: { provider: "email", role: "admin" },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/admin/summary") return route.fulfill({ json: SUMMARY });
    if (path === "/api/admin/emails" && request.method() === "GET") {
      seen.lists.push(url.search);
      if (url.searchParams.get("reference")) return route.fulfill({ json: { items: [adminJob()] } });
      return route.fulfill({ json: { items: [] } });
    }
    if (path === "/api/admin/emails/41/change-email" && request.method() === "POST") {
      seen.changes.push({ body: request.postDataJSON(), authorization: request.headers()["authorization"] });
      return route.fulfill({
        json: {
          result: "changed",
          job: adminJob({
            status: "pending",
            attempts: 0,
            sentAt: undefined,
            maskedEmail: "j***@example.com",
            emailChanges: [
              { changedBy: "admin", reason: "Buyer phoned to fix a typo", oldMaskedEmail: "a***@outlook.com", newMaskedEmail: "j***@example.com", changedAt: new Date(now).toISOString() },
              ...adminJob().emailChanges,
            ],
          }),
        },
      });
    }
    if (path === "/api/organisers/me") return route.fulfill({ status: 404, json: { error: "No organiser." } });
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Admin", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return seen;
}

test.describe("support changes an order's email at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("find the order by reference, change its email with a reason, and see the history", async ({ page }) => {
    const seen = await mockAdmin(page);
    await page.goto("/admin/emails");
    await expect(page.getByRole("heading", { name: "Failed ticket emails" })).toBeVisible({ timeout: 30_000 });
    const search = page.getByRole("search", { name: "Find an order" });
    await search.getByLabel("Find an order by reference").fill("beefcafe");
    await search.getByRole("button", { name: "Find" }).click();
    await expect(page.getByRole("heading", { name: "Ticket email for order #BEEFCAFE" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Found order" })).toHaveText("Found order #BEEFCAFE.");
    expect(seen.lists.at(-1)).toContain("reference=%23BEEFCAFE");

    const item = page.getByRole("article", { name: `Order #BEEFCAFE: ${sample!.title}` });
    await expect(item.getByText("By the buyer", { exact: false })).toBeVisible();
    await expect(item.getByRole("heading", { level: 4, name: "Email changes" })).toBeVisible();
    await item.getByRole("button", { name: "Change email" }).click();
    const form = item.getByRole("form", { name: "Change email for order #BEEFCAFE" });
    await expect(form.getByLabel("New email")).toBeFocused();
    await form.getByLabel("New email").fill("jo@example.com");
    await form.getByLabel("Reason").fill("Buyer phoned to fix a typo");
    await form.getByRole("button", { name: "Change and send" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Email changed" })).toHaveText(
      "Email changed for order #BEEFCAFE. The tickets are being sent to the new address.",
    );
    await expect(item.getByText("Reason: Buyer phoned to fix a typo")).toBeVisible();
    await expect(item.getByText("a***@outlook.com → j***@example.com")).toBeVisible();
    expect(seen.changes).toEqual([{ body: { email: "jo@example.com", reason: "Buyer phoned to fix a typo" }, authorization: "Bearer e2e.token.x" }]);
    await noSidewaysScroll(page);
  });
});
