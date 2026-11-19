import { expect, test, type Page } from "@playwright/test";

/**
 * Cloudflare Turnstile (lib/auth/turnstile.ts) is off unless
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, as it is on this suite's dev server
 * (playwright.config.ts) and in production until the owner adds the key
 * (docs/DEPLOYMENT.md, "Human check"). Off means exactly today's forms: no
 * request to challenges.cloudflare.com, no widget or Cloudflare line, and no
 * CAPTCHA token in the Supabase Auth requests. The pages also carry only the
 * site-wide frame-ancestors policy, so when the key is set nothing blocks
 * Cloudflare's script or iframe there. The widget itself (key set) is
 * covered by tests/HumanCheck.test.tsx and tests/AuthContextCaptcha.test.tsx.
 */

const SUPABASE = "/supabase-mock/auth/v1";
const SITE_WIDE_CSP = "frame-ancestors 'none'";

interface Seen {
  cloudflare: string[];
  auth: { path: string; body: Record<string, unknown> }[];
}

async function watch(page: Page): Promise<Seen> {
  const seen: Seen = { cloudflare: [], auth: [] };
  // Recorded and refused: nothing leaves the machine.
  await page.route("https://challenges.cloudflare.com/**", (route) => {
    seen.cloudflare.push(route.request().url());
    return route.abort();
  });
  await page.route("**/supabase-mock/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      seen.auth.push({ path: url.pathname + url.search, body: (request.postDataJSON() ?? {}) as Record<string, unknown> });
    }
    if (url.pathname.endsWith(`${SUPABASE}/signup`)) {
      return route.fulfill({ json: { id: "u-new", aud: "authenticated", email: "mia@example.com", confirmation_sent_at: new Date().toISOString() } });
    }
    return route.fulfill({ status: 200, json: {} });
  });
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "Not found." } }));
  return seen;
}

for (const path of ["/login", "/signup", "/forgot-password", "/verify?email=mia%40example.com"]) {
  test(`${path}: no Turnstile without a site key, and only the site-wide frame-ancestors policy`, async ({ page }) => {
    const seen = await watch(page);
    const response = await page.goto(path);
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toBe(SITE_WIDE_CSP);
    expect(headers["content-security-policy-report-only"]).toBeUndefined();

    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible({ timeout: 60_000 });
    // Let anything lazy have its chance.
    await page.waitForTimeout(500);
    expect(seen.cloudflare).toEqual([]);
    await expect(page.getByRole("group", { name: /human check/i })).toHaveCount(0);
    await expect(page.getByText(/Cloudflare/)).toHaveCount(0);
    expect(await page.evaluate(() => "turnstile" in window)).toBe(false);
  });
}

test("sign-up without a site key: Supabase gets no CAPTCHA token, and /verify gets the email without keeping it in the URL", async ({ page }) => {
  const seen = await watch(page);
  await page.goto("/signup");
  await page.getByRole("textbox", { name: "Email" }).fill("mia@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Hunter22x!");
  await page.getByRole("button", { name: "Sign up" }).click();
  // /verify reads ?email= into its field, then takes it out of the address bar.
  await expect(page).toHaveURL(/\/verify$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("mia@example.com");
  const signup = seen.auth.find((call) => call.path.startsWith(`${SUPABASE}/signup`));
  expect(signup?.body).toMatchObject({ email: "mia@example.com" });
  expect((signup?.body.gotrue_meta_security as Record<string, unknown> | undefined)?.captcha_token).toBeUndefined();
  expect(seen.cloudflare).toEqual([]);
});
