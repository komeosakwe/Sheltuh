import { expect, test, type Page } from "@playwright/test";

/**
 * The organiser area's frame and nav in a real browser (Latte's dashboard frames, organiser-dashboard
 * plan OD-2): the black sidebar from 1024px, the 64px rail below it with » opening the sidebar as a
 * drawer that keeps focus inside, closes on Escape and gives focus back to ». Live mode, signed in
 * with a stored test session, every /api/* request answered here.
 */

const DAY = 86_400_000;

async function signedInOrganiser(page: Page) {
  const now = Date.now();
  const session = {
    access_token: "e2e.token.x",
    token_type: "bearer",
    expires_in: 31_536_000,
    expires_at: Math.floor(now / 1000) + 31_536_000,
    refresh_token: "r",
    user: {
      id: "u1",
      aud: "authenticated",
      role: "authenticated",
      email: "hello@hereandnow.example",
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
  // The storage key supabase-js derives from the placeholder URL (http://127.0.0.1:…/supabase-mock).
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/organisers/me") {
      return route.fulfill({
        json: {
          ownerUserId: "u1",
          organiserId: "org-demo",
          displayName: "Here & Now Collective",
          contactEmail: "hello@hereandnow.example",
          description: "Warehouse nights.",
          categories: ["live-music"],
          status: "approved",
          createdAt: new Date(now - 200 * DAY).toISOString(),
          updatedAt: new Date(now - 2 * DAY).toISOString(),
          payoutsEnabled: true,
        },
      });
    }
    if (path === "/api/organisers/me/events") return route.fulfill({ json: { items: [] } });
    if (path === "/api/organisers/me/overview") {
      return route.fulfill({
        json: {
          thisWeek: { range: { from: "2026-11-18", to: "2026-11-24" }, ticketsSold: 0, views: 0, viewsUnreliable: false, viewsComplete: true, newFollowers: 0 },
          highlight: null,
          upcoming: [],
          draftsCount: 0,
          performance: [],
        },
      });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test.describe("desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 1024 } });

  test("the black sidebar beside the page: their name, the places with Events current, Log out; no rail", async ({ page }) => {
    await signedInOrganiser(page);
    await page.goto("/dashboard/events");
    const sidebar = page.getByRole("complementary", { name: "Organiser account" });
    await expect(sidebar).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-organiser-rail]")).toBeHidden();

    // Latte's geometry: the panel 32px under the 100px header, 64px in; the sidebar 264px wide.
    const box = await sidebar.boundingBox();
    expect(box).toMatchObject({ x: 64, y: 132, width: 264 });
    await expect(sidebar.getByText("Here & Now Collective")).toBeVisible();
    await expect(sidebar.getByText("Organiser", { exact: true })).toBeVisible();

    const nav = sidebar.getByRole("navigation", { name: "Organiser" });
    await expect(nav.getByRole("link")).toHaveText(["Overview", "Events", "Analytics", "Payouts", "Profile"]);
    await expect(nav.getByRole("link", { name: "Events" })).toHaveAttribute("aria-current", "page");
    for (const link of await nav.getByRole("link").all()) {
      expect((await link.boundingBox())?.height).toBe(48);
    }
    // White on the organiser's sidebar (the customer's is orange).
    const logOut = sidebar.getByRole("button", { name: "Log out" });
    expect(await logOut.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
    await noSidewaysScroll(page);
  });

  test("the nav goes between the pages, marking each; a page inside a place marks it with aria-current=true", async ({ page }) => {
    test.slow();
    await signedInOrganiser(page);
    await page.goto("/dashboard");
    const nav = page.getByRole("complementary", { name: "Organiser account" }).getByRole("navigation", { name: "Organiser" });
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await nav.getByRole("link", { name: "Payouts" }).click();
    await expect(page).toHaveURL(/\/dashboard\/payouts$/, { timeout: 30_000 });
    await expect(nav.getByRole("link", { name: "Payouts" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Events" })).not.toHaveAttribute("aria-current");
    await page.goto("/dashboard/new");
    await expect(nav.getByRole("link", { name: "Events" })).toHaveAttribute("aria-current", "true", { timeout: 30_000 });
  });
});

for (const vp of [
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test.describe(`${vp.width}`, () => {
    test.use({ viewport: vp });

    test("the 64px rail: each place an icon over its visible label, at least 56px, Events current; no sidebar", async ({ page }) => {
      await signedInOrganiser(page);
      await page.goto("/dashboard/events");
      const rail = page.locator("[data-organiser-rail]");
      await expect(rail).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("[data-organiser-sidebar]")).toBeHidden();
      expect((await rail.boundingBox())?.width).toBe(64);
      // Tablet: the panel 32px in at the sides (the organiser frames), rounded; phone: full-bleed.
      const shell = await page.locator("[data-organiser-shell]").boundingBox();
      expect(shell?.x).toBe(vp.width === 768 ? 32 : 0);

      const nav = rail.getByRole("navigation", { name: "Organiser" });
      await expect(nav.getByRole("link")).toHaveCount(5);
      for (const name of ["Overview", "Events", "Analytics", "Payouts", "Profile"]) {
        const link = nav.getByRole("link", { name, exact: true });
        await expect(link).toBeVisible();
        // The label is on screen, inside the rail.
        await expect(link.getByText(name, { exact: true })).toBeVisible();
        const box = await link.boundingBox();
        expect(box?.width).toBe(56);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
        const label = await link.getByText(name, { exact: true }).boundingBox();
        expect((label?.x ?? 0) + (label?.width ?? 0)).toBeLessThanOrEqual((box?.x ?? 0) + (box?.width ?? 0));
      }
      await expect(nav.getByRole("link", { name: "Events" })).toHaveAttribute("aria-current", "page");
      await expect(rail.getByRole("button", { name: "Log out" })).toBeVisible();
      await noSidewaysScroll(page);
    });

    test("» opens the sidebar as a drawer that keeps focus inside, closes on Escape and gives focus back", async ({ page }) => {
      await signedInOrganiser(page);
      await page.goto("/dashboard/payouts");
      const expand = page.getByRole("button", { name: "Show organiser menu" });
      await expect(expand).toBeVisible({ timeout: 30_000 });
      await expand.click();

      const drawer = page.getByRole("dialog", { name: "Organiser menu" });
      await expect(drawer).toBeVisible();
      // Measured once its slide-in has finished.
      await drawer.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
      const box = await drawer.boundingBox();
      expect([box?.x, box?.y, Math.round(box?.width ?? 0), Math.round(box?.height ?? 0)]).toEqual([0, 0, 264, vp.height]);
      await expect(drawer.getByRole("button", { name: "Hide organiser menu" })).toBeFocused();
      await expect(drawer.getByRole("link", { name: "Payouts" })).toHaveAttribute("aria-current", "page");

      // Tab goes round inside it: « , the five places, Log out, and back to «.
      const seen: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press("Tab");
        seen.push(
          await page.evaluate(() => {
            const active = document.activeElement;
            const inside = Boolean(active?.closest("[data-organiser-drawer]"));
            return `${inside ? "" : "OUTSIDE "}${active?.getAttribute("aria-label") ?? active?.textContent ?? ""}`;
          }),
        );
      }
      expect(seen).toEqual(["Overview", "Events", "Analytics", "Payouts", "Profile", "→Log out", "Hide organiser menu", "Overview"]);
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(drawer.getByRole("button", { name: "Log out" })).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(expand).toBeFocused();
    });

    test("« and choosing a place close the drawer", async ({ page }) => {
      await signedInOrganiser(page);
      await page.goto("/dashboard");
      const expand = page.getByRole("button", { name: "Show organiser menu" });
      await expect(expand).toBeVisible({ timeout: 30_000 });
      await expand.click();
      const drawer = page.getByRole("dialog", { name: "Organiser menu" });
      await drawer.getByRole("button", { name: "Hide organiser menu" }).click();
      await expect(drawer).toBeHidden();

      await expand.click();
      await drawer.getByRole("link", { name: "Profile" }).click();
      await expect(drawer).toBeHidden();
      await expect(page).toHaveURL(/\/dashboard\/profile$/, { timeout: 30_000 });
      // Focus goes to the new page's heading, not back to the rail.
      await expect(page.locator("[data-organiser-main] h1")).toBeFocused({ timeout: 30_000 });
      await expect(
        page.locator("[data-organiser-rail]").getByRole("link", { name: "Profile" }),
      ).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
    });
  });
}

for (const vp of [
  { width: 768, height: 1024 },
  { width: 1440, height: 1024 },
]) {
  test(`${vp.width}: inside the frame the page's own container gives up its gutters (the frame spaces it)`, async ({ page }) => {
    await page.setViewportSize(vp);
    await signedInOrganiser(page);
    await page.goto("/dashboard/payouts");
    const container = page.locator("[data-organiser-main] > [data-page]");
    await expect(container).toBeVisible({ timeout: 30_000 });
    const style = await container.evaluate((el) => {
      const css = getComputedStyle(el);
      return [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft, css.maxWidth, css.marginLeft];
    });
    expect(style).toEqual(["0px", "0px", "0px", "0px", "none", "0px"]);
    // The page starts where the frame's column does (24px in on a tablet, 48 on a desktop).
    const main = await page.locator("[data-organiser-main]").boundingBox();
    const box = await container.boundingBox();
    expect((box?.x ?? 0) - (main?.x ?? 0)).toBe(vp.width === 768 ? 24 : 48);
  });
}

test("the skip link goes past the sidebar, to the page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await signedInOrganiser(page);
  await page.goto("/dashboard/payouts");
  await expect(page.locator("[data-organiser-sidebar]")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-organiser-main]")).toBeFocused();
  // The next Tab is in the page, not the sidebar.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-organiser-main]")))).toBe(true);
});

test("320px: the rail and the page fit with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await signedInOrganiser(page);
  await page.goto("/dashboard/events");
  await expect(page.locator("[data-organiser-rail]")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Create your first event" })).toBeVisible({ timeout: 30_000 });
  await noSidewaysScroll(page);
  const main = await page.locator("[data-organiser-main]").boundingBox();
  expect((main?.x ?? 0) + (main?.width ?? 0)).toBeLessThanOrEqual(320);
});
