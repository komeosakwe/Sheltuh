import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminPutEventImage } from "@/lib/server/handlers/admin-authoring";
import { getEventImage, MAX_EVENT_IMAGE_BYTES, putEventImage } from "@/lib/server/handlers/event-images";
import { AVATAR_ENCODE_CONCURRENCY } from "@/lib/server/avatar";
import { encodeEventImage, EVENT_IMAGE_ENCODE_TIMEOUT_SECONDS, MAX_EVENT_IMAGE_INPUT_PIXELS } from "@/lib/server/event-image";
import { crc32 } from "@/lib/server/png";
import { runHandler, type Handler } from "@/lib/server/route";
import { SITE_URL, TestApi } from "./helpers/api";
import { approvedOrganiser, draftEvent, signUpAdmin } from "./helpers/fixtures";
import {
  CAMERA_MAKE,
  CAMERA_SERIAL,
  GPS_SECONDS,
  jpegWithIptcCommentAndTrailer,
  orientedJpegWithGps,
  PLACE_TEXT,
  pngChunks,
  pngWithGps,
  pngWithTextChunks,
  SPLIT_PHOTO,
  tiffWithGps,
  webpChunks,
} from "./helpers/images";
import { createTestDb } from "./helpers/test-db";

// Event photos (lib/server/event-image.ts): whatever an upload carries (EXIF
// with GPS, a camera serial, an ICC profile, PNG text), what's stored and
// served is only pixels, the right way up. Both writers: the organiser's
// PUT /events/{id}/image and the admin's PUT /admin/events/{id}/image.

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
});

function upload(handler: Handler<{ eventId: string }>, eventId: string, body: Uint8Array, token: string) {
  return api.send(
    handler,
    new Request(`${SITE_URL}/api/test`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg" },
      body: new Uint8Array(body),
    }),
    { eventId },
  );
}

async function stored(eventId: string): Promise<{ contentType: string; bytes: Buffer }> {
  const [row] = await api.db.query<{ content_type: string; data: Uint8Array }>(
    `select content_type, data from public.event_images where event_id = $1`,
    [eventId],
  );
  expect(row).toBeDefined();
  return { contentType: row.content_type, bytes: Buffer.from(row.data) };
}

/** The JPEG's marker segments before the scan: proof there's no APPn (EXIF, XMP, ICC, IPTC) or comment segment. */
function jpegMarkers(bytes: Buffer): number[] {
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  const markers: number[] = [];
  for (let i = 2; i + 4 <= bytes.length && bytes[i] === 0xff; ) {
    const marker = bytes[i + 1];
    markers.push(marker);
    if (marker === 0xda) break; // start of scan: entropy-coded data follows
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return markers;
}

/** None of the upload's identifying bytes is anywhere in `bytes`. */
function expectNoLeak(bytes: Buffer) {
  for (const needle of [
    Buffer.from("Exif"),
    Buffer.from(CAMERA_MAKE),
    Buffer.from(CAMERA_SERIAL),
    GPS_SECONDS,
    Buffer.from("Fitzroy"),
    Buffer.from("Photoshop"),
    Buffer.from("8BIM"),
    Buffer.from("iTXt"),
    Buffer.from("zTXt"),
  ]) {
    expect(bytes.includes(needle), needle.toString("latin1")).toBe(false);
  }
}

async function expectNoMetadata(bytes: Buffer) {
  const meta = await sharp(bytes).metadata();
  expect(meta.exif).toBeUndefined();
  expect(meta.orientation).toBeUndefined();
  expect(meta.icc).toBeUndefined();
  expect(meta.xmp).toBeUndefined();
  expect(meta.iptc).toBeUndefined();
  expect(meta.comments).toBeUndefined();
  expectNoLeak(bytes);
}

/** The pixel at (x, y) as [r, g, b]. */
async function pixel(bytes: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [...data.subarray(at, at + 3)];
}

/** Within JPEG's tolerance of pure red or pure blue. */
const RED = (rgb: number[]) => rgb[0] > 200 && rgb[1] < 60 && rgb[2] < 60;
const BLUE = (rgb: number[]) => rgb[0] < 60 && rgb[1] < 60 && rgb[2] > 200;

describe("event photo uploads strip location and camera metadata", () => {
  it("the fixture really carries GPS, a camera serial, an ICC profile and a sideways orientation", async () => {
    const input = await orientedJpegWithGps();
    const meta = await sharp(input).metadata();
    expect(meta.exif).toBeDefined();
    expect(meta.icc).toBeDefined();
    expect(meta.orientation).toBe(6);
    expect([meta.width, meta.height]).toEqual([SPLIT_PHOTO.width, SPLIT_PHOTO.height]);
    expect(input.includes(Buffer.from(CAMERA_MAKE))).toBe(true);
    expect(input.includes(Buffer.from(CAMERA_SERIAL))).toBe(true);
    expect(input.includes(GPS_SECONDS)).toBe(true);
  });

  it.each([
    ["organiser", putEventImage, () => organiser.token],
    ["admin", adminPutEventImage, () => admin.token],
  ] as const)("%s upload: stored and served as a JPEG with no EXIF/GPS/ICC, turned the right way up", async (_who, handler, token) => {
    const draft = await draftEvent(api, organiser);
    const res = await upload(handler, draft.eventId, await orientedJpegWithGps(), token());
    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toMatch(new RegExp(`^/api/events/${draft.eventId}/image\\?v=\\d+$`));

    const { contentType, bytes } = await stored(draft.eventId);
    expect(contentType).toBe("image/jpeg");
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("jpeg");
    // Orientation 6 applied to the pixels: 120 × 80 stored sideways is 80 × 120 upright, red on top.
    expect([meta.width, meta.height]).toEqual([SPLIT_PHOTO.height, SPLIT_PHOTO.width]);
    expect(RED(await pixel(bytes, 40, 20))).toBe(true);
    expect(BLUE(await pixel(bytes, 40, 100))).toBe(true);
    await expectNoMetadata(bytes);
    // Only tables, frame and scan: no APP1 (EXIF/XMP), APP2 (ICC), APP13 (IPTC) or COM.
    for (const marker of jpegMarkers(bytes)) expect([0xe0, 0xdb, 0xc0, 0xc2, 0xc4, 0xdd, 0xda]).toContain(marker);

    // What's served is what's stored.
    const served = await runHandler(
      getEventImage,
      new Request(`${SITE_URL}/api/test`, { headers: { authorization: `Bearer ${organiser.token}` } }),
      { eventId: draft.eventId },
      api.deps,
    );
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.compare(Buffer.from(await served.arrayBuffer()), bytes)).toBe(0);
  });

  it("a PNG's eXIf and text chunks are dropped; it stays a PNG with its transparency", async () => {
    const input = await pngWithGps();
    expect(pngChunks(input)).toEqual(expect.arrayContaining(["eXIf", "tEXt"]));
    const draft = await draftEvent(api, organiser);
    expect((await upload(putEventImage, draft.eventId, input, organiser.token)).status).toBe(200);

    const { contentType, bytes } = await stored(draft.eventId);
    expect(contentType).toBe("image/png");
    for (const chunk of pngChunks(bytes)) expect(["IHDR", "PLTE", "tRNS", "pHYs", "IDAT", "IEND"]).toContain(chunk);
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([64, 48, true]);
    await expectNoMetadata(bytes);
  });

  it("a WebP's EXIF, XMP and ICC chunks are dropped", async () => {
    const input = await sharp({ create: { width: 50, height: 30, channels: 3, background: "#ff4800" } })
      .withIccProfile("p3")
      .withExif({ IFD0: { Make: CAMERA_MAKE, Model: CAMERA_SERIAL } })
      .withXmp(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>Fitzroy</rdf:Description></rdf:RDF></x:xmpmeta>`)
      .webp()
      .toBuffer();
    expect(webpChunks(input)).toEqual(expect.arrayContaining(["EXIF", "XMP ", "ICCP"]));
    const draft = await draftEvent(api, organiser);
    expect((await upload(putEventImage, draft.eventId, input, organiser.token)).status).toBe(200);

    const { contentType, bytes } = await stored(draft.eventId);
    expect(contentType).toBe("image/webp");
    for (const chunk of webpChunks(bytes)) expect(["VP8 ", "VP8L", "VP8X", "ALPH"]).toContain(chunk);
    expect([(await sharp(bytes).metadata()).width, (await sharp(bytes).metadata()).height]).toEqual([50, 30]);
    await expectNoMetadata(bytes);
  });

  it("drops IPTC (APP13), JPEG comments, data after EOI and PNG iTXt/zTXt", async () => {
    // The trailer is a whole PNG with iTXt and zTXt: an appended file, as some editors and polyglots leave.
    const textPng = await pngWithTextChunks();
    const jpeg = await jpegWithIptcCommentAndTrailer(textPng);
    // The fixtures really carry them, where a decoder sees them.
    expect(jpegMarkers(jpeg)).toEqual(expect.arrayContaining([0xed, 0xfe]));
    expect((await sharp(jpeg).metadata()).iptc).toBeDefined();
    expect(jpeg.subarray(jpeg.length - textPng.length).equals(textPng)).toBe(true);
    expect(pngChunks(textPng)).toEqual(expect.arrayContaining(["iTXt", "zTXt"]));
    expect((await sharp(textPng).metadata()).comments).toEqual([
      { keyword: "Description", text: PLACE_TEXT },
      { keyword: "Comment", text: `Camera ${CAMERA_SERIAL}` },
    ]);

    const draft = await draftEvent(api, organiser);
    expect((await upload(putEventImage, draft.eventId, jpeg, organiser.token)).status).toBe(200);
    const fromJpeg = await stored(draft.eventId);
    expect(fromJpeg.contentType).toBe("image/jpeg");
    for (const marker of jpegMarkers(fromJpeg.bytes)) expect([0xe0, 0xdb, 0xc0, 0xc2, 0xc4, 0xdd, 0xda]).toContain(marker);
    // Nothing after EOI: the first FF D9 is the last two bytes (entropy-coded data can't contain one).
    expect(fromJpeg.bytes.indexOf(Buffer.from([0xff, 0xd9]))).toBe(fromJpeg.bytes.length - 2);
    expect(fromJpeg.bytes.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    await expectNoMetadata(fromJpeg.bytes);

    expect((await upload(putEventImage, draft.eventId, textPng, organiser.token)).status).toBe(200);
    const fromPng = await stored(draft.eventId);
    expect(fromPng.contentType).toBe("image/png");
    for (const chunk of pngChunks(fromPng.bytes)) expect(["IHDR", "PLTE", "tRNS", "pHYs", "IDAT", "IEND"]).toContain(chunk);
    expect(fromPng.bytes.includes(deflatedSerial())).toBe(false);
    await expectNoMetadata(fromPng.bytes);
  });

  // Real encodes of 24- and 25-megapixel images: more than the default 5 s under a loaded full run.
  it(`refuses a photo over ${MAX_EVENT_IMAGE_INPUT_PIXELS / 1_000_000} megapixels from its header (400, nothing stored), however small the file`, { timeout: 30_000 }, async () => {
    const draft = await draftEvent(api, organiser);
    // 5000 × 5000 = 25 megapixels of one colour: a tiny file claiming a big canvas, under
    // sharp's own default limit (about 268 megapixels), so only our limit refuses it.
    const big = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(big.length).toBeLessThan(MAX_EVENT_IMAGE_BYTES);
    for (const [handler, token] of [
      [putEventImage, organiser.token],
      [adminPutEventImage, admin.token],
    ] as const) {
      const res = await upload(handler, draft.eventId, big, token);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["image"]);
    }
    expect(await api.db.query(`select 1 from public.event_images where event_id = $1`, [draft.eventId])).toEqual([]);
    // Exactly at the limit (4000 × 6000) decodes.
    const fits = await sharp({ create: { width: 4000, height: 6000, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .jpeg()
      .toBuffer();
    expect((await upload(putEventImage, draft.eventId, fits, organiser.token)).status).toBe(200);
  });

  it("refuses what doesn't decode as the format it claims (polyglots, corrupt files, pixel bombs): 400, nothing stored", async () => {
    const draft = await draftEvent(api, organiser);
    const svgBody = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    const pngSvg = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(svgBody)]);
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    // A real PNG whose header claims 20000 × 20000 (400 megapixels): refused from the header, never allocated.
    const bomb = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).png().toBuffer();
    bomb.writeUInt32BE(20_000, 16);
    bomb.writeUInt32BE(20_000, 20);
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
    for (const body of [pngSvg, corrupt, bomb]) {
      const res = await upload(putEventImage, draft.eventId, body, organiser.token);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["image"]);
    }
    expect(await api.db.query(`select 1 from public.event_images where event_id = $1`, [draft.eventId])).toEqual([]);
  });
});

describe("encodeEventImage", () => {
  // Stored 120 × 80, left half red and right half blue; where red ends up once shown the right way up.
  it.each([
    [1, [120, 80], "left"],
    [3, [120, 80], "right"],
    [6, [80, 120], "top"],
    [8, [80, 120], "bottom"],
  ] as const)("EXIF orientation %i is applied to the pixels (%j, red on the %s), and the tag dropped", async (orientation, size, red) => {
    const { bytes, contentType } = await encodeEventImage(await orientedJpegWithGps(orientation));
    expect(contentType).toBe("image/jpeg");
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height]).toEqual(size);
    const [w, h] = size;
    const [redAt, blueAt] = {
      left: [[w / 4, h / 2], [(3 * w) / 4, h / 2]],
      right: [[(3 * w) / 4, h / 2], [w / 4, h / 2]],
      top: [[w / 2, h / 4], [w / 2, (3 * h) / 4]],
      bottom: [[w / 2, (3 * h) / 4], [w / 2, h / 4]],
    }[red];
    expect(RED(await pixel(bytes, redAt[0], redAt[1]))).toBe(true);
    expect(BLUE(await pixel(bytes, blueAt[0], blueAt[1]))).toBe(true);
    await expectNoMetadata(bytes);
  });

  // Two real encodes of a 1.2-megapixel photo: more than the default 5 s under a loaded full run.
  it(`stops every encode after ${EVENT_IMAGE_ENCODE_TIMEOUT_SECONDS} seconds; a timed-out one is a 400, and its slot is freed`, { timeout: 30_000 }, async () => {
    const timeouts = vi.spyOn(sharp.prototype, "timeout");
    // The own-format encode and the WebP fallback both carry the limit (noisyPalettePng needs the fallback).
    await encodeEventImage(noisyPalettePng(1100));
    expect(timeouts).toHaveBeenCalledTimes(2);
    for (const [options] of timeouts.mock.calls) expect(options).toEqual({ seconds: EVENT_IMAGE_ENCODE_TIMEOUT_SECONDS });

    // What sharp does when the limit is hit: toBuffer rejects ("timeout: N% complete").
    // A real one would need a file that takes over 10 s to encode, so this fakes the rejection.
    const draft = await draftEvent(api, organiser);
    const photo = await orientedJpegWithGps();
    vi.spyOn(sharp.prototype, "toBuffer").mockRejectedValueOnce(new Error("timeout: 42% complete"));
    const res = await upload(putEventImage, draft.eventId, photo, organiser.token);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["image"]);
    expect(await api.db.query(`select 1 from public.event_images where event_id = $1`, [draft.eventId])).toEqual([]);
    // Its slot was given back: as many encodes as the slots and queue hold all go through (a lost slot would make one a 503).
    const all = AVATAR_ENCODE_CONCURRENCY.running + AVATAR_ENCODE_CONCURRENCY.waiting;
    const results = await Promise.allSettled(Array.from({ length: all }, () => encodeEventImage(photo)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(all);
    expect((await upload(putEventImage, draft.eventId, photo, organiser.token)).status).toBe(200);
  });

  // Real encodes of a 1.2-megapixel photo (three of them): more than the default 5 s under a loaded full run.
  it("a re-encode that would be over 2 MB in the upload's format is stored as WebP instead", { timeout: 30_000 }, async () => {
    // 1100 × 1100 of noise in a 256-colour palette, carrying EXIF: ~1.2 MB as uploaded, but
    // over 2 MB as the full-colour PNG libvips writes, and well under as WebP.
    const side = 1100;
    const input = noisyPalettePng(side);
    expect(input.length).toBeLessThanOrEqual(MAX_EVENT_IMAGE_BYTES);

    const { bytes, contentType } = await encodeEventImage(input);
    expect(contentType).toBe("image/webp");
    expect(bytes.length).toBeLessThanOrEqual(MAX_EVENT_IMAGE_BYTES);
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height]).toEqual([side, side]);
    for (const chunk of webpChunks(bytes)) expect(["VP8 ", "VP8L", "VP8X", "ALPH"]).toContain(chunk);
    await expectNoMetadata(bytes);
  });
});

/** A PNG chunk: length, type, data, CRC. */
function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * A `side` × `side` indexed-colour PNG of (deterministic) noise: 256 palette
 * colours, one byte a pixel, barely compressible; with an eXIf chunk (GPS,
 * serial). Written directly, so no quantiser runs.
 */
function noisyPalettePng(side: number): Buffer {
  let state = 12345;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state & 0xff;
  };
  const palette = Buffer.alloc(256 * 3);
  for (let i = 0; i < palette.length; i++) palette[i] = next();
  const rows = Buffer.alloc((side + 1) * side); // each row: filter byte 0, then indices
  for (let y = 0; y < side; y++) for (let x = 1; x <= side; x++) rows[y * (side + 1) + x] = next();
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8; // bit depth
  header[9] = 3; // colour type: indexed
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("eXIf", tiffWithGps({ serial: true })),
    pngChunk("PLTE", palette),
    pngChunk("IDAT", deflateSync(rows, { level: 1 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The zTXt fixture's serial as deflated in the upload: absent from what's stored. */
function deflatedSerial(): Buffer {
  return deflateSync(Buffer.from(`Camera ${CAMERA_SERIAL}`, "latin1"));
}
