import { expect, test, type Page } from "@playwright/test";
import { stubStripeJs } from "./stripe-stub";

/**
 * The payment page's Content Security Policy (proxy.ts, lib/csp.ts), sent
 * Report-Only for now: its final response headers beside next.config.ts's
 * site-wide `frame-ancestors 'none'`, the nonce on the page's scripts, and no
 * violation while the page loads Stripe.js (the e2e stub, served from
 * https://js.stripe.com as the real one is) and mounts its form. Other pages
 * don't get the policy. The real Stripe form's own needs (its frames, 3DS,
 * wallets) are only exercised against Stripe's sandbox, not here.
 */

const ORDER_ID = `ord_${"c5b0".repeat(8)}`;
const SECRET = "cs_test_e2e_secret_csp";
const SITE_WIDE_CSP = "frame-ancestors 'none'";
const STUB_FRAME = 'iframe[title="Secure payment form (e2e stub)"]';

function openPayment() {
  const start = Date.now() + 7 * 86_400_000;
  return {
    status: "open",
    clientSecret: SECRET,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    eventTitle: "Neon Static",
    eventSlug: "neon-static",
    eventStartsAt: new Date(start).toISOString(),
    eventEndsAt: new Date(start + 4 * 3600_000).toISOString(),
    venueName: "The Tote",
    suburb: "Collingwood",
    seated: false,
    lines: [{ ticketTypeName: "General admission", quantity: 1, unitTotalCents: 3170, lineTotalCents: 3170, buyerPaysFee: true }],
    subtotalCents: 3000,
    buyerFeeCents: 170,
    totalCents: 3170,
  };
}

async function mockApi(page: Page) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/orders/by-session/${ORDER_ID}/payment`) return route.fulfill({ json: openPayment() });
    if (url.pathname === `/api/orders/by-session/${ORDER_ID}`) return route.fulfill({ json: { status: "pending" } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

interface Violation {
  directive: string;
  blocked: string;
  disposition: string;
  sample: string;
}

/** Every CSP violation the page reports: its securitypolicyviolation events, and the browser's own log lines. */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const list: Violation[] = [];
    (window as unknown as { __cspViolations: Violation[] }).__cspViolations = list;
    document.addEventListener(
      "securitypolicyviolation",
      (event) => {
        list.push({
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
          disposition: event.disposition,
          sample: event.sample,
        });
      },
      true,
    );
  });
  const logged: string[] = [];
  // The browser logs a violation itself (not through console.*): read Chromium's log directly.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Log.enable");
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (/Content Security Policy/i.test(entry.text) && /refused|violat/i.test(entry.text)) logged.push(entry.text);
  });
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy/i.test(text) && /refused|violat/i.test(text)) logged.push(text);
  });
  return {
    logged,
    events: () =>
      page.evaluate(() => (window as unknown as { __cspViolations?: Violation[] }).__cspViolations ?? []),
  };
}

test.describe("/checkout/pay Content Security Policy (Report-Only)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("final headers: next.config's frame-ancestors policy, plus the page's own Report-Only one with a fresh nonce", async ({ page }) => {
    await stubStripeJs(page);
    await mockApi(page);
    const response = await page.goto(`/checkout/pay?order=${ORDER_ID}`);
    const headers = response?.headers() ?? {};
    // Enforced, as on every page.
    expect(headers["content-security-policy"]).toBe(SITE_WIDE_CSP);
    expect(headers["x-frame-options"]).toBe("DENY");
    // Reported only, for now.
    const policy = headers["content-security-policy-report-only"] ?? "";
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
    expect(nonce).toBeTruthy();
    for (const part of [
      "default-src 'self'",
      "'strict-dynamic'",
      "https://js.stripe.com",
      "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(policy).toContain(part);
    }
    expect(policy).toMatch(/script-src [^;]*'sha256-[A-Za-z0-9+/=]+'/);

    // Next put this request's nonce on its scripts (the page renders per request).
    const html = (await response?.text()) ?? "";
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    const external = scripts.filter((tag) => /\ssrc=/.test(tag));
    expect(external.length).toBeGreaterThan(0);
    for (const tag of external) expect(tag).toContain(`nonce="${nonce}"`);

    // A new request, a new nonce.
    const again = await page.request.get(`/checkout/pay?order=${ORDER_ID}`);
    const nextPolicy = again.headers()["content-security-policy-report-only"] ?? "";
    expect(nextPolicy).toContain("'nonce-");
    expect(nextPolicy).not.toContain(`'nonce-${nonce}'`);
  });

  test("no violation while the page loads Stripe.js and mounts its form", async ({ page }) => {
    const violations = await watchViolations(page);
    const stripe = await stubStripeJs(page);
    await mockApi(page);
    await page.goto(`/checkout/pay?order=${ORDER_ID}`);
    await expect(page.locator(STUB_FRAME)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Payment form ready")).toBeAttached();
    expect((await stripe.seen()).secrets).toEqual([SECRET]);
    expect(stripe.requests.length).toBeGreaterThanOrEqual(1);
    // Let any late report arrive.
    await page.waitForTimeout(500);
    expect(await violations.events()).toEqual([]);
    expect(violations.logged).toEqual([]);
  });

  test("from the return page, Return to payment loads the page with its policy, and no violation", async ({ page }) => {
    const violations = await watchViolations(page);
    const stripe = await stubStripeJs(page);
    await mockApi(page);
    await page.goto(`/checkout/success?session_id=${ORDER_ID}`);
    const again = page.getByRole("link", { name: "Return to payment" });
    await expect(again).toBeVisible({ timeout: 30_000 });
    const [payDocument] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().resourceType() === "document" && new URL(response.url()).pathname === "/checkout/pay",
      ),
      again.click(),
    ]);
    expect(payDocument.headers()["content-security-policy-report-only"]).toContain("'strict-dynamic'");
    await expect(page.locator(STUB_FRAME)).toBeVisible({ timeout: 30_000 });
    expect((await stripe.seen()).secrets).toEqual([SECRET]);
    await page.waitForTimeout(500);
    expect(await violations.events()).toEqual([]);
    expect(violations.logged).toEqual([]);
  });
});

test.describe("other pages don't get the payment page's policy", () => {
  for (const path of ["/", "/events/neon-static", `/checkout/success?session_id=${ORDER_ID}`, "/checkout/confirm"]) {
    test(`${path}: only the site-wide frame-ancestors policy`, async ({ page }) => {
      await mockApi(page);
      const response = await page.request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      expect(headers["content-security-policy-report-only"]).toBeUndefined();
      if (response.status() < 300) expect(headers["content-security-policy"]).toBe(SITE_WIDE_CSP);
    });
  }
});
