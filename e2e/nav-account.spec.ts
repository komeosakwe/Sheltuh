import { expect, test, type Page } from "@playwright/test";

/**
 * The phone drawer and the desktop avatar menu (docs/design/navigation-search.md §5.2, §5.3;
 * increments 1 and 2) in a real Chromium: the drawer's places, buttons and rows at 390 and 320,
 * and the avatar menu's keyboard, place and colours from 1024. Live mode with a stored test
 * session (the Supabase URL is a local placeholder) and every /api/* request answered here.
 */

const DAY = 86_400_000;
/** Names with their counts (the sr-only parts may be read with a space before the comma). */
const SAVED = /^Saved\s*, 12 saved$/;
const MESSAGES = /^Messages\s*, 3 unread$/;
const now = Date.now();

async function as(page: Page, who: "signed-out" | "member", theme: "light" | "dark" = "light") {
  if (theme === "dark") await page.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
  if (who === "member") {
    const session = {
      access_token: "e2e.token.x",
      token_type: "bearer",
      expires_in: 31_536_000,
      expires_at: Math.floor(now / 1000) + 31_536_000,
      refresh_token: "r",
      user: {
        id: "u-latte",
        aud: "authenticated",
        role: "authenticated",
        email: "latte@sheltuh.example",
        email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
        app_metadata: { provider: "email" },
        user_metadata: {},
        created_at: new Date(now - 300 * DAY).toISOString(),
      },
    };
    await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  }
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/events") return route.fulfill({ json: { items: [], nextCursor: undefined } });
    if (path === "/api/events/trending") return route.fulfill({ json: { items: [] } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 3 } });
    if (path === "/api/profiles/me") {
      return route.fulfill({
        json: {
          displayName: "Latte",
          suspended: false,
          createdAt: new Date(now - DAY).toISOString(),
          updatedAt: new Date(now - DAY).toISOString(),
          profileId: "p-latte",
          profileVisible: true,
        },
      });
    }
    if (path === "/api/organisers/me") return route.fulfill({ status: 404, json: { error: "No organiser." } });
    if (path === "/api/favourites/ids") {
      return route.fulfill({ json: { eventIds: Array.from({ length: 12 }, (_, i) => `evt-${i}`) } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

async function openDrawer(page: Page) {
  const drawer = page.locator("#site-menu");
  await expect(async () => {
    if (!(await drawer.isVisible())) await page.getByRole("button", { name: /^Menu/ }).click();
    await expect(drawer).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  return drawer;
}

test.describe("phone drawer at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("signed out: 40px bold places on a 72px pitch, 56px in, dots left of the current one; Sign in orange; Escape returns to Menu", async ({ page }) => {
    await as(page, "signed-out");
    await page.goto("/events");
    await expect(page.locator("#site-menu a[href='/login']")).toBeAttached({ timeout: 30_000 });
    const drawer = await openDrawer(page);
    const site = page.getByRole("navigation", { name: "Site menu" });
    // Black under a black 64px bar (the board's), no rule between them; only the wordmark and Close in the bar,
    // Close's icon centred 28px in from the right and the bar's middle.
    expect(await drawer.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).borderTopWidth])).toEqual(["rgb(0, 0, 0)", "0px"]);
    const bar = page.locator("[data-compact-header]");
    expect(Math.round((await bar.boundingBox())?.height ?? 0)).toBe(64);
    expect(Math.round((await drawer.boundingBox())?.y ?? 0)).toBe(64);
    await expect(bar.getByRole("link", { name: "Search" })).toHaveCount(0);
    const closeIcon = await bar.getByRole("button", { name: "Close" }).locator("svg").boundingBox();
    expect(Math.round((closeIcon?.x ?? 0) + (closeIcon?.width ?? 0) / 2)).toBe(390 - 28);
    expect(Math.round((closeIcon?.y ?? 0) + (closeIcon?.height ?? 0) / 2)).toBe(32);
    // The orange wordmark, 19px tall, 16px in.
    const wordmark = await bar.getByRole("link", { name: "Sheltüh home" }).locator("svg").boundingBox();
    expect([Math.round(wordmark?.x ?? 0), Math.round(wordmark?.height ?? 0)]).toEqual([16, 19]);

    const places = ["Discover", "Nearby", "Community"].map((name) => site.getByRole("link", { name }));
    const boxes = await Promise.all(places.map((place) => place.boundingBox()));
    for (const [i, place] of places.entries()) {
      expect(await place.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight, getComputedStyle(el).textTransform])).toEqual([
        "40px",
        "700",
        "none",
      ]);
      expect(Math.round(boxes[i]?.height ?? 0)).toBe(72);
      // The label starts 56px from the screen's edge (16 margin + 40).
      expect(await place.evaluate((el) => Math.round(el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft)))).toBe(56);
    }
    expect(Math.round((boxes[1]?.y ?? 0) - (boxes[0]?.y ?? 0))).toBe(72);
    // The first place's line starts 56px under the bar, 120px from the top, as drawn.
    expect(Math.round((boxes[0]?.y ?? 0) + 12)).toBe(120);
    // Discover is the current section on /events: its dots show, 16px in, centred on the word; the others' don't.
    const dots = (i: number) =>
      places[i].evaluate((el) => {
        const before = getComputedStyle(el, "::before");
        return { opacity: before.opacity, left: Math.round(el.getBoundingClientRect().left + parseFloat(before.left)), width: before.width, height: before.height };
      });
    expect(await dots(0)).toEqual({ opacity: "1", left: 16, width: "24px", height: "8px" });
    expect((await dots(1)).opacity).toBe("0");

    const signIn = site.getByRole("link", { name: "Sign in" });
    expect(await signIn.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])).toEqual(["rgb(255, 72, 0)", "rgb(0, 0, 0)"]);
    for (const link of [signIn, site.getByRole("link", { name: "For organisers" })]) {
      expect(Math.round((await link.boundingBox())?.height ?? 0)).toBe(56);
    }

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("button", { name: /^Menu/ })).toBeFocused();
  });

  test("signed in: who's signed in (the cream circle, no photo), then My tickets, Saved and Messages (64px rows, no counts), then For organisers", async ({ page }) => {
    await as(page, "member");
    await page.goto("/events");
    await expect(page.locator("#site-menu a[href='/members/p-latte']")).toBeAttached({ timeout: 30_000 });
    // 3 unread, but the boards draw no count on Menu.
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
    await openDrawer(page);
    const site = page.getByRole("navigation", { name: "Site menu" });
    const identity = site.getByRole("link", { name: "Latte, view profile" });
    await expect(identity).toHaveAttribute("href", "/members/p-latte");
    expect(await identity.locator("[data-avatar-placeholder]").evaluate((el) => [getComputedStyle(el).backgroundColor, el.textContent]))
      .toEqual(["rgb(255, 250, 231)", ""]);
    expect(await identity.getByText("Latte").evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight])).toEqual(["20px", "600"]);
    for (const name of ["My tickets", "Saved", "Messages"]) {
      const row = site.getByRole("link", { name, exact: true });
      expect(Math.round((await row.boundingBox())?.height ?? 0), name).toBe(64);
      expect(await row.evaluate((el) => getComputedStyle(el).fontSize), name).toBe("18px");
    }
    await expect(site.locator("[data-unread-badge], [data-menu-count]")).toHaveCount(0);
    await expect(site.getByRole("link", { name: "Your events" })).toHaveCount(0);
    expect(Math.round((await site.getByRole("link", { name: "For organisers" }).boundingBox())?.height ?? 0)).toBe(56);
    // Tab stays in the bar and the drawer: past For organisers to the logo.
    await site.getByRole("link", { name: "For organisers" }).focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("[data-compact-header]").getByRole("link", { name: "Sheltüh home" })).toBeFocused();
  });
});

test.describe("phone drawer at 320px", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("nothing overflows sideways, signed in, at 200% text too", async ({ page }) => {
    await as(page, "member");
    await page.goto("/events");
    await expect(page.locator("#site-menu a[href='/members/p-latte']")).toBeAttached({ timeout: 30_000 });
    const drawer = await openDrawer(page);
    // The drawer scrolls nothing sideways, and nothing in the bar or the drawer runs past the screen's edge.
    const overflow = () =>
      drawer.evaluate((el) => {
        const width = document.documentElement.clientWidth;
        const scopes = [el, document.querySelector("[data-compact-header]")];
        const rights = scopes.flatMap((scope) => [...(scope?.querySelectorAll("*") ?? [])].map((child) => child.getBoundingClientRect().right));
        return Math.max(el.scrollWidth - el.clientWidth, Math.round(Math.max(...rights) - width));
      });
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%"));
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`avatar menu at 1280px in ${theme === "light" ? "Light" : "Dark"}`, () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test("keyboard: Enter opens it, Tab walks the rows, Escape closes it with focus on the avatar; it takes the page's theme", async ({ page }) => {
      await as(page, "member", theme);
      await page.goto("/events");
      const primary = page.getByRole("navigation", { name: "Primary" });
      const avatar = primary.getByRole("button", { name: "Account" });
      await expect(avatar).toBeVisible({ timeout: 30_000 });
      await avatar.focus();
      await page.keyboard.press("Enter");
      const panel = page.locator("#account-menu");
      await expect(panel).toBeVisible();
      await expect(avatar).toHaveAttribute("aria-expanded", "true");
      const menu = page.getByRole("navigation", { name: "Account" });
      await expect(menu.getByRole("link", { name: SAVED })).toBeVisible({ timeout: 30_000 });
      for (const name of ["Profile", "My tickets", SAVED, MESSAGES, "Settings"]) {
        await page.keyboard.press("Tab");
        await expect(menu.getByRole("link", { name })).toBeFocused();
        expect(Math.round((await menu.getByRole("link", { name }).boundingBox())?.height ?? 0)).toBe(40);
      }
      await page.keyboard.press("Tab");
      const logOut = menu.getByRole("button", { name: "Log out" });
      await expect(logOut).toBeFocused();
      // Log out: #d03e00 in Light (4.8:1 on white, owner 19 Nov 2026), the board's #ff4800 in Dark.
      expect(await logOut.evaluate((el) => getComputedStyle(el).color)).toBe(theme === "light" ? "rgb(208, 62, 0)" : "rgb(255, 72, 0)");
      // As the board's two frames: white with a 1px hairline and no shadow in Light; #1c1b17 with a 1px white stroke in
      // Dark; radius 16.
      expect(
        await panel.evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.backgroundColor, style.borderTopColor, style.borderTopWidth, style.borderTopLeftRadius, style.boxShadow];
        }),
      ).toEqual(
        theme === "light"
          ? ["rgb(255, 255, 255)", "rgb(229, 227, 222)", "1px", "16px", "none"]
          : ["rgb(28, 27, 23)", "rgb(255, 255, 255)", "1px", "16px", "none"],
      );
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(avatar).toBeFocused();
      await expect(avatar).toHaveAttribute("aria-expanded", "false");
    });
  });
}

test.describe("avatar menu at 1280px, scrolled", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("sits 8px under the header (100, then 92 once scrolled), its right edge on the avatar's; Log out goes home", async ({ page }) => {
    await as(page, "member");
    await page.goto("/events");
    const avatar = page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Account" });
    await expect(avatar).toBeVisible({ timeout: 30_000 });
    const panel = page.locator("#account-menu");
    const place = async () => {
      const [p, a, h] = await Promise.all([panel.boundingBox(), avatar.boundingBox(), page.locator("header").first().boundingBox()]);
      return { top: Math.round((p?.y ?? 0) - ((h?.y ?? 0) + (h?.height ?? 0))), right: Math.round((p?.x ?? 0) + (p?.width ?? 0) - ((a?.x ?? 0) + (a?.width ?? 0))), width: Math.round(p?.width ?? 0) };
    };
    await avatar.click();
    await expect(panel).toBeVisible();
    expect(await place()).toEqual({ top: 8, right: 0, width: 280 });
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.querySelector("main")?.style.setProperty("min-height", "300vh"));
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(async () => Math.round((await page.locator("header").first().boundingBox())?.height ?? 0)).toBe(92);
    await avatar.click();
    await expect(panel).toBeVisible();
    await expect.poll(place).toEqual({ top: 8, right: 0, width: 280 });
    await page.getByRole("navigation", { name: "Account" }).getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  });
});
