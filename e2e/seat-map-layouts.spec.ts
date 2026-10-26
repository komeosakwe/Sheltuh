import { expect, test, type Page } from "@playwright/test";
import type { EventRecord, SeatMapRecord } from "@/lib/api/types";
import { flattenSeats, validateSeatMapTemplate, type SeatMapTemplate } from "@/lib/seating/template";

/**
 * The organiser's seat-map editor (/dashboard/{eventId}/seat-map) starting
 * from a ready-made layout (docs/design/seating.md §5.13, "Start from a
 * layout"), at a phone width and on a desktop: pick one, then Save. Live
 * mode, signed in with a stored test session (the Supabase URL is a local
 * placeholder), with every /api/* request answered here, as
 * e2e/dashboard-editor.spec.ts and e2e/seating.spec.ts do.
 */

const DAY = 86_400_000;
const EVENT_ID = "evt-e2e-seated-draft";
const TIERS = ["tt-full", "tt-concession"];

function draftEvent(): EventRecord {
  const now = Date.now();
  const start = now + 30 * DAY;
  return {
    organiserId: "org-demo",
    eventId: EVENT_ID,
    slug: "e2e-seated-draft",
    title: "Seated Draft Night",
    description: "A seated show, still a draft.",
    category: "theatre",
    venueName: "Northside Hall",
    venueAddress: "1 Example St, Brunswick VIC 3056",
    suburb: "Brunswick",
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 2 * 3600_000).toISOString(),
    organiserName: "Northside Noise",
    ticketTypes: [
      { id: TIERS[0], name: "Full price", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 100 },
      { id: TIERS[1], name: "Concession", priceCents: 2500, feePolicy: "buyer-pays", quantityAvailable: 50 },
    ],
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
    ticketingLocked: false,
    status: "draft",
    moderationLog: [],
    createdAt: new Date(now - 2 * DAY).toISOString(),
    updatedAt: new Date(now - DAY).toISOString(),
  };
}

/** Signs in as an approved organiser and answers the seat-map page's API calls; returns the saved maps. */
async function organiserWithDraft(page: Page): Promise<SeatMapTemplate[]> {
  const saved: SeatMapTemplate[] = [];
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
  // The storage key supabase-js derives from the placeholder URL (http://127.0.0.1:…/supabase-mock).
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
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
    if (path === `/api/organisers/me/events/${EVENT_ID}`) return route.fulfill({ json: draftEvent() });
    if (path === `/api/events/${EVENT_ID}/seat-map`) {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { template: unknown };
        // As the API: the same validator, with the event's tiers.
        const result = validateSeatMapTemplate(body.template, { ticketTypeIds: TIERS });
        if (!result.ok) return route.fulfill({ status: 400, json: { error: "Invalid seat map.", fieldErrors: result.errors } });
        saved.push(result.template);
        const record: SeatMapRecord = { eventId: EVENT_ID, version: 7, seatCount: result.seatCount, template: result.template };
        return route.fulfill({ json: record });
      }
      return route.fulfill({ status: 404, json: { error: "No seat map." } });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return saved;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of [
  { width: 320, height: 640, name: "320" },
  { width: 1280, height: 900, name: "1280" },
]) {
  test.describe(`seat-map editor, Start from a layout, at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("an empty map: pick a layout with the keyboard, then Save sends it", async ({ page }) => {
      const saved = await organiserWithDraft(page);
      await page.goto(`/dashboard/${EVENT_ID}/seat-map`);
      const picker = page.getByRole("region", { name: "Start from a layout" });
      await expect(picker).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Layouts" })).toHaveAttribute("aria-expanded", "true");
      await noSidewaysScroll(page);

      // Every card: at least 44px tall, inside the viewport's width.
      const cards = picker.getByRole("button");
      await expect(cards).toHaveCount(5);
      for (const card of await cards.all()) {
        const box = await card.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vp.width);
      }

      await page.getByLabel("About how many seats").fill("128");
      await page.getByLabel("Price tier for these seats").selectOption(TIERS[1]);
      const aisle = picker.getByRole("button", { name: "Theatre with a centre aisle" });
      await expect(aisle).toHaveAccessibleDescription(/128 seats · 2 wheelchair spaces/);
      await aisle.focus();
      await page.keyboard.press("Enter");

      await expect(picker).toHaveCount(0);
      await expect(page.getByText("128 seats · 1 tier")).toBeVisible();
      await expect(page.getByText("· Unsaved changes")).toBeVisible();
      await expect(page.getByRole("button", { name: "Layouts" })).toBeFocused();
      if (vp.width >= 1024) {
        // The canvas draws the new seats.
        await expect(page.locator("[data-seat]")).toHaveCount(128);
      }
      await noSidewaysScroll(page);

      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Seat map saved: 128 seats." })).toHaveCount(1);
      await expect(page.getByText("· Unsaved changes")).toHaveCount(0);
      expect(saved).toHaveLength(1);
      const seats = flattenSeats(saved[0]);
      expect(seats).toHaveLength(128);
      expect(seats.every((s) => s.ticketTypeId === TIERS[1])).toBe(true);
      expect(seats.filter((s) => s.kind === "wheelchair")).toHaveLength(2);
    });
  });
}
