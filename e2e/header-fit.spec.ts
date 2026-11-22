import { expect, test, type Page } from "@playwright/test";
import type { AdminSummary } from "@/lib/api/types";

/**
 * The desktop header (redesign PR 2, the proposal and the rules' Navigation
 * board; black in both themes, an ink section like the footer, the owner's call of 22 Nov 2026) is one 100px row, as the
 * board draws it (navigation-search.md §5.16), at every desktop width, in Light and Dark (its rule drawn
 * inside it), whoever is signed in: signed out, Sign in and the For
 * organisers button; signed in, For organisers, the Messages chip with its count
 * and the avatar (plus Admin and its badge for admins), with no sideways scroll
 * and no search field. Live mode, with a stored test session (the Supabase URL
 * is a local placeholder) and every /api/* request answered here.
 */

const DAY = 86_400_000;
const now = Date.now();

const SUMMARY: AdminSummary = {
  reportsOpen: { count: 2, oldestAt: new Date(now - 3 * DAY).toISOString() },
  eventsPending: { count: 2, soonestStartsAt: new Date(now + DAY).toISOString(), startingSoon: 1, startingSoonHours: 72 },
  organisersPending: { count: 1, oldestAt: new Date(now - DAY).toISOString() },
  emailsFailed: { count: 0 },
  emailsRetrying: { count: 1 },
  doorEvents: { count: 1, windowHours: 24 },
};

type Who = "signed-out" | "member" | "admin";

/** The account link that shows once the header's auth state has settled (with its badge when signed in). */
const READY: Record<Who, RegExp> = {
  "signed-out": /^Sign in$/,
  member: /^Messages\s*, 12 unread$/,
  admin: /^Admin\s*, 5 waiting$/,
};

async function as(page: Page, who: Who) {
  if (who !== "signed-out") {
    const session = {
      access_token: "e2e.token.x",
      token_type: "bearer",
      expires_in: 31_536_000,
      expires_at: Math.floor(now / 1000) + 31_536_000,
      refresh_token: "r",
      user: {
        id: `u-${who}`,
        aud: "authenticated",
        role: "authenticated",
        email: `${who}@sheltuh.example`,
        email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
        app_metadata: who === "admin" ? { provider: "email", role: "admin" } : { provider: "email" },
        user_metadata: {},
        created_at: new Date(now - 300 * DAY).toISOString(),
      },
    };
    await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  }
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/admin/summary") return route.fulfill({ json: SUMMARY });
    if (path === "/api/events") return route.fulfill({ json: { items: [], nextCursor: undefined } });
    if (path === "/api/events/trending") return route.fulfill({ json: { items: [] } });
    // A two-digit unread count: the widest Messages link a member's row has to fit.
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 12 } });
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Sam", suspended: false } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

/** The header on /events once its account links (and badges) have settled. */
async function measure(page: Page, who: Who) {
  await page.goto("/events");
  const header = page.locator("header").first();
  await expect(header.getByRole("link", { name: READY[who] }).first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const box = await header.boundingBox();
  const primary = page.getByRole("navigation", { name: "Primary" });
  // Every visible control in the row, as [top, bottom, right] (one row: they all sit inside the header).
  const controls = await primary.locator("a").evaluateAll((links) =>
    links
      .map((link) => link.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right), height: Math.round(r.height) })),
  );
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return { height: Math.round(box?.height ?? 0), controls, overflow };
}

for (const width of [1024, 1280, 1440, 1920]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`desktop header at ${width}px in ${theme === "light" ? "Light" : "Dark"}`, () => {
      test.use({ viewport: { width, height: 900 } });

      test("is one 100px row, as tall signed in (member, admin with badge) as signed out, with no search field", async ({ page }) => {
        const themed = async (p: Page) => {
          if (theme === "dark") await p.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
        };
        await themed(page);
        await as(page, "signed-out");
        const signedOut = await measure(page, "signed-out");
        // --header-h (app/globals.css) is 100px from lg; in both themes its rule is drawn inside the header.
        expect(signedOut.height).toBe(100);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--header-h").trim())).toBe("6.25rem");
        expect(signedOut.overflow).toBeLessThanOrEqual(0);
        await expect(page.locator("header").getByRole("search")).toHaveCount(0);

        for (const who of ["member", "admin"] as const) {
          const signedInPage = await page.context().newPage();
          await themed(signedInPage);
          await as(signedInPage, who);
          const result = await measure(signedInPage, who);
          expect(result.height, `${who}: ${JSON.stringify(result)}`).toBe(signedOut.height);
          expect(result.overflow, who).toBeLessThanOrEqual(0);
          // One row: every control inside the bar, 32px or taller (the Messages chip is 37, the rest 40 or more), and none past the right edge.
          for (const control of result.controls) {
            expect(control.top, `${who}: ${JSON.stringify(control)}`).toBeGreaterThanOrEqual(0);
            expect(control.bottom, `${who}: ${JSON.stringify(control)}`).toBeLessThanOrEqual(100);
            expect(control.height, who).toBeGreaterThanOrEqual(32);
            expect(control.right, who).toBeLessThanOrEqual(width);
          }
          const header = signedInPage.locator("header");
          await expect(header.getByRole("search")).toHaveCount(0);
          // No heart on the desktop row: Saved is on /account (and in the phone menu).
          await expect(signedInPage.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Saved" })).toHaveCount(0);
          // The avatar: a solid 40px-tall block with the initial and a caret (the button that opens the avatar menu),
          // in the text colour: white with a black initial on the black header, in both themes (owner, 22 Nov 2026).
          const avatar = signedInPage.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Account" });
          await expect(avatar).toBeVisible();
          const avatarBox = await avatar.boundingBox();
          expect(Math.round(avatarBox?.height ?? 0)).toBe(40);
          expect(Math.round(avatarBox?.width ?? 0)).toBeGreaterThanOrEqual(40);
          expect(avatarBox && avatarBox.y >= 0 && avatarBox.y + avatarBox.height <= 100, who).toBe(true);
          expect(Math.round((avatarBox?.x ?? 0) + (avatarBox?.width ?? 0)), who).toBeLessThanOrEqual(width);
          expect(await avatar.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])).toEqual(
            ["rgb(255, 255, 255)", "rgb(0, 0, 0)"],
          );
          await signedInPage.close();
        }
      });
    });
  }
}

// The board's 18px Medium nav labels; from 1280px the row tightens by 8px, to 92, once the page has scrolled
// (Round 2 §1.2; back to 100 at the top), while --header-h stays 100px. At 1024–1279 it stays 100.
for (const width of [1024, 1440]) {
  test.describe(`desktop header at ${width}px, scrolled`, () => {
    test.use({ viewport: { width, height: 900 } });

    test(width >= 1280 ? "tightens to 92px once scrolled and back to 100 at the top; the nav is 18px Medium" : "stays 100px when scrolled; the nav is 18px Medium", async ({ page }) => {
      await as(page, "signed-out");
      await measure(page, "signed-out");
      const header = page.locator("header").first();
      const discover = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Discover" });
      expect(await discover.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight])).toEqual(["18px", "500"]);
      // Room to scroll, whatever the mocked page holds.
      await page.evaluate(() => document.querySelector("main")?.style.setProperty("min-height", "300vh"));
      await page.evaluate(() => window.scrollTo(0, 400));
      const scrolledHeight = width >= 1280 ? 92 : 100;
      await expect(header).toHaveAttribute("data-scrolled", "");
      await expect.poll(async () => Math.round((await header.boundingBox())?.height ?? 0)).toBe(scrolledHeight);
      // Its place in the flow stays 100px (an 8px margin under the 92px row), so the page below never moves.
      expect(await header.evaluate((el) => Math.round(el.getBoundingClientRect().height + parseFloat(getComputedStyle(el).marginBottom)))).toBe(100);
      // Still sticky, at the top.
      expect(Math.round((await header.boundingBox())?.y ?? -1)).toBe(0);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--header-h").trim())).toBe("6.25rem");
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(header).not.toHaveAttribute("data-scrolled");
      await expect.poll(async () => Math.round((await header.boundingBox())?.height ?? 0)).toBe(100);
    });
  });
}

test.describe("desktop header at 1440px, signed in", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // The owner's call of 22 Nov 2026: the whole header is black in Light and Dark, like the footer (it replaces Q1's
  // white / #0a0a0a desktop row).
  test("is black in Light and Dark (ink, as the footer), with the board's controls in white, and the Messages count an orange pill", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      const themed = await page.context().newPage();
      if (theme === "dark") await themed.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
      await as(themed, "member");
      await measure(themed, "member");
      const header = themed.locator("header").first();
      // The footer's black: ink's --background, #000 in both themes (not the Dark page's other blacks).
      expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor), theme).toBe("rgb(0, 0, 0)");
      expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor), theme).toBe(
        await themed.locator("footer").evaluate((el) => getComputedStyle(el).backgroundColor),
      );
      // The 1px rule under it only where the black bar meets the black page (Dark), in ink's #333; none in Light.
      expect(await header.evaluate((el) => [getComputedStyle(el, "::after").display, getComputedStyle(el, "::after").backgroundColor]), theme).toEqual(
        theme === "light" ? ["none", "rgb(51, 51, 51)"] : ["block", "rgb(51, 51, 51)"],
      );
      const primary = themed.getByRole("navigation", { name: "Primary" });
      // The wordmark 64px in, white (currentColor, ink's text colour); the places 18px, white, Discover's current
      // underline white and its dots orange.
      const wordmarkSvg = themed.locator("header > div.hidden").getByRole("link", { name: "Sheltüh home" }).locator("svg");
      const wordmark = await wordmarkSvg.boundingBox();
      expect(Math.round(wordmark?.x ?? 0)).toBe(64);
      expect(await wordmarkSvg.evaluate((el) => getComputedStyle(el).color), theme).toBe("rgb(255, 255, 255)");
      const discover = primary.getByRole("link", { name: "Discover" });
      expect(
        await discover.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).textDecorationColor, getComputedStyle(el, "::before").backgroundColor, getComputedStyle(el, "::before").opacity]),
        theme,
      ).toEqual(["rgb(255, 255, 255)", "rgb(255, 255, 255)", "rgb(255, 72, 0)", "1"]);
      for (const name of ["Nearby", "Community"]) {
        expect(await primary.getByRole("link", { name }).evaluate((el) => getComputedStyle(el).color), `${theme} ${name}`).toBe("rgb(255, 255, 255)");
      }
      // The signed-in For organisers is the outlined nav button (navigation-search.md §5.1): an 18px regular label,
      // 8px above and below it and 25px sides inside the 1.5px stroke (171 × 43 as drawn; Chrome draws the stroke 1px
      // on a 1x screen, so the box is 170 × 42 there).
      const organisers = primary.getByRole("link", { name: "For organisers" });
      expect(
        await organisers.evaluate((el) => {
          const style = getComputedStyle(el);
          return [el.clientHeight, style.paddingTop, style.paddingLeft, style.borderTopStyle, style.fontSize, style.fontWeight];
        }),
        theme,
      ).toEqual([40, "8px", "25px", "solid", "18px", "400"]);
      // Outlined in white on the black bar: a white stroke and label, no fill.
      expect(
        await organisers.evaluate((el) => [getComputedStyle(el).borderTopColor, getComputedStyle(el).color, getComputedStyle(el).backgroundColor]),
        theme,
      ).toEqual(["rgb(255, 255, 255)", "rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"]);
      // The Messages chip: 37px, 14px regular, filled in the text colour like the avatar beside it.
      const chip = primary.getByRole("link", { name: READY.member });
      expect(
        await chip.evaluate((el) => {
          const avatar = getComputedStyle(document.querySelector(".nav-avatar") as Element);
          const style = getComputedStyle(el);
          return [
            Math.round(el.getBoundingClientRect().height),
            style.fontSize,
            style.fontWeight,
            style.backgroundColor === avatar.backgroundColor,
            style.color === avatar.color,
          ];
        }),
        theme,
      ).toEqual([37, "14px", "400", true, true]);
      // ...which is white with black text on the black bar, in both themes.
      expect(await chip.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]), theme).toEqual([
        "rgb(255, 255, 255)",
        "rgb(0, 0, 0)",
      ]);
      // The chip's own badge (the avatar menu's Messages row has one too, in its closed popover): the board's 16px pill,
      // 24 wide for one digit and 30 for "12" (as the board's "12" on Saved).
      const badge = chip.locator("[data-unread-badge]");
      expect(
        await badge.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color, Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)]),
        theme,
      ).toEqual(["rgb(255, 72, 0)", "rgb(0, 0, 0)", 30, 16]);
      // The avatar: 40px tall, its right edge 66px from the screen's, as drawn.
      const avatarBox = await primary.getByRole("button", { name: "Account" }).boundingBox();
      expect([Math.round(avatarBox?.height ?? 0), Math.round(1440 - (avatarBox?.x ?? 0) - (avatarBox?.width ?? 0))]).toEqual([40, 66]);
      await themed.close();
    }
  });

  test("keyboard: the wordmark, Discover, Nearby, Community, For organisers, Messages, then the avatar, each with a visible ring", async ({ page }) => {
    await as(page, "member");
    await measure(page, "member");
    await page.locator("header").getByRole("link", { name: "Sheltüh home" }).last().focus();
    const primary = page.getByRole("navigation", { name: "Primary" });
    for (const name of ["Discover", "Nearby", "Community", "For organisers", READY.member, "Account"]) {
      await page.keyboard.press("Tab");
      const control = name === "Account" ? primary.getByRole("button", { name }) : primary.getByRole("link", { name });
      await expect(control).toBeFocused();
      // The global ring: 2px, white on the black header (never orange).
      expect(await control.evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineColor])).toEqual([
        "solid",
        "rgb(255, 255, 255)",
      ]);
    }
  });
});
