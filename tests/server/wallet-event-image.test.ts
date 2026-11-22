import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import { getEventImage } from "@/lib/server/handlers/event-images";
import { getAppleWalletPass, getGoogleWalletPass } from "@/lib/server/handlers/wallet";
import type { Db } from "@/lib/server/db";
import type { EventRecord } from "@/lib/server/types";
import { buildApplePass } from "@/lib/server/wallet/apple";
import { appleWalletConfigFromEnv, googleWalletConfigFromEnv, type AppleWalletConfig, type GoogleWalletConfig } from "@/lib/server/wallet/config";
import {
  APPLE_STRIP_CACHE_SIZE,
  APPLE_STRIP_SIZES,
  appleEventStrip,
  clearAppleStripCache,
  cropAppleStrip,
  googleEventHeroUri,
  walletImageVersion,
} from "@/lib/server/wallet/event-image";
import { buildGoogleSaveJwt, GOOGLE_HERO_PATH, GOOGLE_SAVE_URL_BASE, GOOGLE_SAVE_URL_MAX, googleSaveUrl } from "@/lib/server/wallet/google";
import { APPLE_PASS_IMAGES } from "@/lib/server/wallet/images";
import { embeddedSession, sessionAmount, SITE_URL, stripeWebhookRequest, TestApi } from "./helpers/api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { jpegWithGps, pngChunks, pngWithTextChunks } from "./helpers/images";
import { createTestDb } from "./helpers/test-db";
import { appleWalletEnv, decodeJwt, googleWalletEnv, readZip, sampleTicket, TEST_EVENT_ID, verifyDetachedSignature } from "./helpers/wallet";

// The passes' image band from the event's own photo (lib/server/wallet/event-image.ts): Apple's strip made
// from the stored photo, Google's hero the photo's public URL on the site, and the Sheltüh band whenever
// there's no photo or it can't be used. A pass is never refused for its picture.

const IP = "203.0.113.9";

let api: TestApi;
let reset: () => Promise<void>;
let event: EventRecord;
let intents = 0;

const googleCreds = googleWalletEnv();
const apple = appleWalletEnv();
const googleConfig = (googleWalletConfigFromEnv(googleCreds.env) as { config: GoogleWalletConfig }).config;
const appleConfig = (appleWalletConfigFromEnv(apple.env) as { config: AppleWalletConfig }).config;

const STAND_IN = {
  "strip.png": Buffer.from(APPLE_PASS_IMAGES["strip.png"], "base64"),
  "strip@2x.png": Buffer.from(APPLE_PASS_IMAGES["strip@2x.png"], "base64"),
  "strip@3x.png": Buffer.from(APPLE_PASS_IMAGES["strip@3x.png"], "base64"),
};
const STRIP_FILES = Object.keys(STAND_IN) as (keyof typeof STAND_IN)[];

/** A photo whose top half is red and bottom half blue (600 × 400), so where it's cropped shows in the strip. */
async function twoTonePhoto(format: "jpeg" | "png" = "jpeg"): Promise<Buffer> {
  const half = (r: number, g: number, b: number) =>
    sharp({ create: { width: 600, height: 200, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const pipeline = sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 0, g: 0, b: 0 } } }).composite([
    { input: await half(230, 20, 20), top: 0, left: 0 },
    { input: await half(20, 20, 230), top: 200, left: 0 },
  ]);
  return format === "png" ? pipeline.png().toBuffer() : pipeline.jpeg({ quality: 95 }).toBuffer();
}

/** The mean colour of a PNG. */
async function meanColour(png: Buffer) {
  const { channels } = await sharp(png).stats();
  return { r: Math.round(channels[0].mean), g: Math.round(channels[1].mean), b: Math.round(channels[2].mean) };
}

async function storePhoto(eventId: string, bytes: Buffer, contentType = "image/jpeg", focus?: { x: number; y: number }) {
  await api.db.query(
    `insert into public.event_images (event_id, content_type, data, focus_x, focus_y) values ($1, $2, $3, $4, $5)`,
    [eventId, contentType, bytes, focus?.x ?? null, focus?.y ?? null],
  );
  const [row] = await api.db.query<{ v: string }>(
    `select floor(extract(epoch from updated_at))::bigint::text as v from public.event_images where event_id = $1`,
    [eventId],
  );
  return `/api/events/${eventId}/image?v=${row.v}`;
}

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  clearAppleStripCache();
  api = new TestApi(api.db);
  api.googleWallet = googleConfig;
  api.appleWallet = appleConfig;
  const admin = await signUpAdmin(api);
  const organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin, {
    ticketTypes: [{ id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 20 }],
  });
  await enablePayouts(api, organiser.organiserId);
  let sessions = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => embeddedSession(`cs_test_${++sessions}`));
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function paidOrder(quantity = 1) {
  await api.call(createCheckout, { params: { eventId: event.eventId }, body: { lineItems: [{ ticketTypeId: "ga", quantity }] } });
  const orderId = api.stripe.checkout.sessions.create.mock.calls.at(-1)![0].client_reference_id as string;
  const paymentIntent = `pi_test_img_${++intents}`;
  const res = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${paymentIntent}`,
          object: "checkout.session",
          client_reference_id: orderId,
          ...(await sessionAmount(api.db, orderId)),
          payment_status: "paid",
          payment_intent: paymentIntent,
          customer_details: { email: "buyer@example.com" },
        },
      },
    }),
  );
  expect(res.status).toBe(200);
  return orderId;
}

const pass = (handler: typeof getAppleWalletPass, orderId: string, ticket = "1") =>
  api.callRaw(handler, { params: { sessionId: orderId }, query: { ticket }, headers: { "x-forwarded-for": IP } });

/** The .pkpass's files, after checking the manifest hashes every file and the signature covers the manifest. */
async function applePassFiles(orderId: string, ticket = "1") {
  const res = await pass(getAppleWalletPass, orderId, ticket);
  expect(res.status).toBe(200);
  const files = readZip(Buffer.from(await res.arrayBuffer()));
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as Record<string, string>;
  expect(Object.keys(manifest).sort()).toEqual([...files.keys()].filter((n) => n !== "manifest.json" && n !== "signature").sort());
  for (const [name, sha1] of Object.entries(manifest)) expect(createHash("sha1").update(files.get(name)!).digest("hex"), name).toBe(sha1);
  verifyDetachedSignature(files.get("signature")!, files.get("manifest.json")!, apple.signerPem, apple.wwdrPem);
  return files;
}

async function googleClaims(orderId: string) {
  const res = await pass(getGoogleWalletPass, orderId);
  expect(res.status).toBe(302);
  const { claims, verified } = decodeJwt(res.headers.get("location")!.slice(GOOGLE_SAVE_URL_BASE.length), googleCreds.keys.publicKey);
  expect(verified).toBe(true);
  return { cls: claims.payload.eventTicketClasses[0], object: claims.payload.eventTicketObjects[0] };
}

const silenceWarnings = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);

describe("an event with a photo", () => {
  it("Apple: the strip is the photo, cover-cropped at the strip's three sizes as PNGs without metadata, hashed and signed", async () => {
    await storePhoto(event.eventId, await jpegWithGps({ serial: true }));
    const files = await applePassFiles(await paidOrder());
    for (const name of STRIP_FILES) {
      const strip = files.get(name)!;
      expect(strip.equals(STAND_IN[name]), name).toBe(false);
      const meta = await sharp(strip).metadata();
      expect(meta.format).toBe("png");
      expect({ width: meta.width, height: meta.height }).toEqual(APPLE_STRIP_SIZES[name]);
      // Pixels and a palette only: no text, EXIF, ICC or time chunks.
      expect(pngChunks(strip).filter((c) => !["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(c)), name).toEqual([]);
      expect(strip.includes(Buffer.from("SpyCam"))).toBe(false);
      // jpegWithGps is solid Signal-Orange-ish (220, 72, 0): the strip is that photo, not the black stand-in.
      const { r, g, b } = await meanColour(strip);
      expect(r).toBeGreaterThan(180);
      expect(b).toBeLessThan(40);
      expect(g).toBeLessThan(110);
    }
    // The stand-in's sizes are the strip's: 375 × 98 pt at 1x, 2x and 3x.
    expect(APPLE_STRIP_SIZES).toEqual({
      "strip.png": { width: 375, height: 98 },
      "strip@2x.png": { width: 750, height: 196 },
      "strip@3x.png": { width: 1125, height: 294 },
    });
    // The rest of the pass is unchanged.
    for (const name of ["icon.png", "logo@3x.png"] as const) {
      expect(files.get(name)!.equals(Buffer.from(APPLE_PASS_IMAGES[name], "base64"))).toBe(true);
    }
  });

  it("Apple: the crop follows the photo's focus point (the middle without one)", async () => {
    const photo = await twoTonePhoto();
    const top = await cropAppleStrip(photo, { x: 50, y: 0 });
    const bottom = await cropAppleStrip(photo, { x: 50, y: 100 });
    const middle = await cropAppleStrip(photo);
    const red = await meanColour(top["strip@3x.png"]);
    const blue = await meanColour(bottom["strip@3x.png"]);
    const both = await meanColour(middle["strip@3x.png"]);
    expect(red.r).toBeGreaterThan(200);
    expect(red.b).toBeLessThan(50);
    expect(blue.b).toBeGreaterThan(200);
    expect(blue.r).toBeLessThan(50);
    // Half and half across the middle.
    expect(both.r).toBeGreaterThan(90);
    expect(both.b).toBeGreaterThan(90);

    // Through the route: the stored focus point is used.
    await storePhoto(event.eventId, photo, "image/jpeg", { x: 50, y: 100 });
    const files = await applePassFiles(await paidOrder());
    expect((await meanColour(files.get("strip@2x.png")!)).b).toBeGreaterThan(200);
  });

  it("Apple: a PNG's text chunks don't survive, and transparency sits on the pass's white", async () => {
    const strip = await cropAppleStrip(await pngWithTextChunks());
    for (const name of STRIP_FILES) {
      expect(pngChunks(strip[name]).filter((c) => !["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(c)), name).toEqual([]);
      expect(strip[name].includes(Buffer.from("Fitzroy"))).toBe(false);
      expect((await sharp(strip[name]).metadata()).hasAlpha).toBe(false);
    }
  });

  it("Google: the object's hero is the photo's public URL on the site (served by the image route), described by the event's title; the class keeps the stand-in", async () => {
    const path = await storePhoto(event.eventId, await twoTonePhoto());
    const { cls, object } = await googleClaims(await paidOrder());
    expect(object.heroImage).toEqual({
      sourceUri: { uri: `${SITE_URL}${path}` },
      contentDescription: { defaultValue: { language: "en-AU", value: "Neon Static" } },
    });
    // The class is per event, but Google keeps the first one it was given: the photo goes on each ticket's object.
    expect(cls.heroImage.sourceUri.uri).toBe(`${SITE_URL}${GOOGLE_HERO_PATH}`);
    // That URL is the public image route's, at its current version, for anyone (Google fetches it without signing in).
    const v = new URL(object.heroImage.sourceUri.uri).searchParams.get("v")!;
    const image = await (await import("@/lib/server/route")).runHandler(
      getEventImage,
      new Request(`${SITE_URL}/api/events/${event.eventId}/image?v=${v}`),
      { eventId: event.eventId },
      api.deps,
    );
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/jpeg");
    expect(image.headers.get("cache-control")).toMatch(/^public/);
  });

  it("the strip is made once per photo and focus point, then served from memory; a moved focus point is a new strip", async () => {
    await storePhoto(event.eventId, await twoTonePhoto());
    const orderId = await paidOrder(2);
    const reads = vi.spyOn(api.db, "query");
    const photoReads = () => reads.mock.calls.filter(([sql]) => sql.includes("octet_length(i.data)")).length;
    const first = await applePassFiles(orderId, "1");
    const second = await applePassFiles(orderId, "2");
    expect(photoReads()).toBe(1);
    expect(second.get("strip@3x.png")!.equals(first.get("strip@3x.png")!)).toBe(true);
    await api.db.query(`update public.event_images set focus_x = 50, focus_y = 0 where event_id = $1`, [event.eventId]);
    const moved = await applePassFiles(orderId, "1");
    expect(photoReads()).toBe(2);
    expect((await meanColour(moved.get("strip@3x.png")!)).r).toBeGreaterThan(200);
  });

  it("the cache holds at most APPLE_STRIP_CACHE_SIZE strips, dropping the least recently used", async () => {
    const photo = await twoTonePhoto();
    const path = await storePhoto(event.eventId, photo);
    const version = walletImageVersion({ eventId: event.eventId, imageUrl: path })!;
    const db: Db = { query: vi.fn(api.db.query.bind(api.db)) as Db["query"] };
    const ticket = (x: number) => ({ eventId: event.eventId, imageUrl: path, imageFocus: { x, y: 50 } });
    for (let x = 0; x <= APPLE_STRIP_CACHE_SIZE; x++) expect(await appleEventStrip(db, ticket(x))).toBeDefined();
    expect(db.query).toHaveBeenCalledTimes(APPLE_STRIP_CACHE_SIZE + 1);
    await appleEventStrip(db, ticket(APPLE_STRIP_CACHE_SIZE)); // the newest: cached
    expect(db.query).toHaveBeenCalledTimes(APPLE_STRIP_CACHE_SIZE + 1);
    await appleEventStrip(db, ticket(0)); // the oldest: dropped, read again
    expect(db.query).toHaveBeenCalledTimes(APPLE_STRIP_CACHE_SIZE + 2);
    expect(version).toMatch(/^\d+$/);
  });
});

describe("the Sheltüh band instead", () => {
  it("no photo: Apple's strip is the stand-in, and Google's object has no hero (the class's stand-in shows)", async () => {
    const orderId = await paidOrder();
    const files = await applePassFiles(orderId);
    for (const name of STRIP_FILES) expect(files.get(name)!.equals(STAND_IN[name]), name).toBe(true);
    const { cls, object } = await googleClaims(orderId);
    expect(object.heroImage).toBeUndefined();
    expect(cls.heroImage).toEqual({
      sourceUri: { uri: `${SITE_URL}${GOOGLE_HERO_PATH}` },
      contentDescription: { defaultValue: { language: "en-AU", value: "Sheltüh" } },
    });
  });

  it("a photo URL that isn't the event's own path (another host, protocol-relative, not https, another event, another query) is never read or sent to Google", async () => {
    const otherEvent = "9d0c1b2a-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
    const foreign = [
      "https://evil.example/api/events/x/image?v=1",
      `//evil.example/api/events/${TEST_EVENT_ID}/image?v=1`,
      `http://sheltuh.com.au/api/events/${TEST_EVENT_ID}/image?v=1`,
      `https://sheltuh.com.au/api/events/${TEST_EVENT_ID}/image?v=1`,
      `/api/events/${otherEvent}/image?v=1`,
      `/api/events/${TEST_EVENT_ID}/image?v=1&url=https://evil.example/`,
      `/api/events/${TEST_EVENT_ID}/image?v=abc`,
      `/api/events/${TEST_EVENT_ID}/image`,
      `/\\evil.example/api/events/${TEST_EVENT_ID}/image?v=1`,
      `/api/events/${TEST_EVENT_ID.toUpperCase()}/image?v=1`,
    ];
    const db: Db = { query: vi.fn(async () => []) as Db["query"] };
    for (const imageUrl of foreign) {
      const ticket = sampleTicket({ imageUrl });
      expect(walletImageVersion(ticket), imageUrl).toBeUndefined();
      expect(googleEventHeroUri(ticket, "https://sheltuh.com.au"), imageUrl).toBeUndefined();
      expect(await appleEventStrip(db, ticket), imageUrl).toBeUndefined();
      const [object] = decodeJwt(buildGoogleSaveJwt(googleConfig, ticket, "https://sheltuh.com.au"), googleCreds.keys.publicKey).claims.payload
        .eventTicketObjects;
      expect(object.heroImage, imageUrl).toBeUndefined();
    }
    expect(db.query).not.toHaveBeenCalled();
    // The event's own path is accepted, made absolute on the site; never on a site that isn't https.
    const own = sampleTicket({ imageUrl: `/api/events/${TEST_EVENT_ID}/image?v=1763700000` });
    expect(googleEventHeroUri(own, "https://sheltuh.com.au/")).toBe(`https://sheltuh.com.au/api/events/${TEST_EVENT_ID}/image?v=1763700000`);
    expect(googleEventHeroUri(own, "http://localhost:3000")).toBeUndefined();
  });

  it("a read that fails: the pass is still issued, with the stand-in, and the log names no URL or id", async () => {
    await storePhoto(event.eventId, await twoTonePhoto());
    const orderId = await paidOrder();
    const warn = silenceWarnings();
    const query = api.db.query.bind(api.db);
    vi.spyOn(api.db, "query").mockImplementation((async (sql: string, params?: unknown[]) => {
      if (sql.includes("octet_length(i.data)")) throw new Error(`connection reset reading ${event.eventId}`);
      return query(sql, params);
    }) as Db["query"]);
    const files = await applePassFiles(orderId);
    for (const name of STRIP_FILES) expect(files.get(name)!.equals(STAND_IN[name]), name).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(event.eventId);
    expect(logged).not.toContain("/api/events");
    expect(logged).not.toContain("connection reset");
    // Not cached: once the database answers, the photo is used.
    vi.restoreAllMocks();
    const again = await applePassFiles(orderId);
    expect(again.get("strip.png")!.equals(STAND_IN["strip.png"])).toBe(false);
  });

  it("a read or crop that takes too long: the stand-in, without waiting for it", async () => {
    const path = await storePhoto(event.eventId, await twoTonePhoto());
    const warn = silenceWarnings();
    const never: Db = { query: vi.fn(() => new Promise<never>(() => undefined)) as Db["query"] };
    const started = Date.now();
    expect(await appleEventStrip(never, { eventId: event.eventId, imageUrl: path }, { timeoutMs: 50 })).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(warn.mock.calls[0][0]).toMatch(/timed out/);
    // A pass built without a strip carries the stand-in.
    const files = readZip(buildApplePass(appleConfig, sampleTicket({ imageUrl: path })));
    for (const name of STRIP_FILES) expect(files.get(name)!.equals(STAND_IN[name]), name).toBe(true);
  });

  it("a photo over the size cap: its bytes aren't even read, and the stand-in is used", async () => {
    const photo = await twoTonePhoto();
    const path = await storePhoto(event.eventId, photo);
    const warn = silenceWarnings();
    const query = vi.fn(api.db.query.bind(api.db));
    const db: Db = { query: query as Db["query"] };
    expect(await appleEventStrip(db, { eventId: event.eventId, imageUrl: path }, { maxBytes: photo.length - 1 })).toBeUndefined();
    expect(warn.mock.calls[0][0]).toMatch(/too large/);
    // The database left the bytes out (data is null over the cap).
    const rows = await query.mock.results[0].value;
    expect(rows).toEqual([{ content_type: "image/jpeg", data: null }]);
    // At the cap, it's used.
    expect(await appleEventStrip(db, { eventId: event.eventId, imageUrl: path }, { maxBytes: photo.length })).toBeDefined();
  });

  it("bytes that aren't an image of their stored type, or don't decode: the stand-in", async () => {
    const warn = silenceWarnings();
    const jpeg = await twoTonePhoto();
    // Stored as a PNG, but a JPEG's bytes.
    const path = await storePhoto(event.eventId, jpeg, "image/png");
    expect(await appleEventStrip(api.db, { eventId: event.eventId, imageUrl: path })).toBeUndefined();
    // A JPEG signature, then garbage.
    await api.db.query(`update public.event_images set content_type = 'image/jpeg', data = $2 where event_id = $1`, [
      event.eventId,
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]),
    ]);
    expect(await appleEventStrip(api.db, { eventId: event.eventId, imageUrl: path })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("a photo replaced, or the event unpublished, since the ticket was read: the stand-in (never another version's bytes)", async () => {
    silenceWarnings();
    const path = await storePhoto(event.eventId, await twoTonePhoto());
    const stale = path.replace(/v=(\d+)$/, (_, v: string) => `v=${Number(v) - 1}`);
    expect(await appleEventStrip(api.db, { eventId: event.eventId, imageUrl: stale })).toBeUndefined();
    await api.db.query(`update public.events set status = 'rejected' where id = $1`, [event.eventId]);
    expect(await appleEventStrip(api.db, { eventId: event.eventId, imageUrl: path })).toBeUndefined();
  });
});

describe("Google's save URL with a photo", () => {
  it("stays under GOOGLE_SAVE_URL_MAX: at the longest field lengths the API accepts, the photo is left out (the class's stand-in shows)", () => {
    const longest = sampleTicket({
      eventTitle: "T".repeat(150),
      venueName: "V".repeat(150),
      venueAddress: "A".repeat(250),
      suburb: "S".repeat(100),
      ticketTypeName: "N".repeat(150),
      seat: { section: "X".repeat(40), row: "R".repeat(10), seat: "9".repeat(10), kind: "standard" },
      imageUrl: `/api/events/${TEST_EVENT_ID}/image?v=99999999999`,
    });
    const jwt = buildGoogleSaveJwt(googleConfig, longest, "https://sheltuh.com.au");
    const { claims, verified } = decodeJwt(jwt, googleCreds.keys.publicKey);
    expect(verified).toBe(true);
    expect(claims.payload.eventTicketObjects[0].heroImage).toBeUndefined();
    expect(claims.payload.eventTicketClasses[0].heroImage.sourceUri.uri).toBe(`https://sheltuh.com.au${GOOGLE_HERO_PATH}`);
    expect(googleSaveUrl(jwt).length).toBeLessThanOrEqual(GOOGLE_SAVE_URL_MAX);
    expect(GOOGLE_SAVE_URL_MAX).toBe(5120);

    // A long title still gets the photo: its description is the title, cut as a card row's value is.
    const long = sampleTicket({ eventTitle: "T".repeat(150), imageUrl: `/api/events/${TEST_EVENT_ID}/image?v=99999999999` });
    const withPhoto = buildGoogleSaveJwt(googleConfig, long, "https://sheltuh.com.au");
    const [object] = decodeJwt(withPhoto, googleCreds.keys.publicKey).claims.payload.eventTicketObjects;
    expect(object.heroImage.sourceUri.uri).toBe(`https://sheltuh.com.au/api/events/${TEST_EVENT_ID}/image?v=99999999999`);
    expect(object.heroImage.contentDescription.defaultValue.value).toBe(`${"T".repeat(39)}…`);
    expect(googleSaveUrl(withPhoto).length).toBeLessThanOrEqual(GOOGLE_SAVE_URL_MAX);
  });
});
