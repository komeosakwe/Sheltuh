import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * Continue with Apple / Continue with Google, end to end in the browser, against the live
 * dev server (playwright.config.ts turns NEXT_PUBLIC_AUTH_PROVIDERS on for
 * it). Supabase Auth is the placeholder at /supabase-mock: its /authorize
 * (where the real one sends the browser on to the provider) is answered
 * here with the redirect back to /auth/callback the provider and Supabase
 * would end in, and its PKCE token exchange with a session. Every /api/*
 * request is answered here too, so nothing leaves the machine.
 *
 * Apple's official logo files aren't committed (docs/auth-logos.md), so
 * /auth/apple-logo-*.svg is answered with a plain test square. Google's G
 * is committed: the dev server serves the real one.
 */

const SUPABASE = "/supabase-mock/auth/v1";
const CODE = "6b1f9c1e-0e1a-4c43-9d3b-e2e0000c0de0";
const HOSTILE = "Your account is locked. Call +61 400 000 000 or visit evil.example to unlock it";

function sessionFor(email: string, provider: "google" | "apple") {
  const now = Date.now();
  return {
    access_token: `e2e.${provider}.token`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(now / 1000) + 3600,
    refresh_token: "e2e-refresh",
    user: {
      id: `u-${provider}`,
      aud: "authenticated",
      role: "authenticated",
      email,
      email_confirmed_at: new Date(now).toISOString(),
      app_metadata: { provider, providers: [provider] },
      user_metadata: {},
      identities: [],
      created_at: new Date(now).toISOString(),
    },
  };
}

interface Flow {
  /** The /authorize requests the buttons made. */
  authorize: URL[];
  /** The bodies of the PKCE token exchanges. */
  exchanges: { auth_code?: unknown; code_verifier?: unknown }[];
}

/**
 * Answers Supabase Auth and the API. `back` turns the /authorize URL into
 * where the browser comes back to (by default: its redirect_to, plus the code).
 */
async function mockAuth(
  page: Page,
  { email = "mia@example.com", back }: { email?: string; back?: (redirectTo: string) => string } = {},
): Promise<Flow> {
  const flow: Flow = { authorize: [], exchanges: [] };
  await page.route("**/auth/apple-logo-*.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="gray"/></svg>',
    }),
  );
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route(
    (url) => url.pathname.endsWith(`${SUPABASE}/authorize`),
    (route) => {
      const url = new URL(route.request().url());
      flow.authorize.push(url);
      const redirectTo = url.searchParams.get("redirect_to") ?? "";
      const location = back ? back(redirectTo) : `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}code=${CODE}`;
      return route.fulfill({ status: 302, headers: { location } });
    },
  );
  await page.route(
    (url) => url.pathname.endsWith(`${SUPABASE}/token`) && url.searchParams.get("grant_type") === "pkce",
    (route) => {
      const body = route.request().postDataJSON() as Flow["exchanges"][number];
      flow.exchanges.push(body);
      const provider = flow.authorize.at(-1)?.searchParams.get("provider") === "apple" ? "apple" : "google";
      return route.fulfill({ json: sessionFor(email, provider) });
    },
  );
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [], eventIds: [] } });
    return route.fulfill({ status: 404, json: { error: "Not found." } });
  });
  return flow;
}

/** This site's origin (the page's): where redirect_to must point. */
const origin = (page: Page) => new URL(page.url()).origin;

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const appleButton = (page: Page) => page.getByRole("button", { name: "Continue with Apple" });
const googleButton = (page: Page) => page.getByRole("button", { name: "Continue with Google" });

/** Google's G inside the button. */
const googleLogo = (page: Page) => googleButton(page).locator("img");

/** Whether that image has loaded (a broken one has no natural width). */
const googleImageLoaded = (page: Page) =>
  googleLogo(page).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

test("Continue with Google: PKCE out to the provider and back, signed in on /account", async ({ page }) => {
  const flow = await mockAuth(page);
  await page.goto("/login?next=/account");
  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });

  await googleButton(page).click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 30_000 });
  await expect(page.getByText("mia@example.com")).toBeVisible();
  await expect(page.getByText("Sign-in methods: Google")).toBeVisible();

  expect(flow.authorize).toHaveLength(1);
  const authorize = flow.authorize[0];
  expect(authorize.searchParams.get("provider")).toBe("google");
  expect(authorize.searchParams.get("code_challenge_method")).toBe("s256");
  expect(authorize.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
  // A shared device: Google asks which account rather than reusing the last one.
  expect(authorize.searchParams.get("prompt")).toBe("select_account");
  expect(authorize.searchParams.get("redirect_to")).toBe(`${origin(page)}/auth/callback?next=%2Faccount`);

  expect(flow.exchanges).toHaveLength(1);
  expect(flow.exchanges[0].auth_code).toBe(CODE);
  expect(typeof flow.exchanges[0].code_verifier).toBe("string");
  expect(String(flow.exchanges[0].code_verifier).length).toBeGreaterThan(40);
});

test("Continue with Apple keeps a next with a fragment (/events/x#whos-going) through the round trip", async ({ page }) => {
  const flow = await mockAuth(page);
  await page.goto(`/login?next=${encodeURIComponent("/events/x#whos-going")}`);
  await expect(appleButton(page)).toBeVisible({ timeout: 60_000 });

  await appleButton(page).click();
  await expect(page).toHaveURL(/\/events\/x#whos-going$/, { timeout: 30_000 });

  const authorize = flow.authorize[0];
  expect(authorize.searchParams.get("provider")).toBe("apple");
  expect(authorize.searchParams.get("prompt")).toBeNull();
  expect(authorize.searchParams.get("redirect_to")).toBe(`${origin(page)}/auth/callback?next=%2Fevents%2Fx%23whos-going`);
  expect(flow.exchanges).toHaveLength(1);
});

test("cancelling at the provider shows our own words, never the URL's description, and Back to sign in keeps next", async ({ page }) => {
  const description = encodeURIComponent(HOSTILE);
  const flow = await mockAuth(page, {
    back: (redirectTo) =>
      `${redirectTo}&error=access_denied&error_description=${description}#error=access_denied&error_description=${description}`,
  });
  const exchanges: Request[] = [];
  page.on("request", (request) => {
    if (request.url().includes(`${SUPABASE}/token`)) exchanges.push(request);
  });
  await page.goto("/login?next=/account");
  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
  await googleButton(page).click();

  const heading = page.getByRole("heading", { level: 1, name: "Sign-in cancelled" });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  await expect(heading).toBeFocused();
  await expect(page.getByText("Nothing has changed. Try again, or sign in with your email.")).toBeVisible();
  await expect(page.getByText(/evil\.example|account is locked/)).toHaveCount(0);
  // The error (and anything else) is gone from the address bar.
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login?next=%2Faccount");
  await expect(page.getByRole("link", { name: "Use email instead" })).toHaveAttribute("href", "/login?next=%2Faccount#email-sign-in");
  expect(flow.exchanges).toHaveLength(0);
  expect(exchanges).toHaveLength(0);
});

test("an unsafe next never leaves the site: dropped on the way out, and refused again on the way back", async ({ page }) => {
  // Dropped before the redirect: no next at all in redirect_to.
  const flow = await mockAuth(page);
  await page.goto(`/login?next=${encodeURIComponent("//evil.example/phish")}`);
  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
  await googleButton(page).click();
  await expect(page).toHaveURL(/\/events$/, { timeout: 30_000 });
  expect(flow.authorize[0].searchParams.get("redirect_to")).toBe(`${origin(page)}/auth/callback`);
});

test("a callback URL whose next was tampered with lands on /events, not the other site", async ({ page, baseURL }) => {
  await mockAuth(page, {
    back: (redirectTo) => `${new URL(redirectTo).origin}/auth/callback?next=${encodeURIComponent("https://evil.example/")}&code=${CODE}`,
  });
  await page.goto("/login");
  await expect(appleButton(page)).toBeVisible({ timeout: 60_000 });
  await appleButton(page).click();
  await expect(page).toHaveURL(/\/events$/, { timeout: 30_000 });
  expect(origin(page)).toBe(new URL(baseURL ?? "").origin);
});

test.describe("at 375×667", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  for (const path of ["/login", "/signup"]) {
    test(`${path}: Apple full width, then Google's 40px pill centred under it, above the fold, no sideways scroll`, async ({ page }) => {
      await mockAuth(page);
      await page.goto(path);
      await expect(appleButton(page)).toBeVisible({ timeout: 60_000 });
      const apple = await appleButton(page).boundingBox();
      const google = await googleButton(page).boundingBox();
      if (!apple || !google) throw new Error("buttons not laid out");
      expect(apple.width).toBe(335);
      expect(apple.height).toBe(48);
      // A 40px pill sized to its content, not stretched, centred under Apple's.
      expect(google.width).toBeLessThan(335);
      expect(google.height).toBe(40);
      expect(Math.abs(google.x + google.width / 2 - (apple.x + apple.width / 2))).toBeLessThanOrEqual(0.5);
      expect(google.y).toBeGreaterThan(apple.y + apple.height);
      expect(google.y + google.height).toBeLessThanOrEqual(667);
      // The real image loaded, not a broken one.
      await expect.poll(() => googleImageLoaded(page)).toBe(true);
      // Its hit area reaches 4px above and below the button: 48px tall (and no further: 6px out is page).
      expect(await googleButton(page).evaluate((button) => getComputedStyle(button, "::before").height)).toBe("48px");
      const hits = await googleButton(page).evaluate((button, box) => {
        const x = box.x + box.width / 2;
        return [box.y - 3, box.y + box.height + 3, box.y - 6, box.y + box.height + 6].map((y) =>
          button.contains(document.elementFromPoint(x, y)),
        );
      }, google);
      expect(hits).toEqual([true, true, false, false]);
      // The divider (the header's search panel has an "or" of its own).
      await expect(page.locator("#main").getByText("or", { exact: true })).toBeVisible();
      await noSidewaysScroll(page);
    });
  }

  test("/login#email-sign-in (the callback's Use email instead): the email form, label and all, is in view below the sticky header", async ({ page }) => {
    await mockAuth(page);
    await page.goto("/login#email-sign-in");
    const form = page.locator("#email-sign-in");
    await expect(form.getByLabel("Email")).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
      const header = await page.getByRole("banner").boundingBox();
      const label = await form.locator('label[for="email"]').boundingBox();
      if (!header || !label) throw new Error("not laid out");
      expect(label.y).toBeGreaterThanOrEqual(header.y + header.height);
      expect(label.y + label.height).toBeLessThanOrEqual(667);
    }).toPass({ timeout: 10_000 });
  });

  test("the pair follows the theme: black Apple and Google's Light pill on White, white Apple and Google's Dark pill on Dark", async ({ page }) => {
    await mockAuth(page);
    const fill = async () =>
      appleButton(page).evaluate((el) => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, color: style.color };
      });
    const googleStyle = () =>
      googleButton(page).evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          background: style.backgroundColor,
          color: style.color,
          border: style.borderTopColor,
          borderWidth: style.borderTopWidth,
          radius: style.borderTopLeftRadius,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          fontWeight: style.fontWeight,
        };
      });
    await page.goto("/login");
    await expect(appleButton(page)).toBeVisible({ timeout: 60_000 });
    expect(await fill()).toEqual({ background: "rgb(0, 0, 0)", color: "rgb(255, 255, 255)" });
    expect(await googleStyle()).toEqual({
      background: "rgb(255, 255, 255)",
      color: "rgb(31, 31, 31)",
      border: "rgb(116, 119, 117)",
      borderWidth: "1px",
      radius: "20px",
      fontSize: "14px",
      lineHeight: "20px",
      fontWeight: "500",
    });
    await expect(appleButton(page).locator('img[src="/auth/apple-logo-white.svg"]')).toBeVisible();
    await expect(appleButton(page).locator('img[src="/auth/apple-logo-black.svg"]')).toBeHidden();

    await page.evaluate(() => localStorage.setItem("sheltuh:theme", "dark"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(appleButton(page)).toBeVisible({ timeout: 60_000 });
    expect(await fill()).toEqual({ background: "rgb(255, 255, 255)", color: "rgb(0, 0, 0)" });
    expect(await googleStyle()).toMatchObject({
      background: "rgb(19, 19, 20)",
      color: "rgb(227, 227, 227)",
      border: "rgb(142, 145, 143)",
    });
    await expect(appleButton(page).locator('img[src="/auth/apple-logo-black.svg"]')).toBeVisible();
    await expect(appleButton(page).locator('img[src="/auth/apple-logo-white.svg"]')).toBeHidden();
    await expect.poll(() => googleImageLoaded(page)).toBe(true);
  });
});
