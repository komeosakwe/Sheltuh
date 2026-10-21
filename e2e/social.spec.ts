import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";

/**
 * Waitlist, member profiles and following in a real browser (live mode, every
 * /api/* request answered here; the video site and its image host are stubs).
 * Screenshots go to E2E_SCREENSHOT_DIR when it's set.
 */

const DAY = 86_400_000;
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const ORG = "8c4f6f8e-0d5b-4a51-9a3e-2f6f0b0d1a11";
const PROFILE_ID = "0b6c1f3e-5d0a-4a8e-9b1f-6f2a3c4d5e6f";
// A 1×1 PNG (the "photo").
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

function asPublic(slug: string, offsetDays = 7): PublicEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`no sample ${slug}`);
  const start = Date.now() + offsetDays * DAY;
  return {
    organiserId: ORG,
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    suburb: event.suburb,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 2 * 3600_000).toISOString(),
    organiserName: event.organiserName,
    imageUrl: event.imageUrl,
    ticketTypes: event.ticketTypes,
    soldOut: event.soldOut ?? false,
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
  };
}

async function signedIn(page: Page) {
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
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("sold out: Join waitlist at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("cards and the buy bar say Sold out / Join waitlist; the tickets section has the waitlist, and a guest is asked to confirm by email", async ({
    page,
  }) => {
    const joins: unknown[] = [];
    const soldOut = asPublic("off-kilter-a-new-play", 3);
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/events") {
        return route.fulfill({ json: { items: [soldOut, asPublic("neon-static", 9), asPublic("paper-moon-ceramics-lab", 12)] } });
      }
      if (url.pathname === "/api/events/trending") return route.fulfill({ json: { items: [] } });
      if (url.pathname === `/api/events/slug/${soldOut.slug}`) return route.fulfill({ json: soldOut });
      if (url.pathname === `/api/events/${soldOut.eventId}/waitlist` && request.method() === "POST") {
        joins.push(request.postDataJSON());
        return route.fulfill({ status: 202, json: { status: "confirmation_sent", expiresInHours: 24 } });
      }
      if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
      if (/\/going$/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
      return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
    });

    await page.goto("/");
    const join = page.getByRole("link", { name: `Join waitlist for ${soldOut.title}` }).first();
    await expect(join).toBeVisible({ timeout: 30_000 });
    await expect(join).toHaveAttribute("href", `/events/${soldOut.slug}#tickets`);
    await shot(page, "home-sold-out-390");

    await page.goto(`/events/${soldOut.slug}`);
    const bar = page.locator("[data-buy-bar]");
    await expect(bar).toContainText("Sold out", { timeout: 30_000 });
    await bar.getByRole("link", { name: "Join waitlist" }).click();
    await expect(page.locator("#tickets")).toBeFocused();
    const tickets = page.locator("#tickets");
    await expect(tickets.getByRole("heading", { name: "Sold out. Join the waitlist." })).toBeVisible();
    await expect(tickets.getByRole("button", { name: /Checkout/ })).toHaveCount(0);
    await shot(page, "event-sold-out-390");
    await tickets.getByLabel("Email").fill("guest@example.com");
    await tickets.getByRole("button", { name: "Join waitlist" }).click();
    await expect(tickets.getByRole("heading", { name: "Check your inbox" })).toBeFocused();
    expect(joins).toEqual([{ email: "guest@example.com" }]);
    await shot(page, "event-waitlist-sent-390");
    await noSidewaysScroll(page);
  });
});

test("the waitlist confirm page posts nothing until Confirm, drops the token from the URL, and is no-referrer + noindex", async ({
  page,
}) => {
  const posts: unknown[] = [];
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/waitlist/confirm") {
      posts.push(route.request().postDataJSON());
      return route.fulfill({
        json: { status: "joined", eventTitle: "Off-Kilter: A New Play", eventSlug: "off-kilter-a-new-play", ticketsAvailable: false },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  const token = "Z".repeat(40) + "a_-";
  const response = await page.goto(`/waitlist/confirm#token=${token}`);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  const confirm = page.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  expect(page.url()).not.toContain("#token");
  expect(posts).toEqual([]);
  await confirm.click();
  await expect(page.getByRole("heading", { name: "You’re on the waitlist" })).toBeFocused();
  expect(posts).toEqual([{ token }]);
  await expect(page.getByRole("link", { name: "Back to the event" })).toHaveAttribute(
    "href",
    "/events/off-kilter-a-new-play#tickets",
  );
});

for (const vp of [
  { width: 320, height: 640, name: "320" },
  { width: 1280, height: 900, name: "1280" },
]) {
  test.describe(`member profile at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("signed in: name, photo (fetched with the token), bio, Instagram, events, Message/Block/Report", async ({ page }) => {
      await signedIn(page);
      const avatarAuth: (string | undefined)[] = [];
      await page.route("**/api/**", (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === "/api/profiles/me") {
          return route.fulfill({
            json: { displayName: "Mia T.", suspended: false, createdAt: "2026-09-01", updatedAt: "2026-09-01", profileId: "me" },
          });
        }
        if (path === `/api/profiles/${PROFILE_ID}`) {
          return route.fulfill({
            json: {
              profileId: PROFILE_ID,
              displayName: "Aisha L.",
              bio: "Painter and noise fan. Ask me about risograph.",
              instagramHandle: "aisha.paints",
              instagramUrl: "https://www.instagram.com/aisha.paints/",
              hasAvatar: true,
              avatarUrl: `/api/profiles/${PROFILE_ID}/avatar?v=1`,
              isYou: false,
              upcomingEvents: [asPublic("neon-static", 9)],
              canMessage: true,
            },
          });
        }
        if (path === `/api/profiles/${PROFILE_ID}/avatar`) {
          avatarAuth.push(request.headers()["authorization"]);
          return route.fulfill({ contentType: "image/png", body: PNG });
        }
        if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
        if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], eventIds: [] } });
        return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
      });
      await page.goto(`/members/${PROFILE_ID}`);
      await expect(page.getByRole("heading", { level: 1, name: "Aisha L." })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("img[data-member-photo]")).toHaveAttribute("src", /^blob:/);
      expect(avatarAuth[0]).toBe("Bearer e2e.token.x");
      await expect(page.getByRole("link", { name: "@aisha.paints on Instagram (opens in a new tab)" })).toHaveAttribute(
        "target",
        "_blank",
      );
      for (const name of ["Message", "Block", "Report"]) await expect(page.getByRole("button", { name })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Neon Static/ })).toBeVisible();
      await shot(page, `member-profile-${vp.name}`);
      await noSidewaysScroll(page);
    });
  });
}

test.describe("organiser page at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("video loads only on Play (privacy-enhanced player); Follow sends the email choice explicitly", async ({ page }) => {
    await signedIn(page);
    const videoRequests: string[] = [];
    const follows: unknown[] = [];
    await page.context().route(/^https:\/\/(i\.ytimg\.com|www\.youtube-nocookie\.com|www\.youtube\.com)\//, (route) => {
      videoRequests.push(route.request().url());
      return route.request().url().includes("i.ytimg.com")
        ? route.fulfill({ contentType: "image/png", body: PNG })
        : route.fulfill({ contentType: "text/html", body: "<title>player</title><p>player stub</p>" });
    });
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === `/api/organisers/${ORG}/profile`) {
        return route.fulfill({
          json: {
            organiserId: ORG,
            displayName: "Northside Noise",
            description: "Loud nights in small rooms.",
            categories: ["live-music"],
            socialLinks: { instagram: "https://www.instagram.com/northside.noise/" },
            memberSince: "2026-03",
            featuredVideo: { provider: "youtube", id: "dQw4w9WgXcQ" },
            followerCount: 128,
            eventsHosted: 14,
            upcomingEvents: [asPublic("neon-static", 9)],
            recentEvents: [],
          },
        });
      }
      if (path === `/api/organisers/${ORG}/follow`) {
        if (request.method() === "POST") {
          follows.push(request.postDataJSON());
          return route.fulfill({ status: 201, json: { following: true, notifyNewEvents: false } });
        }
        return route.fulfill({ json: { following: false, notifyNewEvents: false } });
      }
      if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
      if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], eventIds: [] } });
      return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
    });

    await page.goto(`/organisers/${ORG}`);
    await expect(page.getByRole("heading", { level: 1, name: "Northside Noise" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Events hosted")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    expect(videoRequests.filter((u) => !u.includes("i.ytimg.com"))).toEqual([]);
    await shot(page, "organiser-390");

    const email = page.getByRole("checkbox", { name: "Email me when they announce a new event" });
    await expect(email).not.toBeChecked();
    await page.getByRole("button", { name: "Follow Northside Noise" }).click();
    await expect(page.getByRole("button", { name: "Following Northside Noise" })).toHaveAttribute("aria-pressed", "true");
    expect(follows).toEqual([{ notifyNewEvents: false }]);

    const play = page.getByRole("button", { name: /Play video/ });
    await play.focus();
    await page.keyboard.press("Enter");
    const frame = page.locator("iframe");
    await expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0");
    await expect(frame).toHaveAttribute("title", /featured video/);
    await expect(frame).toBeFocused();
    await shot(page, "organiser-video-playing-390");
    await noSidewaysScroll(page);
  });
});
