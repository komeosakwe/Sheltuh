import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deps } from "@/lib/server/deps";
import { adminRejectEvent, adminUnpublishEvent } from "@/lib/server/handlers/admin";
import {
  CALENDAR_CACHE_CONTROL,
  eventCalendarRoute,
  getDemoEventCalendar,
  getEventCalendar,
} from "@/lib/server/handlers/event-calendar";
import { submitEventForReview } from "@/lib/server/handlers/events";
import { runHandler } from "@/lib/server/route";
import { SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/** Demo or live, as the route decides it (lib/api/client's isApiConfigured), and the live route's deps. */
const mode = vi.hoisted(() => ({ configured: false, deps: undefined as Deps | undefined }));
vi.mock("@/lib/api/client", () => ({
  get isApiConfigured() {
    return mode.configured;
  },
}));
vi.mock("@/lib/server/deps", () => ({
  getDeps: () => {
    if (!mode.deps) throw new Error("no deps");
    return mode.deps;
  },
}));

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  mode.configured = false;
  mode.deps = undefined;
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
});

/** A request for the route, from somewhere other than the configured site (the Host header is never trusted). */
const request = (slug: string, origin = "https://elsewhere.test") => new Request(`${origin}/events/${slug}/calendar.ics`);

async function getIcs(slug: string) {
  const res = await runHandler(getEventCalendar, request(slug), { slug }, api.deps);
  return { status: res.status, headers: res.headers, text: await res.text() };
}

/** Unfolds an .ics file into its logical lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");

describe("GET /events/{slug}/calendar.ics (live)", () => {
  it("serves a published event inline as text/calendar, with a short public cache", async () => {
    const event = await publishedEvent(api, organiser, admin, { title: "Dub; Roots, Late" });
    const res = await getIcs(event.slug);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="${event.slug}.ics"`);
    expect(res.headers.get("cache-control")).toBe(CALENDAR_CACHE_CONTROL);
    expect(CALENDAR_CACHE_CONTROL).toBe("public, max-age=300, s-maxage=300");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const lines = unfold(res.text);
    expect(res.text.endsWith("\r\n")).toBe(true);
    expect(lines).toContain("BEGIN:VEVENT");
    // The same UID the page would give it (the event id), so adding it twice updates the entry.
    expect(lines).toContain(`UID:${event.eventId}@sheltuh.com.au`);
    // Sat 6 Mar 2027, 8 pm to 11:30 pm in Melbourne (AEDT, UTC+11).
    expect(lines).toContain("DTSTART:20270306T090000Z");
    expect(lines).toContain("DTEND:20270306T123000Z");
    expect(lines).toContain("SUMMARY:Dub\\; Roots\\, Late");
    expect(lines).toContain("LOCATION:The Tote\\, 71 Johnston St");
    // The configured site's public page, never the request's own host.
    expect(lines).toContain(`URL:${SITE_URL}/events/${event.slug}`);
    expect(res.text).not.toContain("elsewhere.test");
    expect(lines.find((line) => line.startsWith("DTSTAMP:"))).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
  });

  it("holds only what the public page shows: no organiser, contact, status or ticket data", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const { text } = await getIcs(event.slug);
    const props = unfold(text)
      .filter(Boolean)
      .map((line) => line.split(":")[0]);
    expect(props).toEqual([
      "BEGIN",
      "VERSION",
      "PRODID",
      "CALSCALE",
      "METHOD",
      "BEGIN",
      "UID",
      "DTSTAMP",
      "DTSTART",
      "DTEND",
      "SUMMARY",
      "LOCATION",
      "URL",
      "DESCRIPTION",
      "END",
      "END",
    ]);
    expect(text).not.toContain(organiser.organiserId);
    expect(text).not.toContain("@example.com");
  });

  it("is a 404 for draft, pending, rejected, unpublished and unknown events, never cached", async () => {
    const draft = await draftEvent(api, organiser);
    const pending = await draftEvent(api, organiser);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: pending.eventId }, method: "POST" });
    const rejected = await draftEvent(api, organiser);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: rejected.eventId }, method: "POST" });
    await api.call(adminRejectEvent, { token: admin.token, params: { eventId: rejected.eventId }, body: { reason: "x" } });
    const unpublished = await publishedEvent(api, organiser, admin);
    expect((await getIcs(unpublished.slug)).status).toBe(200);
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: unpublished.eventId }, method: "POST" });

    for (const slug of [draft.slug, pending.slug, rejected.slug, unpublished.slug, "never-existed", "NEON'; --"]) {
      const res = await getIcs(slug);
      expect(res.status, slug).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(JSON.parse(res.text)).toEqual({ error: "Event not found." });
    }
  });

  it("the route export serves the database in live mode", async () => {
    const event = await publishedEvent(api, organiser, admin);
    mode.configured = true;
    mode.deps = api.deps;
    const ok = await eventCalendarRoute(request(event.slug), { params: Promise.resolve({ slug: event.slug }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(await ok.text()).toContain(`UID:${event.eventId}@sheltuh.com.au`);
    // A demo slug isn't an event in live mode.
    const demo = await eventCalendarRoute(request("thornbury-dub-session"), {
      params: Promise.resolve({ slug: "thornbury-dub-session" }),
    });
    expect(demo.status).toBe(404);
  });
});

describe("GET /events/{slug}/calendar.ics (demo)", () => {
  it("serves a sample event, linked to the request's own origin, with the same headers", async () => {
    const res = await getDemoEventCalendar(request("thornbury-dub-session", "https://preview.sheltuh.test"), {
      slug: "thornbury-dub-session",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="thornbury-dub-session.ics"');
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    const lines = unfold(await res.text());
    expect(lines).toContain("UID:evt-thornbury-dub-session@sheltuh.com.au");
    expect(lines).toContain("DTSTART:20261107T083000Z");
    expect(lines).toContain("URL:https://preview.sheltuh.test/events/thornbury-dub-session");
  });

  it("is a 404 for an unknown slug", async () => {
    const res = await getDemoEventCalendar(request("never-existed"), { slug: "never-existed" });
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Event not found." });
  });

  it("the route export reads the sample events (and never the database) without Supabase configured", async () => {
    const res = await eventCalendarRoute(request("neon-static"), { params: Promise.resolve({ slug: "neon-static" }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("UID:evt-neon-static@sheltuh.com.au");
    const missing = await eventCalendarRoute(request("nope"), { params: Promise.resolve({ slug: "nope" }) });
    expect(missing.status).toBe(404);
  });
});
