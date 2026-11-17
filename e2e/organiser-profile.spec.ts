import { expect, test, type Page } from "@playwright/test";
import type { PublicOrganiserProfile } from "@/lib/api/types";

/**
 * The organiser profile's layout in a real browser (live mode, every /api/*
 * request answered here, signed out): the cover with the logo over its
 * corner, Follow and Share on one row, the chips wrapping, the links in
 * order, and no sideways scroll at any width (docs/design/organiser-profile.md).
 * Screenshots go to E2E_SCREENSHOT_DIR when it's set.
 */

const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const ORG = "8c4f6f8e-0d5b-4a51-9a3e-2f6f0b0d1a11";
// A flat 7:2 picture at the stored size, served as the cover (a 1×1 image under a 1120w srcset descriptor
// has a natural width of 0, which reads as a failed image).
const COVER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="2240" height="640"><rect width="2240" height="640" fill="#4a6670"/><circle cx="1120" cy="320" r="200" fill="#d9c9a8"/></svg>';
// A 1×1 PNG, served as the logo.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const PROFILE: PublicOrganiserProfile = {
  organiserId: ORG,
  displayName: "Northside Noise & Friends Collective",
  description: "Loud nights in small rooms.\nAll ages where we can.",
  categories: ["live-music"],
  profileTags: ["live-music", "dj-club-nights", "poetry-spoken-word"],
  customTags: ["Late-night warehouse", "Queer joy"],
  websiteUrl: "https://northside.example",
  socialLinks: {
    instagram: "https://www.instagram.com/northside.noise/",
    soundcloud: "https://soundcloud.com/northside-noise",
  },
  memberSince: "2026-03",
  featuredVideo: null,
  followerCount: 1240,
  eventCount: 12,
  logoUrl: `/api/organisers/${ORG}/logo?v=1`,
  coverUrl: `/api/organisers/${ORG}/cover?v=1`,
  coverSmallUrl: `/api/organisers/${ORG}/cover?size=small&v=1`,
  upcomingEvents: [],
  recentEvents: [],
};

async function mockApi(page: Page, profile: PublicOrganiserProfile) {
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/organisers/${ORG}/profile`) return route.fulfill({ json: profile });
    if (path === `/api/organisers/${ORG}/logo`) return route.fulfill({ contentType: "image/png", body: PNG });
    if (path === `/api/organisers/${ORG}/cover`) return route.fulfill({ contentType: "image/svg+xml", body: COVER_SVG });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const width of [320, 390, 768, 1024, 1440]) {
  test.describe(`organiser profile at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("cover with the logo over its corner, Follow and Share on one row, chips wrapping, links in order", async ({
      page,
    }) => {
      await mockApi(page, PROFILE);
      await page.goto(`/organisers/${ORG}`);
      const heading = page.getByRole("heading", { level: 1, name: PROFILE.displayName });
      await expect(heading).toBeVisible({ timeout: 30_000 });

      // The cover: a 7:2 frame at least 176px tall (taller than 7:2 on phones), decorative.
      const cover = page.locator("[data-organiser-cover]");
      const coverBox = await cover.boundingBox();
      if (!coverBox) throw new Error("no cover");
      expect(coverBox.height).toBeGreaterThanOrEqual(175.5);
      expect(Math.abs(coverBox.height - Math.max(176, coverBox.width / 3.5))).toBeLessThan(1.5);
      await expect(cover.locator("img")).toHaveAttribute("alt", "");

      // The logo straddles the cover's bottom edge, inset from its left edge, above the name.
      const logoBox = await page.locator("[data-organiser-logo]").boundingBox();
      if (!logoBox) throw new Error("no logo");
      const coverBottom = coverBox.y + coverBox.height;
      expect(logoBox.y).toBeLessThan(coverBottom);
      expect(logoBox.y + logoBox.height).toBeGreaterThan(coverBottom);
      expect(logoBox.x).toBeGreaterThan(coverBox.x);
      const headingBox = await heading.boundingBox();
      expect(headingBox && headingBox.y).toBeGreaterThan(logoBox.y + logoBox.height);

      // Signed out: "Sign in to follow", orange, with Share on the same row.
      const follow = page.getByRole("link", { name: "Sign in to follow" });
      const share = page.getByRole("button", { name: `Share ${PROFILE.displayName}` });
      await expect(follow).toBeVisible();
      await expect(follow).toHaveCSS("background-color", "rgb(255, 72, 0)");
      const followBox = await follow.boundingBox();
      const shareBox = await share.boundingBox();
      if (!followBox || !shareBox) throw new Error("no Follow or Share");
      expect(Math.abs(followBox.y - shareBox.y)).toBeLessThan(2);
      expect(shareBox.x).toBeGreaterThan(followBox.x);

      // Facts on a line of text, chips inside the page.
      await expect(page.getByText("1,240 followers")).toBeVisible();
      await expect(page.getByText("12 events")).toBeVisible();
      const chips = page.getByRole("list", { name: "Categories" }).getByRole("listitem");
      await expect(chips).toHaveText([
        "Live music",
        "DJ & club nights",
        "Poetry & spoken word",
        "Late-night warehouse",
        "Queer joy",
      ]);
      for (const box of await Promise.all((await chips.all()).map((chip) => chip.boundingBox()))) {
        expect(box && box.x + box.width).toBeLessThanOrEqual(width);
      }

      // Instagram first, the website last.
      const links = page.getByRole("region", { name: "Links" }).getByRole("link");
      await expect(links).toHaveCount(3);
      await expect(links.nth(0)).toHaveAccessibleName(/^Instagram/);
      await expect(links.nth(2)).toHaveAccessibleName(/^Website/);

      await expect(page.getByRole("link", { name: "Report this organiser" })).toHaveAttribute("href", /^mailto:/);
      await noSidewaysScroll(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/organiser-profile-${width}.png`, fullPage: true });
    });
  });
}

test.describe("organiser profile without a cover at 390px", () => {
  test.use({ viewport: { width: 390, height: 900 } });

  test("no cover frame: the logo sits in the flow above the name", async ({ page }) => {
    await mockApi(page, { ...PROFILE, coverUrl: undefined, coverSmallUrl: undefined });
    await page.goto(`/organisers/${ORG}`);
    const heading = page.getByRole("heading", { level: 1, name: PROFILE.displayName });
    await expect(heading).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-organiser-cover]")).toHaveCount(0);
    const logoBox = await page.locator("[data-organiser-logo]").boundingBox();
    const backBox = await page.locator("main").getByRole("link", { name: "All events", exact: true }).first().boundingBox();
    if (!logoBox || !backBox) throw new Error("no logo or back link");
    expect(logoBox.y).toBeGreaterThanOrEqual(backBox.y + backBox.height);
    await noSidewaysScroll(page);
  });
});

/** Signed in as the profile's own organiser (approved, no logo yet), with a stored test session. */
async function signedInAsOwner(page: Page) {
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
      email: "mia@example.com",
      email_confirmed_at: new Date(now - 300 * 86_400_000).toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(now - 300 * 86_400_000).toISOString(),
    },
  };
  // The storage key supabase-js derives from the placeholder URL (http://127.0.0.1:…/supabase-mock).
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
}

/** The "Links" heading's top against the header's first line (the box in the logo slot, or the strap). */
async function linksOffset(page: Page, firstLine: "slot" | "strap") {
  const heading = page.getByRole("heading", { level: 2, name: "Links" });
  await expect(heading).toBeVisible();
  const headingBox = await heading.boundingBox();
  const target =
    firstLine === "slot"
      ? page.locator("[data-organiser-logo-slot] > *")
      : page.locator("main header").getByText("Organiser", { exact: true });
  const targetBox = await target.boundingBox();
  if (!headingBox || !targetBox) throw new Error("no Links heading or first line");
  return Math.abs(headingBox.y - targetBox.y);
}

for (const width of [1024, 1440]) {
  test.describe(`organiser profile links column at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    const CASES: {
      name: string;
      profile: Partial<PublicOrganiserProfile>;
      owner?: boolean;
      logoFails?: boolean;
      level: "slot" | "strap";
      slotFilled: boolean;
    }[] = [
      { name: "cover and a logo: level with the strap under the logo", profile: {}, level: "strap", slotFilled: true },
      {
        name: "cover, logo that fails to load: level with the strap (the slot is empty)",
        profile: {},
        logoFails: true,
        level: "strap",
        slotFilled: false,
      },
      {
        name: "cover, no logo, the owner sees Add logo: level with the strap under it",
        profile: { logoUrl: undefined },
        owner: true,
        level: "strap",
        slotFilled: true,
      },
      { name: "cover, no logo, anyone else: level with the strap", profile: { logoUrl: undefined }, level: "strap", slotFilled: false },
      {
        name: "no cover, a logo: level with the logo",
        profile: { coverUrl: undefined, coverSmallUrl: undefined },
        level: "slot",
        slotFilled: true,
      },
      {
        name: "no cover, no logo: level with the strap",
        profile: { coverUrl: undefined, coverSmallUrl: undefined, logoUrl: undefined },
        level: "strap",
        slotFilled: false,
      },
    ];

    for (const c of CASES) {
      test(c.name, async ({ page }) => {
        const profile = { ...PROFILE, ...c.profile };
        if (c.owner) await signedInAsOwner(page);
        await mockApi(page, profile);
        // Registered after mockApi, so these are tried first.
        if (c.logoFails) {
          await page.route(`**/api/organisers/${ORG}/logo*`, (route) => route.fulfill({ status: 404, body: "" }));
        }
        if (c.owner) {
          await page.route("**/api/organisers/me", (route) =>
            route.fulfill({
              json: {
                ownerUserId: "u1",
                organiserId: ORG,
                displayName: PROFILE.displayName,
                contactEmail: "hello@northside.example",
                description: "",
                categories: ["live-music"],
                status: "approved",
                createdAt: "2026-03-01T00:00:00.000Z",
                updatedAt: "2026-03-01T00:00:00.000Z",
              },
            }),
          );
        }
        await page.goto(`/organisers/${ORG}`);
        await expect(page.getByRole("heading", { level: 1, name: PROFILE.displayName })).toBeVisible({ timeout: 30_000 });
        if (c.owner) await expect(page.getByRole("link", { name: "Add logo" })).toBeVisible();
        const slot = page.locator("[data-organiser-logo-slot]");
        if (c.slotFilled) await expect(slot.locator("> *")).toHaveCount(1);
        else await expect(slot.locator("> *")).toHaveCount(0);
        expect(await linksOffset(page, c.level)).toBeLessThan(1.5);
      });
    }
  });
}
