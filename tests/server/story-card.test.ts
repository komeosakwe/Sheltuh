import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventBySlug } from "@/lib/data";
import type { Deps } from "@/lib/server/deps";
import { adminApproveEvent, adminRejectEvent, adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { putEventImage } from "@/lib/server/handlers/event-images";
import { submitEventForReview } from "@/lib/server/handlers/events";
import {
  demoStoryCard,
  getStoryCard,
  STORY_CARD_BUSY_RETRY_SECONDS,
  STORY_CARD_RATE_LIMIT,
  storyCardCacheControl,
  storyCardFormat,
  storyCardHandler,
  storyCardRoute,
} from "@/lib/server/handlers/story-card";
import { runHandler, type Handler } from "@/lib/server/route";
import { inStoryCardSlot, STORY_CARD_RENDER_SLOTS, type StoryCardRequest } from "@/lib/server/story-card-render";
import { STORY_CARD_MAX_FRESH_SECONDS, storyCardFreshSeconds } from "@/lib/story-card";
import { SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, insertOrder, publishedEvent, setUpPayouts, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * GET /events/{slug}/story-card (lib/server/handlers/story-card.ts; docs/architecture.md, "Story
 * card"). Most cases draw with a stand-in (`make`), so they're fast and count the draws; a few
 * draw real cards with next/og and sharp.
 */

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
  await setUpPayouts(api, organiser.organiserId);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const IP = "203.0.113.7";
const OTHER_IP = "198.51.100.9";

/** A stand-in for the drawing: records each request, returns fixed bytes. */
function fakeMake() {
  return vi.fn<(request: StoryCardRequest) => Promise<Buffer>>(async () => Buffer.from("not really a jpeg"));
}

function request(slug: string, query = "?format=story", headers: Record<string, string> = {}) {
  return new Request(`${SITE_URL}/events/${slug}/story-card${query}`, { headers });
}

async function get(
  handler: Handler<{ slug: string }>,
  slug: string,
  { query = "?format=story", headers = {} }: { query?: string; headers?: Record<string, string> } = {},
) {
  return runHandler(handler, request(slug, query, headers), { slug }, api.deps);
}

/** A 1200 × 1600 photo (portrait: full-bleed on both formats), as an organiser would upload it. */
async function photo(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 40, g: 90, b: 160 } } })
    .jpeg()
    .toBuffer();
}

/** A published event with a photo (focus 30/40), through the organiser's own upload and an admin's approval. */
async function publishedWithPhoto(overrides: Record<string, unknown> = {}) {
  const draft = await draftEvent(api, organiser, overrides);
  const put = await api.send(
    putEventImage,
    new Request(`${SITE_URL}/api/test?fx=30&fy=40`, {
      method: "PUT",
      headers: { authorization: `Bearer ${organiser.token}` },
      body: new Uint8Array(await photo()),
    }),
    { eventId: draft.eventId },
  );
  expect(put.status).toBe(200);
  const params = { eventId: draft.eventId };
  await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
  await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });
  return draft;
}

async function setTimes(eventId: string, startsAt: string, endsAt: string | null) {
  await api.db.query(`update public.events set starts_at = $2, ends_at = $3 where id = $1`, [eventId, startsAt, endsAt]);
}

const sMaxAge = (res: Response) => Number(/s-maxage=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1]);

describe("GET /events/{slug}/story-card (live)", () => {
  it("draws a published, upcoming event's story card as a JPEG, shared at the CDN until the tag can change", async () => {
    const event = await publishedWithPhoto();
    const before = new Date();
    const res = await get(getStoryCard, event.slug);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toMatch(/^public, max-age=0, s-maxage=\d+$/);
    // At most an hour, and never past the next change of the tag (midnight in Melbourne, here).
    expect(sMaxAge(res)).toBeGreaterThanOrEqual(1);
    expect(sMaxAge(res)).toBeLessThanOrEqual(STORY_CARD_MAX_FRESH_SECONDS);
    expect(sMaxAge(res)).toBeLessThanOrEqual(storyCardFreshSeconds(event, before));
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-z]+"$/);
    expect(res.headers.get("content-disposition")).toBe(`inline; filename="sheltuh-${event.slug}-story.jpg"`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    // No shared answer depends on who asks, so nothing varies on a header.
    expect(res.headers.get("vary")).toBeNull();
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1080, 1920]);
  });

  it("draws the square post for ?format=square, with its own ETag and file name", async () => {
    const event = await publishedWithPhoto();
    const make = fakeMake();
    const handler = storyCardHandler({ make });
    const story = await get(handler, event.slug);
    const square = await get(getStoryCard, event.slug, { query: "?format=square" });
    expect(square.status).toBe(200);
    expect(square.headers.get("content-disposition")).toBe(`inline; filename="sheltuh-${event.slug}-square.jpg"`);
    expect(square.headers.get("etag")).not.toBe(story.headers.get("etag"));
    const meta = await sharp(Buffer.from(await square.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1080, 1080]);
    expect(make.mock.calls[0][0].format).toBe("story");
  });

  it("hands the drawing only the card's public words, tag and photo: no buyer, organiser, order or price", async () => {
    const event = await publishedWithPhoto({ title: "Neon Static" });
    await insertOrder(api, event, "buyer.private@example.com");
    const make = fakeMake();
    const res = await get(storyCardHandler({ make, now: () => new Date("2027-03-03T01:00:00Z") }), event.slug);
    expect(res.status).toBe(200);
    expect(make).toHaveBeenCalledTimes(1);
    const drawn = make.mock.calls[0][0];
    expect(Object.keys(drawn).sort()).toEqual(["format", "photo", "tag", "text"]);
    expect(drawn.text).toEqual({ title: "Neon Static", date: "Sat 6 Mar", time: "8–11:30 pm", place: "The Tote, Collingwood" });
    expect(drawn.tag).toBe("In 3 days");
    expect(Object.keys(drawn.photo ?? {}).sort()).toEqual(["bytes", "focus"]);
    expect(drawn.photo?.focus).toEqual({ x: 30, y: 40 });
    const words = JSON.stringify({ text: drawn.text, tag: drawn.tag });
    for (const secret of ["buyer.private", "@example.com", organiser.organiserId, event.eventId, "$", "30.00", "General admission"]) {
      expect(words).not.toContain(secret);
    }
  });

  it("draws the no-photo card for an event without one", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const make = fakeMake();
    const res = await get(storyCardHandler({ make }), event.slug);
    expect(res.status).toBe(200);
    expect(make.mock.calls[0][0].photo).toBeNull();
  });

  describe("the CDN window (storyCardFreshSeconds)", () => {
    // Melbourne is on AEDT (UTC+11) in March 2027.
    it.each([
      ["far off: the hour", "2027-03-06T01:00:00Z", "2027-03-10T09:00:00Z", "2027-03-10T12:00:00Z", 3600],
      ["starting in 10 minutes: until the start (Today becomes On now)", "2027-03-06T01:00:00Z", "2027-03-06T01:10:00Z", "2027-03-06T04:00:00Z", 600],
      ["on now, ending in 20 minutes: until the end", "2027-03-06T01:00:00Z", "2027-03-05T23:00:00Z", "2027-03-06T01:20:00Z", 1200],
      ["at 11:30 pm local: until midnight (In 4 days becomes In 3 days)", "2027-03-06T12:30:00Z", "2027-03-10T09:00:00Z", "2027-03-10T12:00:00Z", 1800],
    ])("%s", async (_name, now, startsAt, endsAt, expected) => {
      const event = await publishedEvent(api, organiser, admin);
      await setTimes(event.eventId, startsAt, endsAt);
      const res = await get(storyCardHandler({ make: fakeMake(), now: () => new Date(now) }), event.slug);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe(storyCardCacheControl(expected));
      expect(sMaxAge(res)).toBe(expected);
    });

    it("uses midnight in the event's own zone (Perth), not Melbourne's", async () => {
      const event = await publishedEvent(api, organiser, admin, { suburb: "Northbridge", state: "WA", timeZone: "Australia/Perth", venueName: "The Bird" });
      await setTimes(event.eventId, "2027-03-10T12:00:00Z", "2027-03-10T15:00:00Z");
      // 23:40 in Perth (UTC+8), 02:40 the next day in Melbourne: Perth's midnight is 20 minutes away.
      const res = await get(storyCardHandler({ make: fakeMake(), now: () => new Date("2027-03-06T15:40:00Z") }), event.slug);
      expect(res.status).toBe(200);
      expect(sMaxAge(res)).toBe(1200);
    });

    it("takes the time spent drawing off the window, so a card drawn across a tag change isn't kept past it", async () => {
      const event = await publishedEvent(api, organiser, admin);
      await setTimes(event.eventId, "2027-03-06T01:10:00Z", "2027-03-06T04:00:00Z");
      let at = Date.parse("2027-03-06T01:00:00Z");
      const make = vi.fn(async () => {
        at += 599_500; // the drawing ends half a second before the start
        return Buffer.from("x");
      });
      const res = await get(storyCardHandler({ make, now: () => new Date(at) }), event.slug);
      expect(sMaxAge(res)).toBe(1);
    });
  });

  describe("ETag and If-None-Match", () => {
    it("answers a matching If-None-Match with a 304 and the same headers, drawing nothing and reading no photo", async () => {
      const event = await publishedWithPhoto();
      const make = fakeMake();
      const handler = storyCardHandler({ make, now: () => new Date("2027-03-03T01:00:00Z") });
      const first = await get(handler, event.slug, { headers: { "x-forwarded-for": IP } });
      const etag = first.headers.get("etag") ?? "";
      expect(make).toHaveBeenCalledTimes(1);

      const query = vi.spyOn(api.db, "query");
      for (const header of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
        const res = await get(handler, event.slug, { headers: { "if-none-match": header, "x-forwarded-for": IP } });
        expect([header, res.status]).toEqual([header, 304]);
        expect(await res.text()).toBe("");
        for (const name of ["cache-control", "etag", "content-type", "content-disposition", "x-content-type-options"]) {
          expect([name, res.headers.get(name)]).toEqual([name, first.headers.get(name)]);
        }
      }
      expect(make).toHaveBeenCalledTimes(1);
      // Each 304 is one read of the card's fields: no photo bytes, no rate-limit hit.
      const sql = query.mock.calls.map(([text]) => text);
      expect(sql).toHaveLength(4);
      expect(sql.some((text) => /i\.data|take_client_rate_limit/.test(text))).toBe(false);

      // Another tag, a stale one, or a malformed header gets the card.
      for (const header of ['"nope"', etag.slice(0, -2) + '"', "garbage"]) {
        expect((await get(handler, event.slug, { headers: { "if-none-match": header } })).status).toBe(200);
      }
    });

    it("gets a new ETag when the title, place, photo, focus, day or format changes, and keeps it otherwise", async () => {
      const event = await publishedWithPhoto();
      let now = new Date("2027-03-03T01:00:00Z");
      const handler = storyCardHandler({ make: fakeMake(), now: () => now });
      const etag = async (query = "?format=story") => (await get(handler, event.slug, { query })).headers.get("etag");
      const seen = new Set<string | null>();
      const changed = async () => {
        const tag = await etag();
        expect(seen.has(tag)).toBe(false);
        seen.add(tag);
      };

      await changed();
      expect(await etag()).toBe([...seen][0]);
      // Something the card doesn't show (the description) changes nothing.
      await api.db.query(`update public.events set description = 'Something else entirely.' where id = $1`, [event.eventId]);
      expect(seen.has(await etag())).toBe(true);

      await api.db.query(`update public.events set title = 'Neon Static II' where id = $1`, [event.eventId]);
      await changed();
      await api.db.query(`update public.events set venue_name = 'The Corner' where id = $1`, [event.eventId]);
      await changed();
      await api.db.query(`update public.event_images set focus_x = 70 where event_id = $1`, [event.eventId]);
      await changed();
      await api.db.query(`update public.event_images set updated_at = updated_at + interval '5 seconds' where event_id = $1`, [
        event.eventId,
      ]);
      await changed();
      now = new Date("2027-03-04T01:00:00Z"); // In 3 days → In 2 days
      await changed();
      expect(seen.has(await etag("?format=square"))).toBe(false);
    });
  });

  it("is the same 404 for draft, pending, rejected, unpublished, ended, unknown and malformed, never cached and never drawn", async () => {
    const draft = await draftEvent(api, organiser);
    const pending = await draftEvent(api, organiser);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: pending.eventId }, method: "POST" });
    const rejected = await draftEvent(api, organiser);
    await api.call(submitEventForReview, { token: organiser.token, params: { eventId: rejected.eventId }, method: "POST" });
    await api.call(adminRejectEvent, { token: admin.token, params: { eventId: rejected.eventId }, body: { reason: "x" } });
    const unpublished = await publishedWithPhoto();
    await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: unpublished.eventId }, method: "POST" });
    const ended = await publishedEvent(api, organiser, admin);
    await api.db.query(`update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 second' where id = $1`, [
      ended.eventId,
    ]);
    const make = fakeMake();
    const handler = storyCardHandler({ make });

    for (const slug of [draft.slug, pending.slug, rejected.slug, unpublished.slug, ended.slug, "never-existed", "NEON'; --", "a".repeat(201)]) {
      const callers: Record<string, string>[] = [{}, { authorization: `Bearer ${admin.token}` }, { authorization: `Bearer ${organiser.token}` }];
      for (const headers of callers) {
        const res = await get(handler, slug, { headers });
        expect([slug, res.status]).toEqual([slug, 404]);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(res.headers.get("etag")).toBeNull();
        expect(await res.json()).toEqual({ error: "Event not found." });
      }
    }
    expect(make).not.toHaveBeenCalled();
  });

  it("is a 404, not a card without its photo, when the event is unpublished between reading it and its photo", async () => {
    const event = await publishedWithPhoto();
    const make = fakeMake();
    // The photo read (findPublicEventCover) finds nothing, as it would once the event is unpublished.
    const db = { query: (text: string, params?: unknown[]) => (/\bi\.data\b/.test(text) ? Promise.resolve([]) : api.db.query(text, params)) };
    const res = await runHandler(storyCardHandler({ make }), request(event.slug), { slug: event.slug }, { ...api.deps, db } as Deps);
    expect(res.status).toBe(404);
    expect(make).not.toHaveBeenCalled();
  });

  it.each([
    ["no query", ""],
    ["an unknown format", "?format=reel"],
    ["a format in capitals", "?format=STORY"],
    ["an empty format", "?format="],
    ["format twice", "?format=story&format=story"],
    ["another parameter beside format", "?format=story&x=1"],
    ["a cache-busting parameter alone", "?v=123"],
    ["an RSC parameter", "?format=story&_rsc=abc"],
  ])("refuses %s with a 400 naming format, before any read, never cached", async (_name, query) => {
    const event = await publishedEvent(api, organiser, admin);
    const make = fakeMake();
    const queries = vi.spyOn(api.db, "query");
    const res = await get(storyCardHandler({ make }), event.slug, { query });
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await res.json()).fieldErrors.format).toMatch(/format=story or \?format=square/);
    expect(queries).not.toHaveBeenCalled();
    expect(make).not.toHaveBeenCalled();
  });

  it("reads the format strictly", () => {
    expect(storyCardFormat(`${SITE_URL}/events/x/story-card?format=story`)).toBe("story");
    expect(storyCardFormat(`${SITE_URL}/events/x/story-card?format=square`)).toBe("square");
    expect(() => storyCardFormat(`${SITE_URL}/events/x/story-card?format=story#x`)).not.toThrow();
  });

  it(`limits a client to ${STORY_CARD_RATE_LIMIT.hits} draws per ${STORY_CARD_RATE_LIMIT.window}, with Retry-After; 304s don't count`, async () => {
    expect(STORY_CARD_RATE_LIMIT).toEqual({ bucket: "story_cards", hits: 20, window: "10 minutes" });
    const event = await publishedEvent(api, organiser, admin);
    const make = fakeMake();
    const handler = storyCardHandler({ make });
    const headers = { "x-forwarded-for": IP };
    let etag = "";
    for (let i = 0; i < STORY_CARD_RATE_LIMIT.hits; i += 1) {
      const res = await get(handler, event.slug, { headers, query: i % 2 ? "?format=square" : "?format=story" });
      expect(res.status).toBe(200);
      if (i === 0) etag = res.headers.get("etag") ?? "";
    }
    // A revalidation still gets its 304 (it draws nothing).
    expect((await get(handler, event.slug, { headers: { ...headers, "if-none-match": etag } })).status).toBe(304);

    const refused = await get(handler, event.slug, { headers });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("600");
    expect(refused.headers.get("cache-control")).toBe("private, no-store");
    expect(make).toHaveBeenCalledTimes(STORY_CARD_RATE_LIMIT.hits);

    // Another client is unaffected.
    expect((await get(handler, event.slug, { headers: { "x-forwarded-for": OTHER_IP } })).status).toBe(200);
  });

  it("fails open without a client IP (as every per-client limit does)", async () => {
    const event = await publishedEvent(api, organiser, admin);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = storyCardHandler({ make: fakeMake() });
    for (let i = 0; i <= STORY_CARD_RATE_LIMIT.hits; i += 1) {
      expect((await get(handler, event.slug)).status).toBe(200);
    }
  });

  it("is a 503 with Retry-After when the render slots are full, and draws nothing", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const total = STORY_CARD_RENDER_SLOTS.running + STORY_CARD_RENDER_SLOTS.waiting;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = Array.from({ length: total }, () => inStoryCardSlot(() => gate));
    try {
      const res = await get(getStoryCard, event.slug);
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe(String(STORY_CARD_BUSY_RETRY_SECONDS));
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect((await res.json()).error).toMatch(/Lots of cards/);
    } finally {
      release();
      await Promise.all(held);
    }
  });

  it("is a 500 (logged without details) when the drawing fails", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get(storyCardHandler({ make: async () => Promise.reject(new Error("satori broke")) }), event.slug);
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Something went wrong." });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("reads no token or cookie: a signed-in caller gets the same answer as anyone", async () => {
    const event = await publishedWithPhoto();
    const make = fakeMake();
    const handler = storyCardHandler({ make, now: () => new Date("2027-03-03T01:00:00Z") });
    const responses: Response[] = [];
    const callers: Record<string, string>[] = [
      {},
      { authorization: `Bearer ${admin.token}` },
      { authorization: `Bearer ${organiser.token}`, cookie: "sb-access-token=x" },
      { authorization: "Bearer not-a-token" },
    ];
    for (const headers of callers) {
      responses.push(await get(handler, event.slug, { headers }));
    }
    const shapes = await Promise.all(
      responses.map(async (res) => ({ status: res.status, headers: [...res.headers.entries()], body: await res.text() })),
    );
    for (const shape of shapes) expect(shape).toEqual(shapes[0]);
    expect(shapes[0].status).toBe(200);
    for (const call of make.mock.calls) expect(call).toEqual(make.mock.calls[0]);
  });
});

describe("GET /events/{slug}/story-card (demo)", () => {
  it("draws a sample event with its public/events photo, at the demo clock (In 3 days), with no rate limit", async () => {
    const sample = await getEventBySlug("neon-static");
    expect(sample?.imageUrl).toMatch(/^\/events\//);
    const make = fakeMake();
    const handler = demoStoryCard({ make, now: () => new Date("2026-11-24T00:00:00Z") });
    for (let i = 0; i <= STORY_CARD_RATE_LIMIT.hits; i += 1) {
      const res = await handler(request("neon-static", "?format=story", { "x-forwarded-for": IP }), { slug: "neon-static" });
      expect(res.status).toBe(200);
    }
    const drawn = make.mock.calls[0][0];
    // The sample is past (25 Sep 2026): the card is drawn as if 3 days before it.
    expect(drawn.tag).toBe("In 3 days");
    expect(drawn.text.title).toBe("Neon Static");
    const file = await readFile(path.join(process.cwd(), "public", sample?.imageUrl ?? ""));
    expect(Buffer.from(drawn.photo?.bytes ?? []).equals(file)).toBe(true);
  });

  it("serves a real JPEG through the route export, and the demo's 304, 400 and 404", async () => {
    const route = (slug: string, query = "?format=square", headers: Record<string, string> = {}) =>
      storyCardRoute(request(slug, query, headers), { params: Promise.resolve({ slug }) });
    const res = await route("neon-static");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toMatch(/^public, max-age=0, s-maxage=\d+$/);
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1080, 1080]);

    expect((await route("neon-static", "?format=square", { "if-none-match": res.headers.get("etag") ?? "" })).status).toBe(304);
    const bad = await route("neon-static", "?format=square&x=1");
    expect(bad.status).toBe(400);
    expect(bad.headers.get("cache-control")).toBe("private, no-store");
    const missing = await route("never-existed");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Event not found." });
  });

  it("the route export takes the live branch once Supabase is configured", async () => {
    const event = await publishedEvent(api, organiser, admin);
    mode.configured = true;
    mode.deps = api.deps;
    // A sample event's slug means nothing live.
    const slug = "paper-moon-ceramics-lab";
    const sample = await storyCardRoute(request(slug), { params: Promise.resolve({ slug }) });
    expect(sample.status).toBe(404);
    const live = await storyCardRoute(request(event.slug, "?format=story&x=1"), { params: Promise.resolve({ slug: event.slug }) });
    expect(live.status).toBe(400);
  });
});
