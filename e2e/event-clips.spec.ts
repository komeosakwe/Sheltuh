import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import type { EventRecord } from "@/lib/api/types";
import { sampleEvents } from "@/lib/sample-events";

/**
 * Event clips in a real browser (docs/design/event-clips.md): the Play
 * button on the home rails' cards and on the event page's photo, nothing
 * fetched before it's pressed, the viewer dialog (focus in, Escape, focus
 * back), the rails holding still while it's open, the 375px layout, and the
 * editor's upload with the Storage PUT intercepted. Live mode with every
 * /api/* request answered here (NEXT_PUBLIC_EVENT_CLIPS=1 on the e2e
 * server). Playwright's Chromium has no H.264 decoder, so these check the
 * DOM and the requests, never playback: a clip's URL answers 404 here and
 * the viewer shows its error.
 */

/** The viewer's error (components/events/ClipViewer.tsx CLIP_ERROR_TEXT; a client module, so not imported here). */
const CLIP_ERROR_TEXT = "This clip can’t play right now.";
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const clipOf = (eventId: string) => ({
  url: `/api/events/${eventId}/clip?v=1761000000000`,
  durationMs: 12_000,
  width: 1080,
  height: 1920,
  description: "Two singers trade verses under green lights while the crowd claps.",
});

function asPublic(index: number, start: number): PublicEvent {
  const event = sampleEvents[index];
  return {
    organiserId: "org-demo",
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    suburb: event.suburb,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 3 * HOUR).toISOString(),
    organiserName: event.organiserName,
    imageUrl: event.imageUrl,
    ticketTypes: event.ticketTypes,
    ticketingMode: event.ticketingMode ?? "sheltuh",
    externalTicketUrl: event.externalTicketUrl,
    externalFree: event.externalFree ?? false,
    externalProvider: event.externalProvider ?? null,
    clip: clipOf(event.id),
  };
}

/** Every event a week or more out (so none is this weekend's pair): one long "Coming up" rail. */
function fixtures(): PublicEvent[] {
  const now = Date.now();
  return sampleEvents.map((_, i) => asPublic(i, now + 8 * DAY + i * 26 * HOUR));
}

/**
 * Answers the public API; returns every request for a clip (there must be
 * none before a press), and `releaseClips`, which lets the held clip
 * requests answer (their 404 replaces the video with the viewer's error).
 */
async function mockPublicApi(page: Page) {
  const events = fixtures();
  const clipRequests: string[] = [];
  let releaseClips: () => void = () => {};
  const clipsReleased = new Promise<void>((resolve) => (releaseClips = resolve));
  page.on("request", (request: Request) => {
    if (/\/clip(\?|\/|$)/.test(new URL(request.url()).pathname + new URL(request.url()).search)) clipRequests.push(request.url());
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (/^\/api\/events\/[^/]+\/clip$/.test(url.pathname)) {
      await clipsReleased;
      return route.fulfill({ status: 404, json: { error: "Event not found." } });
    }
    if (url.pathname === "/api/events") return route.fulfill({ json: { items: events, nextCursor: undefined } });
    const slug = /^\/api\/events\/slug\/([^/]+)$/.exec(url.pathname)?.[1];
    if (slug) {
      const event = events.find((e) => e.slug === decodeURIComponent(slug));
      return event ? route.fulfill({ json: event }) : route.fulfill({ status: 404, json: { error: "Event not found." } });
    }
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    if (/\/going(\/|$)/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    // The clip itself (a 302 to Storage in production): Chromium couldn't decode it anyway.
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return { events, clipRequests, releaseClips };
}

async function openHome(page: Page) {
  const { events, clipRequests, releaseClips } = await mockPublicApi(page);
  await page.goto("/");
  const section = page.locator("[data-home-section]").filter({ has: page.getByRole("heading", { name: "Coming up", exact: true }) });
  const rail = section.getByRole("list");
  await expect(rail).toBeVisible({ timeout: 30_000 });
  await page.mouse.move(1, 1);
  await section.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  return { events, clipRequests, releaseClips, section, rail };
}

const realCards = (rail: Locator) => rail.locator(":scope > li:not([data-rail-clone])");
const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("home rails at 1280×800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("each card has a Play between its link and Save; nothing loads before the press; Escape closes and focus comes back", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { events, clipRequests, releaseClips, rail } = await openHome(page);
    const first = realCards(rail).first();
    const title = (await first.locator("h3").textContent()) ?? "";
    const event = events.find((e) => e.title === title);
    expect(event).toBeDefined();
    const play = first.getByRole("button", { name: `Play clip: ${title}, 0:12` });
    await expect(play).toBeVisible();
    await expect(play).toContainText("0:12");

    // Tab order: the card's link, Play, Save.
    await first.locator("[data-card-link]").focus();
    await page.keyboard.press("Tab");
    await expect(play).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(first.getByRole("button", { name: `Save ${title}` }).or(first.getByRole("link", { name: `Sign in to save ${title}` }))).toBeFocused();

    expect(clipRequests).toEqual([]);
    expect(await page.locator("video").count()).toBe(0);

    await play.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: title })).toBeFocused();
    const video = dialog.locator("video");
    await expect(video).toHaveAttribute("src", event?.clip?.url ?? "");
    expect(await video.evaluate((v: HTMLVideoElement) => ({ muted: v.muted, controls: v.controls, inline: v.playsInline, loop: v.loop }))).toEqual({
      muted: true,
      controls: true,
      inline: true,
      loop: false,
    });
    // Reduced motion: only the header is asked for, and it isn't played.
    await expect(video).toHaveAttribute("preload", "metadata");
    await expect(dialog.getByText(event?.clip?.description ?? "")).toBeVisible();
    await expect.poll(() => clipRequests.length).toBeGreaterThan(0);
    // The clip's URL 404s here: the viewer says so, with Try again.
    releaseClips();
    await expect(dialog.getByRole("alert")).toHaveText(CLIP_ERROR_TEXT);
    await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(play).toBeFocused();
    expect(await page.locator("video").count()).toBe(0);
  });

  test("the rails hold still while the viewer is open, and carry on once it's closed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const { rail } = await openHome(page);
    // Drifting.
    const before = await rail.evaluate((ul) => ul.scrollLeft);
    await expect.poll(() => rail.evaluate((ul) => ul.scrollLeft), { timeout: 5000 }).toBeGreaterThan(before + 10);
    // Pressed without moving the pointer over the rail (a hover would hold it anyway).
    await realCards(rail).nth(1).locator("[data-clip-play]").dispatchEvent("click");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);
    const held = await rail.evaluate((ul) => ul.scrollLeft);
    await page.waitForTimeout(1500);
    expect(await rail.evaluate((ul) => ul.scrollLeft)).toBe(held);
    await dialog.getByRole("button", { name: "Close" }).dispatchEvent("click");
    await expect(dialog).toBeHidden();
    // Focus back on Play would hold it too (keyboard focus in the section): let it go.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect.poll(() => rail.evaluate((ul) => ul.scrollLeft), { timeout: 5000 }).toBeGreaterThan(held + 10);
  });
});

test.describe("at 375×667", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("home: the Play chip sits in the image's bottom-left, a 44px target, with no sideways scroll", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { rail } = await openHome(page);
    const first = realCards(rail).first();
    const media = await first.locator("[data-card-media]").boundingBox();
    const play = await first.locator("[data-clip-play]").boundingBox();
    const chip = await first.locator("[data-clip-play] > span:not(.sr-only)").boundingBox();
    expect(media && play && chip).toBeTruthy();
    if (!media || !play || !chip) return;
    expect(play.width).toBeGreaterThanOrEqual(44);
    expect(play.height).toBeGreaterThanOrEqual(44);
    expect(play.x).toBeGreaterThanOrEqual(media.x);
    expect(media.y + media.height - (play.y + play.height)).toBeGreaterThanOrEqual(0);
    // The 36px chip sits 8px in from the left and bottom edges, as Save does from the top-right.
    expect(chip.height).toBe(36);
    expect(Math.abs(chip.x - media.x - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(media.y + media.height - (chip.y + chip.height) - 8)).toBeLessThanOrEqual(1);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("event page: Play on the photo at the text edge, no layout shift, and the viewer is a bottom sheet", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { events, clipRequests } = await mockPublicApi(page);
    const event = events[0];
    await page.goto(`/events/${event.slug}`);
    const play = page.getByRole("button", { name: `Play clip: ${event.title}, 0:12` });
    await expect(play).toBeVisible({ timeout: 30_000 });
    await expect(play).toContainText("Play clip");
    const title = page.getByRole("heading", { level: 1, name: event.title });
    const titleBox = await title.boundingBox();
    const playBox = await play.boundingBox();
    expect(titleBox && playBox).toBeTruthy();
    if (!titleBox || !playBox) return;
    // Lined up with the page's 20px text edge, 44px tall.
    expect(Math.abs(playBox.x - titleBox.x)).toBeLessThanOrEqual(1);
    expect(playBox.height).toBeGreaterThanOrEqual(44);
    // The photo is still full-bleed (375 wide), and the title still on the first screen.
    const art = await page.locator("[data-clip-play]").locator("xpath=..").locator("[aria-hidden='true']").first().boundingBox();
    expect(art?.width).toBe(375);
    expect(art?.x).toBe(0);
    expect(titleBox.y + titleBox.height).toBeLessThan(667);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    expect(clipRequests).toEqual([]);

    await play.click();
    const dialog = page.getByRole("dialog", { name: event.title });
    await expect(dialog).toBeVisible();
    const sheet = await dialog.boundingBox();
    expect(sheet?.width).toBe(375);
    expect(Math.round((sheet?.y ?? 0) + (sheet?.height ?? 0))).toBe(667);
    await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(play).toBeFocused();
  });
});

test.describe("the editor's clip upload", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("saves the draft, uploads the file straight to Storage, has it checked and attached", async ({ page }) => {
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
    const draft: EventRecord = {
      organiserId: "org-demo",
      eventId: "evt-1",
      slug: "warehouse-night",
      title: "Warehouse Night",
      description: "Four bands.",
      category: "live-music",
      venueName: "The Tote",
      venueAddress: "71 Johnston St",
      suburb: "Collingwood",
      startsAt: new Date(now + 10 * DAY).toISOString(),
      endsAt: new Date(now + 10 * DAY + 3 * HOUR).toISOString(),
      organiserName: "Northside Noise",
      ticketTypes: [{ id: "ga", name: "General admission", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 50 }],
      ticketingMode: "sheltuh",
      status: "draft",
      moderationLog: [],
      createdAt: new Date(now - DAY).toISOString(),
      updatedAt: new Date(now - DAY).toISOString(),
    };
    // The event as the server has it: each save answers with its clip.
    let current: EventRecord = draft;
    const steps: string[] = [];
    const attachBodies: unknown[] = [];
    let storagePut: { headers: Record<string, string>; size: number } | null = null;

    await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
    await page.route("**/supabase-mock/**", async (route) => {
      const request = route.request();
      if (request.method() === "PUT" && request.url().includes("/storage/v1/object/upload/sign/")) {
        steps.push("storage PUT");
        storagePut = { headers: request.headers(), size: request.postDataBuffer()?.length ?? 0 };
        return route.fulfill({ status: 200, json: { Key: "event-clips/uploads/x.mp4" } });
      }
      return route.fulfill({ status: 200, json: {} });
    });
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (path === "/api/organisers/me") {
        return route.fulfill({
          json: {
            ownerUserId: "u1",
            organiserId: "org-demo",
            displayName: "Northside Noise",
            contactEmail: "hello@northside.example",
            description: "Warehouse nights.",
            categories: ["live-music"],
            status: "approved",
            createdAt: new Date(now - 200 * DAY).toISOString(),
            updatedAt: new Date(now - 2 * DAY).toISOString(),
            payoutsEnabled: true,
          },
        });
      }
      if (path === "/api/organisers/me/events/evt-1") return route.fulfill({ json: draft });
      if (path === "/api/events/evt-1" && request.method() === "PATCH") {
        steps.push("save draft");
        return route.fulfill({ json: current });
      }
      if (path === "/api/events/evt-1/clip/uploads" && request.method() === "POST") {
        steps.push("upload URL");
        expect(request.postDataJSON()).toEqual({ sizeBytes: 4096, contentType: "video/mp4" });
        return route.fulfill({
          status: 201,
          json: {
            uploadId: "8d6f0a52-3c1e-4b8e-9f51-2f8f3d1c0a11",
            uploadUrl: `${url.origin}/supabase-mock/storage/v1/object/upload/sign/event-clips/uploads/evt-1/u1/8d6f0a52.mp4?token=signed`,
            expiresAt: new Date(now + 2 * HOUR).toISOString(),
            maxBytes: 10 * 1024 * 1024,
          },
        });
      }
      if (path === "/api/events/evt-1/clip" && request.method() === "PUT") {
        steps.push("attach");
        const body = request.postDataJSON() as { description: string };
        attachBodies.push(body);
        current = {
          ...draft,
          clip: { ...clipOf("evt-1"), description: body.description },
          updatedAt: new Date(now + attachBodies.length * 1000).toISOString(),
        };
        return route.fulfill({ json: current });
      }
      if (path === "/api/events/evt-1/clip/preview") {
        steps.push("preview");
        return route.fulfill({ json: { url: `${url.origin}/supabase-mock/signed/preview.mp4`, expiresAt: "" } });
      }
      if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
      if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
      if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
      return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
    });

    await page.goto("/dashboard/evt-1");
    await expect(page.getByText("Event clip (optional)")).toBeVisible({ timeout: 30_000 });
    await page.locator("#event-clip").setInputFiles({ name: "crowd.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(4096) });
    await expect(page.getByText("Ready to upload when you save.")).toBeVisible();
    await page.getByLabel("Describe the clip (required)").fill("A crowd sings along.");
    await page.getByRole("checkbox", { name: /I own this clip/ }).check();
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.getByText("Clip saved.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove clip" })).toBeVisible();
    expect(steps.slice(0, 4)).toEqual(["save draft", "upload URL", "storage PUT", "attach"]);
    expect(storagePut).not.toBeNull();
    const put = storagePut as unknown as { headers: Record<string, string>; size: number };
    expect(put.size).toBe(4096);
    expect(put.headers["content-type"]).toBe("video/mp4");
    expect(put.headers["x-upsert"]).toBe("false");
    expect(put.headers.apikey).toBe("e2e-placeholder");
    expect(put.headers.authorization).toBeUndefined();
    expect(attachBodies).toEqual([{ uploadId: "8d6f0a52-3c1e-4b8e-9f51-2f8f3d1c0a11", description: "A crowd sings along.", rightsConfirmed: true }]);
    await expect.poll(() => steps.includes("preview")).toBe(true);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

    // A new description alone: no upload, and the rights aren't sent again.
    await page.getByLabel("Describe the clip (required)").fill("A crowd sings along, then confetti.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => attachBodies.length).toBe(2);
    expect(attachBodies[1]).toEqual({ description: "A crowd sings along, then confetti." });
    expect(steps.filter((step) => step === "upload URL")).toHaveLength(1);
  });
});
