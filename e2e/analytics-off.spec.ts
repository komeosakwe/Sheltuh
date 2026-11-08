import { expect, test, type Page } from "@playwright/test";

/**
 * Usage analytics (PostHog, lib/analytics.ts) is off unless
 * NEXT_PUBLIC_POSTHOG_KEY is set, and the e2e servers don't set it: no request
 * may go to the /ingest proxy (which doesn't exist without a key), to PostHog
 * itself or to Vercel's analytics, whatever the page, and the proxy answers 404.
 * The same check runs against the demo build in demo.spec.ts.
 */

function analyticsRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/ingest") || /posthog/i.test(url.hostname) || url.pathname.startsWith("/_vercel/")) urls.push(request.url());
  });
  return urls;
}

test("with no key, browsing sends nothing to /ingest, PostHog or Vercel analytics", async ({ page }) => {
  const sent = analyticsRequests(page);
  // The app's own API is never reached in e2e: an empty answer is enough for the pages to settle.
  await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  for (const path of ["/", "/about", "/search?q=jazz&near=Fitzroy", "/privacy"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
  }
  await page.waitForLoadState("networkidle");
  expect(sent).toEqual([]);
  // Nothing was stored for it either.
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("ph_")));
  expect(stored).toEqual([]);
});

test("the /ingest proxy doesn't exist without a key", async ({ request }) => {
  const response = await request.post("/ingest/e/", { data: {}, failOnStatusCode: false });
  expect(response.status()).toBe(404);
});

test("the privacy policy says what is measured", async ({ page }) => {
  await page.goto("/privacy#analytics");
  await expect(page.getByRole("heading", { name: "Usage analytics" })).toBeVisible();
});
