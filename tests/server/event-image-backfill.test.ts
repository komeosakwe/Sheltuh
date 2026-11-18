import postgres from "postgres";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEventImage, putEventImage } from "@/lib/server/handlers/event-images";
import { getPublicEventBySlug } from "@/lib/server/handlers/public-events";
import { encodeEventImage } from "@/lib/server/event-image";
import { crc32 } from "@/lib/server/png";
import { runHandler } from "@/lib/server/route";
import {
  backfillEventImageMetadata,
  connectBackfillDatabase,
  CONNECTION_STRING_ADVICE,
  DATABASE_CA_CERT_REQUIRED,
  DATABASE_URL_INCOMPLETE,
  DATABASE_URL_ONE_HOST,
  main,
  scanImageMetadata,
  type MainDeps,
} from "@/scripts/event-image-backfill";
import { ROTATE_ADVICE } from "@/scripts/redact-secrets";
import { SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import {
  CAMERA_MAKE,
  CAMERA_SERIAL,
  GPS_SECONDS,
  jpegWithGps,
  jpegWithIptcCommentAndTrailer,
  orientedJpegWithGps,
  pngWithGps,
  pngWithTextChunks,
  testPng,
} from "./helpers/images";
import { createTestDb } from "./helpers/test-db";

// The one-off backfill (scripts/event-image-backfill.ts) that strips metadata
// from event photos stored before uploads were re-encoded: the rows are written
// straight into public.event_images, as the old upload path stored them.

let api: TestApi;
let reset: () => Promise<void>;
let serverUrl: string | undefined;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  serverUrl = testDb.url;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
});

/** A free event, so no payouts are needed to publish it. */
const FREE = { ticketTypes: [{ id: "ga", name: "General admission", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 }] };

/** An old-style row: the bytes as uploaded, a focus point, last written a week ago. */
async function storeRaw(
  eventId: string,
  bytes: Uint8Array,
  contentType: string,
  options: { focus?: { x: number; y: number } | null; updatedAt?: string } = {},
) {
  const focus = options.focus === undefined ? { x: 30, y: 70 } : options.focus;
  await api.db.query(
    `insert into public.event_images (event_id, content_type, data, focus_x, focus_y, updated_at)
     values ($1, $2, $3::bytea, $4, $5, coalesce($6::timestamptz, now() - interval '7 days'))`,
    [eventId, contentType, Buffer.from(bytes), focus?.x ?? null, focus?.y ?? null, options.updatedAt ?? null],
  );
}

interface Stored {
  data: Buffer;
  contentType: string;
  focus: [number | null, number | null];
  version: string;
  imageUpdatedAt: string;
  eventUpdatedAt: string;
  status: string;
}

async function stored(eventId: string): Promise<Stored> {
  const [row] = await api.db.query<{
    data: Uint8Array;
    content_type: string;
    focus_x: number | null;
    focus_y: number | null;
    version: string;
    image_updated_at: string;
    event_updated_at: string;
    status: string;
  }>(
    `select i.data, i.content_type, i.focus_x, i.focus_y,
            floor(extract(epoch from i.updated_at))::bigint::text as version,
            i.updated_at::text as image_updated_at, e.updated_at::text as event_updated_at, e.status::text as status
       from public.event_images i join public.events e on e.id = i.event_id
      where i.event_id = $1`,
    [eventId],
  );
  expect(row).toBeDefined();
  return {
    data: Buffer.from(row.data),
    contentType: row.content_type,
    focus: [row.focus_x, row.focus_y],
    version: row.version,
    imageUpdatedAt: row.image_updated_at,
    eventUpdatedAt: row.event_updated_at,
    status: row.status,
  };
}

async function webpWithGpsAndCamera(): Promise<Buffer> {
  return sharp({ create: { width: 50, height: 30, channels: 3, background: "#ff4800" } })
    .withIccProfile("p3")
    .withExif({
      IFD0: { Make: CAMERA_MAKE, Model: CAMERA_SERIAL },
      IFD3: { GPSLatitudeRef: "S", GPSLatitude: "37/1 48/1 1234/100", GPSLongitudeRef: "E", GPSLongitude: "144/1 57/1 5678/100" },
    })
    .webp()
    .toBuffer();
}

/** A JPEG whose EXIF has a camera make and model (and sharp's resolution tags), but no GPS and no ICC. */
async function jpegWithCameraOnly(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: "#204080" } })
    .withExif({ IFD0: { Make: CAMERA_MAKE, Model: CAMERA_SERIAL } })
    .jpeg()
    .toBuffer();
}

/** What the old path couldn't have stored but a row can still hold: a JPEG that stops partway through. */
const CORRUPT_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

/** A real PNG whose header claims 5000 × 5000 (25 megapixels, over the 24 allowed), with a tEXt chunk. */
async function overLimitPng(): Promise<Buffer> {
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).png().toBuffer();
  png.writeUInt32BE(5000, 16);
  png.writeUInt32BE(5000, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
  const text = Buffer.from("Comment\0Taken in Fitzroy", "latin1");
  const chunk = Buffer.alloc(12 + text.length);
  chunk.writeUInt32BE(text.length, 0);
  chunk.write("tEXt", 4, "latin1");
  text.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + text.length)), 8 + text.length);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

/**
 * A PNG with no metadata whose chunks and header are all whole (valid lengths and CRCs, so its structure
 * and sharp's metadata() read fine) but whose IDAT holds compressed data that doesn't inflate.
 */
async function pngWithCorruptIdat(): Promise<Buffer> {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#336699" } }).png().toBuffer();
  let at = 8;
  while (png.toString("latin1", at + 4, at + 8) !== "IDAT") at += 12 + png.readUInt32BE(at);
  const length = png.readUInt32BE(at);
  const out = Buffer.from(png);
  // Past the 2-byte zlib header, flip the deflate data; then a valid CRC again.
  for (let k = at + 10; k < at + 8 + length; k++) out[k] ^= 0xa5;
  out.writeUInt32BE(crc32(out.subarray(at + 4, at + 8 + length)), at + 8 + length);
  return out;
}

/** A real two-frame animated WebP (ANIM and two ANMF chunks), as the old upload path could have stored it. */
async function animatedWebp(): Promise<Buffer> {
  const frame = (background: string) => sharp({ create: { width: 40, height: 30, channels: 3, background } }).png().toBuffer();
  return sharp([await frame("#ff0000"), await frame("#0000ff")], { join: { animated: true } })
    .webp({ loop: 0, delay: [200, 200] })
    .toBuffer();
}

/** A PNG with an APNG animation control chunk (acTL) before its IDAT. */
async function pngWithAcTL(): Promise<Buffer> {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#00ff00" } }).png().toBuffer();
  const data = Buffer.alloc(8);
  data.writeUInt32BE(2, 0); // frames
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8, 0);
  chunk.write("acTL", 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 16)), 16);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

/** A placeholder CA certificate: only its shape is checked before connecting. */
const CA = "-----BEGIN CERTIFICATE-----\nMIIBplaceholder\n-----END CERTIFICATE-----";

/** The imageUrl of a published event's public record (GET /api/events/slug/{slug}). */
async function publicImageUrl(slug: string): Promise<string | undefined> {
  const res = await api.call(getPublicEventBySlug, { params: { slug } });
  expect(res.status).toBe(200);
  return res.body.imageUrl;
}

/** None of the fixtures' identifying bytes is left. */
function expectNoLeak(bytes: Buffer) {
  for (const needle of [Buffer.from("Exif"), Buffer.from(CAMERA_MAKE), Buffer.from(CAMERA_SERIAL), GPS_SECONDS, Buffer.from("Fitzroy")]) {
    expect(bytes.includes(needle), needle.toString("latin1")).toBe(false);
  }
}

async function imageUrl(eventId: string): Promise<string | undefined> {
  const res = await runHandler(
    getEventImage,
    new Request(`${SITE_URL}/api/test`, { headers: { authorization: `Bearer ${organiser.token}` } }),
    { eventId },
    api.deps,
  );
  return res.headers.get("etag") ?? undefined;
}

async function moderationLogCount(): Promise<number> {
  const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from public.event_moderation_log`);
  return n;
}

function mainDeps(overrides: Partial<MainDeps> = {}): MainDeps & { out: string[]; err: string[]; connects: number } {
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    argv: [] as string[],
    env: {
      DATABASE_URL: "postgresql://postgres.abcdefgh:Sup3r-Secret-Pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
      DATABASE_CA_CERT: CA,
    } as Record<string, string | undefined>,
    connects: 0,
    out,
    err,
    connect: () => {
      deps.connects += 1;
      return { db: api.db, end: async () => {} };
    },
    print: (line: string) => out.push(line),
    printError: (line: string) => err.push(line),
    ...overrides,
  };
  return deps;
}

describe("scanImageMetadata", () => {
  it("finds GPS, camera and other metadata in JPEG, PNG and WebP uploads", async () => {
    expect(await scanImageMetadata(await jpegWithGps())).toEqual({ ok: true, format: "jpeg", kinds: ["gps", "camera", "other"] });
    expect(await scanImageMetadata(await orientedJpegWithGps())).toEqual({ ok: true, format: "jpeg", kinds: ["gps", "camera", "other"] });
    expect(await scanImageMetadata(await pngWithGps())).toEqual({ ok: true, format: "png", kinds: ["gps", "camera", "other"] });
    expect(await scanImageMetadata(await webpWithGpsAndCamera())).toEqual({ ok: true, format: "webp", kinds: ["gps", "camera", "other"] });
    // sharp's EXIF also has the resolution tags: other.
    expect(await scanImageMetadata(await jpegWithCameraOnly())).toEqual({ ok: true, format: "jpeg", kinds: ["camera", "other"] });
  });

  it("finds IPTC, JPEG comments, data after EOI and PNG text chunks as other", async () => {
    const textPng = await pngWithTextChunks();
    expect(await scanImageMetadata(textPng)).toEqual({ ok: true, format: "png", kinds: ["other"] });
    expect(await scanImageMetadata(await jpegWithIptcCommentAndTrailer(Buffer.alloc(0)))).toEqual({ ok: true, format: "jpeg", kinds: ["other"] });
    // Only a trailer after EOI.
    const plain = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).jpeg().toBuffer();
    expect(await scanImageMetadata(plain)).toEqual({ ok: true, format: "jpeg", kinds: [] });
    expect(await scanImageMetadata(Buffer.concat([plain, Buffer.from("PK\x03\x04hidden")]))).toEqual({ ok: true, format: "jpeg", kinds: ["other"] });
  });

  it("finds nothing in what encodeEventImage stores, whatever went in", async () => {
    for (const input of [await orientedJpegWithGps(), await pngWithGps(), await webpWithGpsAndCamera(), await pngWithTextChunks(), testPng(3)]) {
      const { bytes } = await encodeEventImage(input);
      expect(await scanImageMetadata(bytes)).toEqual({ ok: true, format: expect.any(String), kinds: [] });
    }
  });

  it("flags animation: a WebP's ANIM/ANMF chunks, a PNG's acTL", async () => {
    const webp = await animatedWebp();
    expect((await sharp(webp).metadata()).pages).toBe(2);
    expect(await scanImageMetadata(webp)).toEqual({ ok: true, format: "webp", kinds: ["other"], animated: true });
    expect(await scanImageMetadata(await pngWithAcTL())).toEqual({ ok: true, format: "png", kinds: ["other"], animated: true });
    // A still photo has no flag.
    expect(await scanImageMetadata(await webpWithGpsAndCamera())).not.toHaveProperty("animated");
  });

  it("refuses what isn't a whole JPEG, PNG or WebP", async () => {
    expect(await scanImageMetadata(CORRUPT_JPEG)).toMatchObject({ ok: false });
    expect(await scanImageMetadata(Buffer.from("GIF89a....."))).toMatchObject({ ok: false });
    const png = await pngWithGps();
    expect(await scanImageMetadata(png.subarray(0, png.length - 20))).toMatchObject({ ok: false });
  });
});

describe("backfillEventImageMetadata", () => {
  it("dry run (the default) reports and changes nothing", async () => {
    const events = await Promise.all([0, 1, 2, 3].map(() => publishedEvent(api, organiser, admin, FREE)));
    await storeRaw(events[0].eventId, await orientedJpegWithGps(), "image/jpeg");
    await storeRaw(events[1].eventId, await pngWithGps(), "image/png");
    await storeRaw(events[2].eventId, await jpegWithCameraOnly(), "image/jpeg");
    const clean = await encodeEventImage(testPng(1));
    await storeRaw(events[3].eventId, clean.bytes, clean.contentType);
    const before = await Promise.all(events.map((e) => stored(e.eventId)));
    const logBefore = await moderationLogCount();

    const lines: string[] = [];
    const summary = await backfillEventImageMetadata(api.db, { print: (line) => lines.push(line) });
    expect(summary).toMatchObject({
      apply: false,
      total: 4,
      withMetadata: 3,
      byKind: { gps: 2, camera: 3, other: 3 },
      clean: 1,
      wouldClean: 3,
      cleaned: 0,
      skipped: 0,
      failed: 0,
    });
    expect(await Promise.all(events.map((e) => stored(e.eventId)))).toEqual(before);
    expect(await moderationLogCount()).toBe(logBefore);
    // One line for each row that isn't clean, by the event id's first 8 characters only.
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toMatch(/would re-encode/);
    const printed = lines.join("\n");
    for (const event of events) {
      expect(printed).not.toContain(event.eventId);
      expect(printed).not.toContain("/api/events/");
    }
    expect(printed).toContain(events[0].eventId.slice(0, 8));
  });

  it("--apply strips GPS and camera from JPEG, PNG and WebP, keeps the format and focus, and moves the version", async () => {
    const events = await Promise.all([0, 1, 2].map(() => publishedEvent(api, organiser, admin, FREE)));
    const inputs = [
      [events[0].eventId, await orientedJpegWithGps(), "image/jpeg"],
      [events[1].eventId, await pngWithGps(), "image/png"],
      [events[2].eventId, await webpWithGpsAndCamera(), "image/webp"],
    ] as const;
    for (const [eventId, bytes, type] of inputs) await storeRaw(eventId, bytes, type, { focus: { x: 12, y: 88 } });
    const before = await Promise.all(events.map((e) => stored(e.eventId)));
    const etagsBefore = await Promise.all(events.map((e) => imageUrl(e.eventId)));
    const publicUrlBefore = await publicImageUrl(events[1].slug);
    expect(publicUrlBefore).toBe(`/api/events/${events[1].eventId}/image?v=${before[1].version}`);
    const logBefore = await moderationLogCount();

    const summary = await backfillEventImageMetadata(api.db, { apply: true });
    expect(summary).toMatchObject({ apply: true, total: 3, withMetadata: 3, cleaned: 3, skipped: 0, failed: 0, clean: 0 });

    for (const [i, [eventId, , type]] of inputs.entries()) {
      const after = await stored(eventId);
      expect(after.contentType).toBe(type);
      expect(await scanImageMetadata(after.data)).toEqual({ ok: true, format: type.slice(6), kinds: [] });
      expectNoLeak(after.data);
      const meta = await sharp(after.data).metadata();
      expect([meta.exif, meta.icc, meta.xmp, meta.orientation]).toEqual([undefined, undefined, undefined, undefined]);
      // Focus and status untouched.
      expect(after.focus).toEqual([12, 88]);
      expect(after.status).toBe("published");
      // A new photo version (URL ?v= and ETag), and a new event version (the trigger).
      expect(Number(after.version)).toBeGreaterThan(Number(before[i].version));
      expect(after.eventUpdatedAt).not.toBe(before[i].eventUpdatedAt);
      expect(await imageUrl(eventId)).toBe(`"${after.version}"`);
      expect(await imageUrl(eventId)).not.toBe(etagsBefore[i]);
    }
    // The sideways phone photo was turned the right way up (80 × 120), as an upload is.
    const jpeg = await sharp((await stored(events[0].eventId)).data).metadata();
    expect([jpeg.width, jpeg.height]).toEqual([80, 120]);
    // The public event record (as the site reads it) points at the new version.
    const publicUrlAfter = await publicImageUrl(events[1].slug);
    expect(publicUrlAfter).toBe(`/api/events/${events[1].eventId}/image?v=${(await stored(events[1].eventId)).version}`);
    expect(publicUrlAfter).not.toBe(publicUrlBefore);
    // A system clean-up, not someone's edit: nothing logged.
    expect(await moderationLogCount()).toBe(logBefore);
  });

  it("moves the version on by exactly a second when the stored version isn't behind the database clock", async () => {
    // Ahead of the database's now() (by an hour, whatever the time it takes to run): now() alone would move the
    // version back, and an update that only wrote now() fails here however long the re-encode takes.
    const [{ ahead }] = await api.db.query<{ ahead: string }>(
      `select (date_trunc('second', now()) + interval '1 hour 250 milliseconds')::text as ahead`,
    );
    const event = await draftEvent(api, organiser, FREE);
    await storeRaw(event.eventId, await jpegWithCameraOnly(), "image/jpeg", { updatedAt: ahead });
    const before = await stored(event.eventId);
    expect((await backfillEventImageMetadata(api.db, { apply: true })).cleaned).toBe(1);
    const after = await stored(event.eventId);
    expect(Number(after.version)).toBe(Number(before.version) + 1);
    const [{ moved }] = await api.db.query<{ moved: boolean }>(`select $1::timestamptz = $2::timestamptz + interval '1 second' as moved`, [
      after.imageUpdatedAt,
      before.imageUpdatedAt,
    ]);
    expect(moved).toBe(true);
  });

  it("keeps banner_fit where the column exists (#61's schema), and a null focus null", async () => {
    await api.db.query(
      `alter table public.event_images add column if not exists banner_fit text not null default 'crop'`,
    );
    const [withFit, noFocus] = await Promise.all([0, 1].map(() => publishedEvent(api, organiser, admin, FREE)));
    await storeRaw(withFit.eventId, await jpegWithGps(), "image/jpeg");
    await storeRaw(noFocus.eventId, await pngWithGps(), "image/png", { focus: null });
    await api.db.query(`update public.event_images set banner_fit = 'whole' where event_id = $1`, [withFit.eventId]);

    expect((await backfillEventImageMetadata(api.db, { apply: true })).cleaned).toBe(2);
    const fits = await api.db.query<{ event_id: string; banner_fit: string }>(
      `select event_id::text, banner_fit from public.event_images order by event_id`,
    );
    expect(Object.fromEntries(fits.map((r) => [r.event_id, r.banner_fit]))).toEqual({
      [withFit.eventId]: "whole",
      [noFocus.eventId]: "crop",
    });
    expect((await stored(withFit.eventId)).focus).toEqual([30, 70]);
    expect((await stored(noFocus.eventId)).focus).toEqual([null, null]);
  });

  it("leaves a clean photo exactly as it is (bytes, version, the event's version)", async () => {
    const event = await publishedEvent(api, organiser, admin, FREE);
    const clean = await encodeEventImage(await orientedJpegWithGps());
    await storeRaw(event.eventId, clean.bytes, clean.contentType);
    const before = await stored(event.eventId);
    const summary = await backfillEventImageMetadata(api.db, { apply: true });
    expect(summary).toMatchObject({ total: 1, clean: 1, withMetadata: 0, cleaned: 0, failed: 0 });
    expect(await stored(event.eventId)).toEqual(before);
  });

  it("reports a corrupt photo and one over the pixel limit, leaves both untouched, cleans the rest; main exits 1", async () => {
    const [corrupt, tooBig, fine] = await Promise.all([0, 1, 2].map(() => publishedEvent(api, organiser, admin, FREE)));
    await storeRaw(corrupt.eventId, CORRUPT_JPEG, "image/jpeg");
    await storeRaw(tooBig.eventId, await overLimitPng(), "image/png");
    await storeRaw(fine.eventId, await jpegWithGps(), "image/jpeg");
    const before = await Promise.all([corrupt, tooBig].map((e) => stored(e.eventId)));

    const deps = mainDeps({ argv: ["--apply"] });
    expect(await main(deps)).toBe(1);
    expect(await Promise.all([corrupt, tooBig].map((e) => stored(e.eventId)))).toEqual(before);
    expect(await scanImageMetadata((await stored(fine.eventId)).data)).toMatchObject({ kinds: [] });

    const printed = deps.out.join("\n");
    expect(printed).toMatch(new RegExp(`${corrupt.eventId.slice(0, 8)} .*FAILED, left untouched: isn't a complete JPEG file`));
    expect(printed).toMatch(new RegExp(`${tooBig.eventId.slice(0, 8)} .*FAILED, left untouched: doesn't decode \\(corrupt, over 24 megapixels`));
    expect(printed).toMatch(/Failed \(untouched\): +2/);
    expect(printed).toMatch(/Re-encoded: +1/);

    // The dry run says the same, and exits 1 too.
    const dry = mainDeps();
    expect(await main(dry)).toBe(1);
    expect(dry.out.join("\n")).toMatch(/Failed \(untouched\): +2/);
  });

  it("reports a photo without metadata whose pixels don't decode (a corrupt IDAT) as failed, not clean, and leaves it untouched", async () => {
    const [corrupt, fine] = await Promise.all([0, 1].map(() => publishedEvent(api, organiser, admin, FREE)));
    const broken = await pngWithCorruptIdat();
    // Its structure and header read fine, and it carries no metadata: only decoding its pixels finds it.
    expect(await scanImageMetadata(broken)).toEqual({ ok: true, format: "png", kinds: [] });
    await storeRaw(corrupt.eventId, broken, "image/png");
    const clean = await encodeEventImage(testPng(4));
    await storeRaw(fine.eventId, clean.bytes, clean.contentType);
    const before = await Promise.all([corrupt, fine].map((e) => stored(e.eventId)));

    for (const apply of [false, true]) {
      const lines: string[] = [];
      const summary = await backfillEventImageMetadata(api.db, { apply, print: (line) => lines.push(line) });
      expect(summary).toMatchObject({ total: 2, clean: 1, withMetadata: 0, failed: 1, wouldClean: 0, cleaned: 0 });
      expect(summary.rows.find((r) => r.event === corrupt.eventId.slice(0, 8))).toMatchObject({ result: "failed", format: "png", kinds: [] });
      expect(lines).toEqual([expect.stringMatching(new RegExp(`${corrupt.eventId.slice(0, 8)} .*FAILED, left untouched: doesn't decode`))]);
      // Both left exactly as they were (bytes, version, the event's version).
      expect(await Promise.all([corrupt, fine].map((e) => stored(e.eventId)))).toEqual(before);
    }
    const deps = mainDeps({ argv: ["--apply"] });
    expect(await main(deps)).toBe(1);
    expect(deps.out.join("\n")).toMatch(/Failed \(untouched\): +1/);
  });

  it("never re-encodes an animated photo (it would keep one frame): FAILED, left untouched, in the dry run and with --apply", async () => {
    const [animated, apng, still] = await Promise.all([0, 1, 2].map(() => publishedEvent(api, organiser, admin, FREE)));
    await storeRaw(animated.eventId, await animatedWebp(), "image/webp");
    await storeRaw(apng.eventId, await pngWithAcTL(), "image/png");
    await storeRaw(still.eventId, await jpegWithGps(), "image/jpeg");
    const before = await Promise.all([animated, apng].map((e) => stored(e.eventId)));
    let encodes = 0;
    const encode = (input: Uint8Array) => {
      encodes += 1;
      return encodeEventImage(input);
    };

    const dry: string[] = [];
    expect(await backfillEventImageMetadata(api.db, { encode, print: (line) => dry.push(line) })).toMatchObject({
      total: 3,
      withMetadata: 1,
      wouldClean: 1,
      failed: 2,
    });
    const applied: string[] = [];
    expect(await backfillEventImageMetadata(api.db, { apply: true, encode, print: (line) => applied.push(line) })).toMatchObject({
      total: 3,
      withMetadata: 1,
      cleaned: 1,
      failed: 2,
    });
    // Only the still photo was ever re-encoded (once per run); the animated ones are byte for byte as they were.
    expect(encodes).toBe(2);
    expect(await Promise.all([animated, apng].map((e) => stored(e.eventId)))).toEqual(before);
    expect((await sharp((await stored(animated.eventId)).data).metadata()).pages).toBe(2);
    for (const lines of [dry, applied]) {
      for (const event of [animated, apng]) {
        expect(lines.join("\n")).toMatch(
          new RegExp(`${event.eventId.slice(0, 8)} .*FAILED, left untouched: animated: re-encoding keeps only the first frame.*replace it by hand`),
        );
      }
    }
    const deps = mainDeps({ argv: ["--apply"] });
    expect(await main(deps)).toBe(1);
    expect(deps.out.join("\n")).toMatch(/Failed \(untouched\): +2/);
  });

  it("says when a re-encoded copy changes format (over 2 MB in its own format, so WebP), in the dry run and with --apply", async () => {
    const event = await publishedEvent(api, organiser, admin, FREE);
    await storeRaw(event.eventId, await jpegWithGps(), "image/jpeg");
    // What encodeEventImage does for a copy over 2 MB in its own format (a real one: event-image-metadata.test.ts).
    const asWebp = async (input: Uint8Array) => ({
      bytes: await sharp(input).rotate().webp({ quality: 82 }).toBuffer(),
      contentType: "image/webp" as const,
    });

    const dry: string[] = [];
    const dryRun = await backfillEventImageMetadata(api.db, { encode: asWebp, print: (line) => dry.push(line) });
    expect(dryRun.rows[0]).toMatchObject({ result: "would_clean", format: "jpeg", newFormat: "webp" });
    expect(dry).toEqual([expect.stringMatching(/ jpeg .*; would re-encode as WebP \(\d+ KB\)$/)]);

    const applied: string[] = [];
    expect(await backfillEventImageMetadata(api.db, { apply: true, encode: asWebp, print: (line) => applied.push(line) })).toMatchObject({ cleaned: 1 });
    expect(applied).toEqual([expect.stringMatching(/ jpeg .*; re-encoded as WebP \(\d+ KB\), new version$/)]);
    expect((await stored(event.eventId)).contentType).toBe("image/webp");

    // A copy in the same format says nothing about format.
    const other = await publishedEvent(api, organiser, admin, FREE);
    await storeRaw(other.eventId, await jpegWithGps(), "image/jpeg");
    const same: string[] = [];
    await backfillEventImageMetadata(api.db, { print: (line) => same.push(line) });
    expect(same).toEqual([expect.stringMatching(/; would re-encode \(\d+ KB\)$/)]);
  });

  it("skips a photo the organiser replaced while it was being re-encoded, and keeps theirs", async () => {
    const event = await draftEvent(api, organiser, FREE);
    await storeRaw(event.eventId, await jpegWithGps(), "image/jpeg");
    const replacement = testPng(7);

    const summary = await backfillEventImageMetadata(api.db, {
      apply: true,
      encode: async (input) => {
        // The organiser uploads a new photo between the backfill's read and its write.
        const res = await api.send(
          putEventImage,
          new Request(`${SITE_URL}/api/test`, {
            method: "PUT",
            headers: { authorization: `Bearer ${organiser.token}`, "content-type": "image/png" },
            body: replacement,
          }),
          { eventId: event.eventId },
        );
        expect(res.status).toBe(200);
        return encodeEventImage(input);
      },
    });
    expect(summary).toMatchObject({ withMetadata: 1, cleaned: 0, skipped: 1, failed: 0 });
    expect(summary.rows[0]).toMatchObject({ result: "skipped" });

    const after = await stored(event.eventId);
    const theirs = await encodeEventImage(replacement);
    expect(after.data.equals(theirs.bytes)).toBe(true);
    // Their upload carried no focus, so none is set (the backfill didn't touch it).
    expect(after.focus).toEqual([null, null]);
    // Run again: their photo is already clean.
    expect(await backfillEventImageMetadata(api.db, { apply: true })).toMatchObject({ clean: 1, cleaned: 0, skipped: 0 });
  });

  // A real interleaving (needs TEST_DATABASE_URL: PGlite is one connection): the organiser's upload holds the
  // event row when the backfill writes, so the backfill waits on the event row (locked first, as every image
  // writer does), then re-checks the photo at its newest version and skips it.
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))("waits on the event row an upload holds, then skips the photo it replaced", { timeout: 30_000 }, async () => {
    const event = await draftEvent(api, organiser, FREE);
    await storeRaw(event.eventId, await jpegWithGps(), "image/jpeg");
    const theirs = await encodeEventImage(testPng(9));
    const two = postgres(serverUrl!, { max: 1, onnotice: () => {} });
    const watcher = postgres(serverUrl!, { max: 1, onnotice: () => {} });
    const [{ pid: writerPid }] = await two.unsafe<{ pid: number }[]>(`select pg_backend_pid() as pid`);
    /**
     * The tables whose row the backfill's write waits on: the backend blocked by this test's writer
     * (pg_blocking_pids) that is running the backfill's UPDATE, and the relation of the `tuple` lock that
     * backend holds (a waiter holds one on the row it waits for). Nothing else in the database counts.
     */
    async function waitingOn(): Promise<string[]> {
      for (let i = 0; i < 500; i++) {
        const rows = await watcher.unsafe<{ relname: string }[]>(
          `select c.relname::text as relname
             from pg_stat_activity a
             join pg_locks l on l.pid = a.pid and l.locktype = 'tuple'
             join pg_class c on c.oid = l.relation
            where $1::int = any(pg_blocking_pids(a.pid))
              and a.query like '%update public.event_images i%sha256(i.data) = $3::bytea%'`,
          [writerPid],
        );
        if (rows.length > 0) return rows.map((r) => r.relname);
        await new Promise((r) => setTimeout(r, 20));
      }
      return [];
    }
    let released: Promise<string[]> | undefined;
    try {
      const summary = await backfillEventImageMetadata(api.db, {
        apply: true,
        encode: async (input) => {
          // The organiser's upload, as putEventImage does it: the event row locked first, then the photo replaced.
          await two.unsafe("begin");
          await two.unsafe(`select 1 from public.events where id = $1 for no key update`, [event.eventId]);
          await two.unsafe(`update public.event_images set data = $2, content_type = 'image/png', updated_at = now() where event_id = $1`, [
            event.eventId,
            theirs.bytes,
          ]);
          // Committed only once the backfill's write is waiting, noting what it waits on. If watching fails,
          // the writer is rolled back straight away (so the backfill isn't left blocked) and the error rethrown.
          released = waitingOn().then(
            async (tables) => {
              await two.unsafe("commit");
              return tables;
            },
            async (err: unknown) => {
              await two.unsafe("rollback").catch(() => {});
              throw err;
            },
          );
          // Handled here so it isn't reported unhandled while the backfill runs; awaited (and rethrown) below.
          released.catch(() => {});
          return encodeEventImage(input);
        },
      });
      // It waited on the event row (locked first), not the photo's.
      expect(await released).toEqual(["events"]);
      expect(summary).toMatchObject({ cleaned: 0, skipped: 1 });
      const after = await stored(event.eventId);
      expect(after.data.equals(theirs.bytes)).toBe(true);
      expect(after.contentType).toBe("image/png");
    } finally {
      await two.end();
      await watcher.end();
    }
  });

  it("a second --apply finds nothing to do and writes nothing", async () => {
    const events = await Promise.all([0, 1, 2].map(() => publishedEvent(api, organiser, admin, FREE)));
    await storeRaw(events[0].eventId, await orientedJpegWithGps(), "image/jpeg");
    await storeRaw(events[1].eventId, await jpegWithIptcCommentAndTrailer(await pngWithTextChunks()), "image/jpeg");
    await storeRaw(events[2].eventId, await webpWithGpsAndCamera(), "image/webp");
    expect((await backfillEventImageMetadata(api.db, { apply: true })).cleaned).toBe(3);
    const after = await Promise.all(events.map((e) => stored(e.eventId)));

    expect(await backfillEventImageMetadata(api.db, { apply: true })).toMatchObject({
      total: 3,
      clean: 3,
      withMetadata: 0,
      cleaned: 0,
      skipped: 0,
      failed: 0,
    });
    expect(await Promise.all(events.map((e) => stored(e.eventId)))).toEqual(after);
    expect(await backfillEventImageMetadata(api.db)).toMatchObject({ wouldClean: 0, clean: 3 });
  });
});

describe("main", () => {
  it("dry-runs by default, exits 0, and never prints the connection string or a full event id", async () => {
    const event = await publishedEvent(api, organiser, admin, FREE);
    await storeRaw(event.eventId, await jpegWithGps(), "image/jpeg");
    const before = await stored(event.eventId);
    const deps = mainDeps();
    expect(await main(deps)).toBe(0);
    expect(await stored(event.eventId)).toEqual(before);
    const printed = [...deps.out, ...deps.err].join("\n");
    expect(printed).toMatch(/DRY RUN/);
    expect(printed).toMatch(/Would be re-encoded: +1/);
    expect(printed).toMatch(/Run again with --apply/);
    expect(printed).not.toContain(event.eventId);
    expect(printed).not.toContain("Sup3r-Secret-Pw");
    expect(printed).not.toContain("pooler.supabase.com");
  });

  it("refuses unknown arguments without connecting, and never echoes a connection string or key given as one", async () => {
    const unknown = mainDeps({ argv: ["--aply"] });
    expect(await main(unknown)).toBe(2);
    expect(unknown.err[0]).toBe('Unknown argument "--aply".');
    expect(unknown.connects).toBe(0);

    const long = mainDeps({ argv: ["x".repeat(80)] });
    expect(await main(long)).toBe(2);
    expect(long.err[0]).toBe("Unknown argument: an argument of 80 characters (not shown).");

    const url = "postgresql://postgres:Sup3r-Secret-Pw@db.example.supabase.co:5432/postgres";
    const pasted = mainDeps({ argv: ["--apply", url] });
    expect(await main(pasted)).toBe(2);
    expect(pasted.err[0]).toBe(CONNECTION_STRING_ADVICE);
    expect(pasted.err.join("\n")).not.toContain("Sup3r-Secret-Pw");
    expect(pasted.connects).toBe(0);

    const key = mainDeps({ argv: ["sk_live_" + "51FakeSecretKeyValue2222"] });
    expect(await main(key)).toBe(2);
    expect(key.err[0]).toBe(ROTATE_ADVICE);
  });

  it("honours --help only once every argument is known", async () => {
    const help = mainDeps({ argv: ["--help"] });
    expect(await main(help)).toBe(0);
    expect(help.out.join("\n")).toMatch(/^Usage:/);
    expect(help.connects).toBe(0);
    expect(await main(mainDeps({ argv: ["--apply", "-h"] }))).toBe(0);

    for (const argv of [["--aply", "--help"], ["--help", "--aply"], ["-h", "--dry"]]) {
      const deps = mainDeps({ argv });
      expect(await main(deps), argv.join(" ")).toBe(2);
      expect(deps.err[0]).toMatch(/^Unknown argument "--(aply|dry)"\.$/);
      expect(deps.connects).toBe(0);
    }
  });

  it("needs DATABASE_URL", async () => {
    const deps = mainDeps({ env: {} });
    expect(await main(deps)).toBe(2);
    expect(deps.err[0]).toMatch(/^Missing DATABASE_URL/);
    expect(deps.connects).toBe(0);
  });

  it("refuses a DATABASE_URL that doesn't name its host and database (no PGHOST / PGDATABASE fallback), without echoing it", async () => {
    for (const url of [
      "postgresql:///postgres",
      "postgresql://postgres:Sup3r-Secret-Pw@/postgres",
      "postgresql://postgres:Sup3r-Secret-Pw@db.secrethost.supabase.co:5432",
      "postgresql://postgres:Sup3r-Secret-Pw@db.secrethost.supabase.co:5432/",
      "postgresql://postgres:Sup3r-Secret-Pw@db.secrethost.supabase.co:5432?sslmode=require",
      "host=db.secrethost.supabase.co dbname=postgres password=Sup3r-Secret-Pw",
      "https://db.secrethost.supabase.co/postgres",
    ]) {
      const deps = mainDeps({ argv: ["--apply"], env: { DATABASE_URL: url } });
      expect(await main(deps), url).toBe(2);
      expect(deps.err[0]).toBe(DATABASE_URL_INCOMPLETE);
      expect(deps.err[0]).toMatch(/^DATABASE_URL /);
      expect(deps.connects).toBe(0);
      const printed = [...deps.out, ...deps.err].join("\n");
      expect(printed).not.toContain("Sup3r-Secret-Pw");
      expect(printed).not.toContain("secrethost");
    }
    // A list of hosts, as postgres.js reads it (commas in the host part, percent-encoded or not).
    for (const url of [
      "postgresql://postgres:Sup3r-Secret-Pw@db.abcdefgh.supabase.co,secrethost.example/postgres",
      "postgresql://postgres:Sup3r-Secret-Pw@db.abcdefgh.supabase.co:5432,secrethost.example:5432/postgres",
      "postgresql://postgres:Sup3r-Secret-Pw@db.abcdefgh.supabase.co%2Csecrethost.example/postgres",
    ]) {
      const deps = mainDeps({ argv: ["--apply"], env: { DATABASE_URL: url, DATABASE_CA_CERT: CA } });
      expect(await main(deps), url).toBe(2);
      expect(deps.err[0]).toBe(DATABASE_URL_ONE_HOST);
      expect(deps.connects).toBe(0);
      const printed = [...deps.out, ...deps.err].join("\n");
      expect(printed).not.toContain("Sup3r-Secret-Pw");
      expect(printed).not.toContain("secrethost");
    }
    // Supabase's URIs (direct, session and transaction pooler) name both, and run.
    for (const url of [
      "postgresql://postgres:Sup3r-Secret-Pw@db.abcdefgh.supabase.co:5432/postgres",
      "postgresql://postgres.abcdefgh:Sup3r-Secret-Pw@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres",
      "postgres://postgres.abcdefgh:Sup3r-Secret-Pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require",
    ]) {
      const deps = mainDeps({ env: { DATABASE_URL: url, DATABASE_CA_CERT: CA } });
      expect(await main(deps), url).toBe(0);
      expect(deps.connects).toBe(1);
    }
  });

  it("refuses a database off this computer without DATABASE_CA_CERT; one on it needs none", async () => {
    for (const url of [
      "postgresql://postgres.abcdefgh:Sup3r-Secret-Pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
      "postgresql://postgres:Sup3r-Secret-Pw@db.abcdefgh.supabase.co:5432/postgres?sslmode=verify-full",
      "postgresql://postgres:Sup3r-Secret-Pw@10.0.0.5:5432/postgres",
    ]) {
      for (const ca of [undefined, "", "   "]) {
        const deps = mainDeps({ argv: ["--apply"], env: { DATABASE_URL: url, DATABASE_CA_CERT: ca } });
        expect(await main(deps), url).toBe(2);
        expect(deps.err[0]).toBe(DATABASE_CA_CERT_REQUIRED);
        expect(deps.err[0]).toMatch(/^DATABASE_CA_CERT /);
        expect(deps.connects).toBe(0);
        expect([...deps.out, ...deps.err].join("\n")).not.toContain("Sup3r-Secret-Pw");
      }
    }
    for (const url of ["postgres://postgres@127.0.0.1:5432/postgres", "postgres://postgres@localhost/sheltuh_test"]) {
      const deps = mainDeps({ env: { DATABASE_URL: url } });
      expect(await main(deps), url).toBe(0);
      expect(deps.connects).toBe(1);
    }
  });

  it("connectBackfillDatabase: full verification against the CA off this computer, whatever sslmode says; never unverified", async () => {
    const remote = [
      "postgresql://postgres.abcdefgh:Sup3r-Secret-Pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
      "postgresql://postgres.abcdefgh:Sup3r-Secret-Pw@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require",
      "postgresql://postgres:Sup3r-Secret-Pw@db.abcdefgh.supabase.co:5432/postgres?sslmode=disable",
    ];
    for (const url of remote) {
      // Creating the client doesn't connect: nothing is sent.
      const connection = connectBackfillDatabase(url, { DATABASE_CA_CERT: CA });
      expect(connection.tls, url).toEqual({ ca: CA, rejectUnauthorized: true });
      await connection.end();
      // Without the CA it never falls back to unverified TLS ("require"): it throws, naming the variable only.
      let message = "";
      try {
        connectBackfillDatabase(url, {});
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/DATABASE_CA_CERT/);
      expect(message).not.toContain("Sup3r-Secret-Pw");
      expect(message).not.toContain("supabase");
    }
    // On this computer: left as the app leaves it (no TLS), CA or not.
    const local = connectBackfillDatabase("postgres://postgres@127.0.0.1:5432/postgres", {});
    expect(local.tls).toBe(false);
    await local.end();
  });

  it("a connection that can't be set up (DATABASE_CA_CERT isn't a PEM) stops with exit 2, redacted, and nothing to close", async () => {
    let ended = 0;
    const deps = mainDeps({ argv: ["--apply"] });
    deps.env.DATABASE_CA_CERT = "not-a-certificate-Zq9";
    deps.connect = (url, env) => {
      deps.connects += 1;
      const connection = connectBackfillDatabase(url, env);
      return { db: connection.db, end: async () => void (ended += 1) };
    };
    expect(await main(deps)).toBe(2);
    expect(deps.connects).toBe(1);
    expect(ended).toBe(0);
    expect(deps.err).toEqual([
      "The backfill couldn't set up the database connection: DATABASE_CA_CERT is set but isn't a PEM certificate (-----BEGIN CERTIFICATE----- …). Nothing was read or changed.",
    ]);
    const printed = [...deps.out, ...deps.err].join("\n");
    expect(printed).not.toContain("not-a-certificate-Zq9");
    expect(printed).not.toContain("Sup3r-Secret-Pw");
    expect(printed).not.toContain("pooler.supabase.com");
  });

  it("a database error stops the run (exit 1) with the connection string and password redacted from its message", async () => {
    const deps = mainDeps();
    const url = deps.env.DATABASE_URL!;
    deps.connect = () => ({
      db: {
        query: async () => {
          throw new Error(`connect failed for ${url} (password Sup3r-Secret-Pw)`);
        },
      },
      end: async () => {},
    });
    expect(await main(deps)).toBe(1);
    const printed = [...deps.out, ...deps.err].join("\n");
    expect(printed).toMatch(/The backfill stopped/);
    expect(printed).not.toContain("Sup3r-Secret-Pw");
    expect(printed).not.toContain(url);
  });
});
