import { expect, test, type Page } from "@playwright/test";
import type { AdminHolderMessage, AdminHolderMessageDetail, HolderMessagesState } from "@/lib/api/types";

/**
 * Messages to ticket holders in a real browser: an organiser's compose form,
 * confirm dialog and history on a published event's page, at a phone and a
 * desktop width (no sideways scrolling, 44px controls); and the admin's list,
 * message text and Stop. Live mode with a stored test session (the Supabase
 * URL is a local placeholder), every /api/* request answered here.
 */

const DAY = 86_400_000;
const now = Date.now();
const EVENT_ID = "00000000-0000-4000-8000-000000000001";

function session(id: string, email: string, appMetadata: Record<string, unknown>) {
  return {
    access_token: "e2e.token.x",
    token_type: "bearer",
    expires_in: 31_536_000,
    expires_at: Math.floor(now / 1000) + 31_536_000,
    refresh_token: "r",
    user: {
      id,
      aud: "authenticated",
      role: "authenticated",
      email,
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: { provider: "email", ...appMetadata },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function commonRoutes(page: Page, stored: ReturnType<typeof session>) {
  // The storage key supabase-js derives from the placeholder URL (http://127.0.0.1:…/supabase-mock).
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), stored);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
}

const LIVE_EVENT = {
  organiserId: "org-demo",
  eventId: EVENT_ID,
  slug: "neon-static",
  title: "Neon Static: warehouse night",
  description: "d",
  category: "live-music",
  venueName: "The Corner",
  venueAddress: "57 Swan St",
  suburb: "Richmond",
  startsAt: new Date(now + 20 * DAY).toISOString(),
  endsAt: new Date(now + 20 * DAY + 3 * 3_600_000).toISOString(),
  organiserName: "Northside Noise",
  ticketTypes: [{ id: "ga", name: "General admission", priceCents: 2500, feePolicy: "buyer-pays", quantityAvailable: 100 }],
  ticketingMode: "sheltuh",
  externalFree: false,
  externalProvider: null,
  ticketingLocked: true,
  status: "published",
  moderationLog: [],
  createdAt: new Date(now - 10 * DAY).toISOString(),
  updatedAt: new Date(now - DAY).toISOString(),
};

function holderState(sent: number): HolderMessagesState {
  return {
    eventId: EVENT_ID,
    audienceCount: 12,
    canSend: true,
    limits: {
      subjectMin: 5,
      subjectMax: 100,
      bodyMin: 20,
      bodyMax: 1500,
      maxRecipients: 1000,
      perEventPerDay: 2,
      perEventTotal: 6,
      perOrganiserPerDay: 4,
    },
    remaining: { eventToday: 2 - sent, eventTotal: 5 - sent, organiserToday: 4 - sent },
    messages: Array.from({ length: sent + 1 }, (_, i) => ({
      messageId: `m${i}`,
      subject: i === sent && sent > 0 ? "Doors now open at 7pm" : "Parking changes tonight",
      body: "b",
      recipientCount: 12,
      sentCount: i === sent && sent > 0 ? 0 : 12,
      skippedCount: 0,
      createdAt: new Date(now - (i + 1) * DAY).toISOString(),
      cancelled: false,
    })),
  };
}

async function organiserPage(page: Page) {
  await commonRoutes(page, session("u1", "mia@example.com", {}));
  let sent = 0;
  const posts: unknown[] = [];
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
    if (path === `/api/organisers/me/events/${EVENT_ID}`) return route.fulfill({ json: LIVE_EVENT });
    if (path === `/api/events/${EVENT_ID}/holder-messages`) {
      if (request.method() === "POST") {
        posts.push(request.postDataJSON());
        sent += 1;
        return route.fulfill({
          status: 201,
          json: { messageId: `m${sent}`, recipientCount: 12, createdAt: new Date().toISOString(), replayed: false },
        });
      }
      return route.fulfill({ json: holderState(sent) });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return { posts };
}

for (const vp of [
  { width: 375, height: 740 },
  { width: 1280, height: 900 },
]) {
  test.describe(`message ticket holders at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test("compose, check, confirm and send; nothing scrolls sideways and the controls are 44px", async ({ page }) => {
      const { posts } = await organiserPage(page);
      await page.goto(`/dashboard/${EVENT_ID}`);
      const panel = page.getByRole("region", { name: "Message ticket holders" });
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel).toContainText("12 ticket holders · 2 left today · 5 left in total");
      await expect(panel.getByRole("listitem")).toContainText("Parking changes tonight");
      await expect(panel.getByRole("listitem")).toContainText("Sent 12 of 12");
      await noSidewaysScroll(page);

      const subject = panel.getByLabel("Subject");
      const body = panel.getByLabel("Message");
      const send = panel.getByRole("button", { name: "Send…" });
      for (const control of [subject, body, send]) {
        expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      // Links and addresses are refused before the dialog.
      await subject.fill("Doors now open at 7pm");
      await body.fill("Tickets and details at https://example.com/doors tonight");
      await send.click();
      await expect(panel.getByText("The message can't include links or web addresses.")).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await body.fill("Doors now open at 7pm instead of 8pm. See you there.");

      await send.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Send to 12 ticket holders?" })).toBeVisible();
      await expect(dialog).toContainText("Doors now open at 7pm instead of 8pm. See you there.");
      const box = await dialog.boundingBox();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vp.width);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(vp.height);
      await noSidewaysScroll(page);
      for (const control of [dialog.getByRole("checkbox"), dialog.getByRole("button", { name: "Send" }), dialog.getByRole("button", { name: "Cancel" })]) {
        const target = await control.evaluate((el) => {
          const rect = (el.closest("label") ?? el).getBoundingClientRect();
          return rect.height;
        });
        expect(target).toBeGreaterThanOrEqual(44);
      }

      // The tick box is required.
      await dialog.getByRole("button", { name: "Send" }).click();
      await expect(dialog.getByText("Tick the box to send.")).toBeVisible();
      expect(posts).toHaveLength(0);

      await dialog.getByLabel("This is about the event, not promotion").check();
      await dialog.getByRole("button", { name: "Send" }).click();
      await expect(panel.getByRole("status")).toHaveText("Sent to 12.");
      await expect(dialog).toBeHidden();
      await expect(subject).toHaveValue("");
      await expect(panel).toContainText("1 left today · 4 left in total");
      await expect(panel.getByRole("listitem").first()).toContainText("Parking changes tonight");
      expect(posts).toEqual([
        {
          requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          subject: "Doors now open at 7pm",
          body: "Doors now open at 7pm instead of 8pm. See you there.",
          attest: true,
          expectedRecipients: 12,
        },
      ]);
      await noSidewaysScroll(page);
    });
  });
}

function adminMessage(id: string, overrides: Partial<AdminHolderMessage> = {}): AdminHolderMessage {
  return {
    messageId: id,
    eventId: EVENT_ID,
    eventTitle: "Neon Static: warehouse night",
    organiserName: "Northside Noise",
    subject: `Doors now open at 7pm (${id})`,
    recipientCount: 40,
    sentCount: 12,
    skippedCount: 0,
    createdAt: new Date(now - DAY).toISOString(),
    cancelled: false,
    ...overrides,
  };
}

test.describe("admin: event messages", () => {
  for (const vp of [
    { width: 375, height: 740 },
    { width: 1280, height: 900 },
  ]) {
    test(`lists, shows the text and stops one at ${vp.width}px`, async ({ page }) => {
      await page.setViewportSize(vp);
      await commonRoutes(page, session("u-admin", "admin@sheltuh.example", { role: "admin" }));
      const stopped = new Set<string>();
      const cancels: string[] = [];
      const queries: string[] = [];
      await page.route("**/api/**", (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        if (path === "/api/admin/summary") {
          return route.fulfill({
            json: {
              reportsOpen: { count: 0, oldestAt: null },
              eventsPending: { count: 0, soonestStartsAt: null, startingSoon: 0, startingSoonHours: 72 },
              organisersPending: { count: 0, oldestAt: null },
              emailsFailed: { count: 0 },
              emailsRetrying: { count: 0 },
              doorEvents: { count: 0, windowHours: 24 },
              eventsPublishedByOrganisers: { count: 0, windowHours: 72 },
            },
          });
        }
        if (path === "/api/admin/holder-messages") {
          queries.push(url.search);
          if (url.searchParams.get("cursor")) return route.fulfill({ json: { items: [adminMessage("b")] } });
          return route.fulfill({
            json: {
              items: [adminMessage("a", { cancelled: stopped.has("a") }), adminMessage("c", { recipientCount: 3, sentCount: 3 })],
              nextCursor: "next",
            },
          });
        }
        const detailMatch = /^\/api\/admin\/holder-messages\/([^/]+)(\/cancel)?$/.exec(path);
        if (detailMatch) {
          const id = detailMatch[1];
          if (detailMatch[2]) {
            cancels.push(id);
            stopped.add(id);
          }
          const detail: AdminHolderMessageDetail = {
            ...adminMessage(id, { cancelled: stopped.has(id) }),
            body: "Doors now open at 7pm instead of 8pm. See you there.",
            ...(stopped.has(id) ? { cancelledAt: new Date().toISOString() } : {}),
          };
          return route.fulfill({ json: detail });
        }
        if (path === "/api/organisers/me") return route.fulfill({ status: 404, json: { error: "No organiser." } });
        if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Admin", suspended: false } });
        if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
        if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
        return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
      });

      // Reached from Emails.
      await page.goto("/admin/emails");
      await page.getByRole("link", { name: "Event messages" }).click();
      await expect(page).toHaveURL(/\/admin\/event-messages$/);
      await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: /^Emails/ })).toHaveAttribute(
        "aria-current",
        "true",
      );
      const list = page.getByRole("list").filter({ hasText: "Doors now open at 7pm (a)" });
      await expect(list).toBeVisible({ timeout: 30_000 });
      await expect(list.getByRole("listitem").first()).toContainText("Neon Static: warehouse night · Northside Noise");
      await expect(list.getByRole("listitem").first()).toContainText("Sent 12 of 40");
      await noSidewaysScroll(page);

      await page.getByRole("button", { name: "Load more" }).click();
      await expect(page.getByText("Doors now open at 7pm (b)")).toBeVisible();
      expect(queries.at(-1)).toBe("?cursor=next");

      await page.getByRole("button", { name: "Doors now open at 7pm (a)" }).click();
      await expect(page.getByText("Doors now open at 7pm instead of 8pm. See you there.")).toBeVisible();
      await noSidewaysScroll(page);

      await page.getByRole("button", { name: "Stop “Doors now open at 7pm (a)”" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Stop “Doors now open at 7pm (a)”?" })).toBeVisible();
      await noSidewaysScroll(page);
      expect(cancels).toEqual([]);
      await dialog.getByRole("button", { name: "Stop sending" }).click();
      await expect(dialog).toBeHidden();
      expect(cancels).toEqual(["a"]);
      await expect(list.getByRole("listitem").first()).toContainText("Sent 12 of 40 · Stopped");
      await expect(page.getByRole("button", { name: /^Stop “/ })).toHaveCount(0);
    });
  }
});
