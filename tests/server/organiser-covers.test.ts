import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decoder, MAX_AVATAR_INPUT_PIXELS } from "@/lib/server/avatar";
import {
  adminListOrganisers,
  adminRejectOrganiser,
  adminRemoveOrganiserCover,
  adminSuspendOrganiser,
} from "@/lib/server/handlers/admin";
import {
  COVER_CACHE,
  COVER_UNVERSIONED_CACHE,
  deleteMyOrganiserCover,
  getOrganiserCover,
  putMyOrganiserCover,
} from "@/lib/server/handlers/organiser-covers";
import { applyAsOrganiser, getMyOrganiser } from "@/lib/server/handlers/organisers";
import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import {
  COVER_QUALITIES,
  COVER_SIZE,
  COVER_SMALL_SIZE,
  COVER_UPLOAD_RATE_LIMIT,
  coverWebp,
  MAX_COVER_IMAGE_BYTES,
  MAX_COVER_SMALL_BYTES,
  MAX_COVER_UPLOAD_BYTES,
  type RawPixels,
} from "@/lib/server/organiser-cover";
import { runHandler, type Handler } from "@/lib/server/route";
import { SITE_URL, TestApi } from "./helpers/api";
import { application, approvedOrganiser, signUpAdmin } from "./helpers/fixtures";
import { CAMERA_MAKE, GPS_SECONDS, jpegWithGps, webpChunks } from "./helpers/images";
import { createTestDb } from "./helpers/test-db";

// Organiser covers: docs/architecture.md, "Organiser profiles";
// supabase/migrations/20261128000000_organiser_covers.sql.

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string; email: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rawRequest(method: string, token: string | undefined, body?: BodyInit, headers: Record<string, string> = {}) {
  return new Request(`${SITE_URL}/api/test`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body,
  });
}

function upload(token: string | undefined, body: Uint8Array, headers: Record<string, string> = {}, on = api) {
  // A copy into a plain ArrayBuffer-backed array (a Buffer's backing store isn't a BodyInit).
  return on.send(putMyOrganiserCover, rawRequest("PUT", token, new Uint8Array(body), headers));
}

const removeOwn = (token: string | undefined) => api.call(deleteMyOrganiserCover, { token, method: "DELETE" });

/** GET /organisers/{id}/cover as the raw Response (an image body). */
function getCover(
  organiserId: string,
  options: { token?: string; query?: string; headers?: Record<string, string>; on?: TestApi } = {},
) {
  const req = new Request(`${SITE_URL}/api/test${options.query ?? ""}`, {
    headers: { ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...options.headers },
  });
  return runHandler(getOrganiserCover as Handler<{ organiserId: string }>, req, { organiserId }, (options.on ?? api).deps);
}

async function storedCover(organiserId: string) {
  const [row] = await api.db.query<{ image: Uint8Array; small: Uint8Array; version: string }>(
    `select image, small, floor(extract(epoch from updated_at) * 1000)::bigint::text as version
       from private.organiser_covers where organiser_id = $1`,
    [organiserId],
  );
  return row ? { image: Buffer.from(row.image), small: Buffer.from(row.small), version: row.version } : undefined;
}

async function logEntries(organiserId: string) {
  return api.db.query<{ changed_fields: Record<string, { old: string | null; new: string | null }>; actor_id: string; reason: string | null }>(
    `select changed_fields, actor_id, reason from private.organiser_profile_edits where organiser_id = $1 order by id`,
    [organiserId],
  );
}

async function adminRecord(organiserId: string, status = "approved") {
  const res = await api.call(adminListOrganisers, { token: admin.token, query: { status } });
  return res.body.items.find((o: { organiserId: string }) => o.organiserId === organiserId);
}

async function suspend(organiserId: string) {
  const res = await api.call(adminSuspendOrganiser, {
    token: admin.token,
    params: { organiserId },
    body: { reason: "Impersonating another venue." },
  });
  expect(res.status).toBe(200);
}

const smallPng = () =>
  sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();

/** The RGB(A) of pixel (x, y) of an image. */
/** `length` bytes of pure noise, the same every run (xorshift32): the hardest thing to compress. */
function noise(length: number): Buffer {
  const out = Buffer.alloc(length);
  let x = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

async function pixel(bytes: Buffer, x: number, y: number) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return { r: data[at], g: data[at + 1], b: data[at + 2], channels: info.channels };
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

describe("PUT /organisers/me/cover: re-encoding", () => {
  it("re-encodes to 7:2 WebP (2240 × 640 and 1120 × 320) and strips EXIF, GPS, ICC and XMP", async () => {
    const input = await jpegWithGps();
    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.exif).toBeDefined();
    expect(inputMeta.icc).toBeDefined();
    expect(input.includes(Buffer.from(CAMERA_MAKE))).toBe(true);
    expect(input.includes(GPS_SECONDS)).toBe(true);

    const res = await upload(organiser.token, input, { "content-type": "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const stored = (await storedCover(organiser.organiserId))!;
    expect(res.body).toMatchObject({ organiserId: organiser.organiserId, status: "approved" });
    const base = `/api/organisers/${organiser.organiserId}/cover`;
    expect(res.body.coverUrl).toBe(`${base}?v=${stored.version}`);
    expect(res.body.coverSmallUrl).toBe(`${base}?size=small&v=${stored.version}`);
    expect(res.body.reviewedBy).toBeUndefined();

    for (const [bytes, size, max] of [
      [stored.image, COVER_SIZE, MAX_COVER_IMAGE_BYTES],
      [stored.small, COVER_SMALL_SIZE, MAX_COVER_SMALL_BYTES],
    ] as const) {
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("webp");
      expect([meta.width, meta.height]).toEqual([size.width, size.height]);
      expect(size.width * 2).toBe(size.height * 7);
      expect(bytes.length).toBeLessThanOrEqual(max);
      expect(meta.hasAlpha).toBe(false);
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      for (const chunk of webpChunks(bytes)) expect(["VP8 ", "VP8L", "VP8X"]).toContain(chunk);
      expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
      expect(bytes.includes(Buffer.from(CAMERA_MAKE))).toBe(false);
      expect(bytes.includes(GPS_SECONDS)).toBe(false);
    }
  });

  it("crops to fill from the centre (enlarging a small upload) and flattens transparency onto white", async () => {
    // 700 × 700: left third red, middle third green, right third blue. Cropped
    // to 7:2 from the centre, every corner keeps its colour band (a fitted
    // image would have bars), and it's enlarged to 2240 × 640.
    const bands = await sharp({ create: { width: 700, height: 700, channels: 3, background: "#ff0000" } })
      .composite([
        { input: { create: { width: 233, height: 700, channels: 3, background: "#00ff00" } }, left: 233, top: 0 },
        { input: { create: { width: 234, height: 700, channels: 3, background: "#0000ff" } }, left: 466, top: 0 },
      ])
      .png()
      .toBuffer();
    expect((await upload(organiser.token, bands)).status).toBe(200);
    let stored = (await storedCover(organiser.organiserId))!;
    for (const [x, y, colour] of [
      [5, 5, "r"],
      [5, 634, "r"],
      [1120, 320, "g"],
      [2234, 5, "b"],
      [2234, 634, "b"],
    ] as const) {
      const p = await pixel(stored.image, x, y);
      expect(p[colour], `${colour} at ${x},${y}`).toBeGreaterThan(200);
    }

    // Fully transparent black: white once flattened, never black.
    const clear = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    expect((await upload(organiser.token, clear)).status).toBe(200);
    stored = (await storedCover(organiser.organiserId))!;
    for (const bytes of [stored.image, stored.small]) {
      const flat = await pixel(bytes, 100, 100);
      expect(flat.channels).toBe(3);
      expect(Math.min(flat.r, flat.g, flat.b)).toBeGreaterThan(240);
      expect((await sharp(bytes).metadata()).hasAlpha).toBe(false);
    }
  });

  it("keeps a very detailed photo within its size bounds", async () => {
    const { width, height } = COVER_SIZE;
    const noise = Buffer.alloc(width * height * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const jpeg = await sharp(noise, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    expect(jpeg.length).toBeLessThan(MAX_COVER_UPLOAD_BYTES);
    expect((await upload(organiser.token, jpeg)).status).toBe(200);
    const stored = (await storedCover(organiser.organiserId))!;
    expect(stored.image.length).toBeLessThanOrEqual(MAX_COVER_IMAGE_BYTES);
    expect(stored.small.length).toBeLessThanOrEqual(MAX_COVER_SMALL_BYTES);
  });

  it("steps the WebP quality down (82, 70, 55, 40) until the output fits, and gives up below the last", { timeout: 60_000 }, async () => {
    // A small noise image keeps the encodes quick; the steps don't depend on the size.
    const size = { width: 448, height: 128 };
    const pixels: RawPixels = { data: noise(size.width * size.height * 3), ...size, channels: 3 };
    const at = (quality: number) =>
      sharp(pixels.data, { raw: { ...size, channels: 3 } })
        .resize(size.width, size.height, { fit: "cover", position: "centre" })
        .webp({ quality, effort: 4 })
        .toBuffer();
    const encodes = await Promise.all(COVER_QUALITIES.map(at));
    // Each step really is smaller (lower quality) than the one before.
    for (let i = 1; i < encodes.length; i++) expect(encodes[i].length).toBeLessThan(encodes[i - 1].length);
    for (let i = 0; i < encodes.length; i++) {
      // A bound just under the previous step's size: that step is skipped, this one is used.
      const bound = i === 0 ? encodes[0].length : encodes[i - 1].length - 1;
      expect([COVER_QUALITIES[i], (await coverWebp(pixels, size, bound))?.equals(encodes[i])]).toEqual([COVER_QUALITIES[i], true]);
    }
    expect(await coverWebp(pixels, size, encodes[encodes.length - 1].length - 1)).toBeNull();
  });

  it("even pure noise at full size fits both bounds by quality 70 (docs/architecture.md)", { timeout: 60_000 }, async () => {
    const { width, height } = COVER_SIZE;
    const pixels: RawPixels = { data: noise(width * height * 3), width, height, channels: 3 };
    for (const [size, max] of [
      [COVER_SIZE, MAX_COVER_IMAGE_BYTES],
      [COVER_SMALL_SIZE, MAX_COVER_SMALL_BYTES],
    ] as const) {
      const at70 = await sharp(pixels.data, { raw: { width, height, channels: 3 } })
        .resize(size.width, size.height, { fit: "cover", position: "centre" })
        .webp({ quality: 70, effort: 4 })
        .toBuffer();
      expect([size, at70.length <= max]).toEqual([size, true]);
    }
  });

  it.each([
    ["JPEG", () => sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#123456" } }).jpeg().toBuffer()],
    ["PNG", () => smallPng()],
    ["WebP", () => sharp({ create: { width: 40, height: 80, channels: 3, background: "#ff4800" } }).webp().toBuffer()],
  ])("accepts %s", async (_name, make) => {
    expect((await upload(organiser.token, await make())).status).toBe(200);
    expect((await sharp((await storedCover(organiser.organiserId))!.image).metadata()).width).toBe(COVER_SIZE.width);
  });

  it("refuses other formats, whatever the declared type, files that don't decode, and SVG behind an image signature (400 on cover)", async () => {
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).gif().toBuffer();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    // SVG markup behind a PNG or WebP signature. These pass the magic-byte sniff, but libvips (sharp 0.35)
    // picks its PNG or WebP loader from the same signature, which fails on the markup: they never reach
    // decoder's loader check (the test below covers that). No file was found that passes the sniff and
    // that libvips gives to another loader.
    const svgBody = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    const riffSvg = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x60, 0, 0, 0]), Buffer.from("WEBP"), Buffer.from(svgBody)]);
    const pngSvg = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(svgBody)]);
    for (const body of [gif, svg, corrupt, riffSvg, pngSvg, Buffer.alloc(0)]) {
      const res = await upload(organiser.token, body, { "content-type": "image/png" });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["cover"]);
    }
    expect(await storedCover(organiser.organiserId)).toBeUndefined();
    expect(await logEntries(organiser.organiserId)).toEqual([]);
  });

  it("decoder hands libvips nothing but its JPEG, PNG and WebP loaders, whatever it's given", async () => {
    // decoder is the second line: readCoverUpload's sniff refuses these first. Given them directly,
    // libvips would decode each (SVG with librsvg), so only the loader check refuses them.
    const formats = {
      svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'),
      gif: await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).gif().toBuffer(),
      tiff: await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).tiff().toBuffer(),
      heif: await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).avif().toBuffer(),
    };
    for (const [name, bytes] of Object.entries(formats)) {
      expect([name, (await sharp(bytes).metadata()).format]).toEqual([name, name]);
      const refused = await decoder(bytes, "cover").then(
        () => null,
        (err: unknown) => err,
      );
      expect([name, refused]).toEqual([name, expect.objectContaining({ statusCode: 400, fieldErrors: { cover: expect.any(String) } })]);
    }
    // And the formats it's for still go through.
    expect(await decoder(await smallPng(), "cover")).toBeTruthy();
  });

  it(`refuses over ${MAX_COVER_UPLOAD_BYTES / 1024 / 1024} MB (413), by declared length or as the stream runs past it`, async () => {
    const big = new Uint8Array(MAX_COVER_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    const streamed = await upload(organiser.token, big);
    expect(streamed.status).toBe(413);
    expect(Object.keys(streamed.body.fieldErrors)).toEqual(["cover"]);
    const declared = await upload(organiser.token, new Uint8Array([0xff, 0xd8, 0xff]), {
      "content-length": String(MAX_COVER_UPLOAD_BYTES + 1),
    });
    expect(declared.status).toBe(413);
    expect(await storedCover(organiser.organiserId)).toBeUndefined();
  });

  it(`refuses an image over ${MAX_AVATAR_INPUT_PIXELS / 1_000_000} megapixels from its header (400)`, async () => {
    const big = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(big.length).toBeLessThan(MAX_COVER_UPLOAD_BYTES);
    const res = await upload(organiser.token, big);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["cover"]);
    expect(await storedCover(organiser.organiserId)).toBeUndefined();
  });
});

describe("PUT /organisers/me/cover: who may", () => {
  it("needs a token (401) and an approved organiser (403), checked before the body is read", async () => {
    const png = await smallPng();
    expect((await upload(undefined, png)).status).toBe(401);

    const nobody = await api.signUp();
    const pendingUser = await api.signUp();
    await api.call(applyAsOrganiser, { token: pendingUser.token, body: application });
    const rejectedUser = await api.signUp();
    const rejected = await api.call(applyAsOrganiser, { token: rejectedUser.token, body: application });
    await api.call(adminRejectOrganiser, {
      token: admin.token,
      params: { organiserId: rejected.body.organiserId },
      body: { reason: "No" },
    });
    for (const token of [nobody.token, pendingUser.token, rejectedUser.token]) {
      // Not even a valid image, and over the size limit: the 403 comes before the body.
      const res = await upload(token, new Uint8Array([1, 2, 3]), { "content-length": String(MAX_COVER_UPLOAD_BYTES + 1) });
      expect(res.status).toBe(403);
    }
    const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from private.organiser_covers`);
    expect(n).toBe(0);
  });

  it(`allows ${COVER_UPLOAD_RATE_LIMIT.hits} uploads a day (429 on the next), separately from the logo's`, async () => {
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'organiser_cover_uploads', now(), $2)`,
      [organiser.userId, COVER_UPLOAD_RATE_LIMIT.hits - 1],
    );
    expect((await upload(organiser.token, await smallPng())).status).toBe(200);
    const refused = await upload(organiser.token, await smallPng());
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe(String(24 * 3600));
    const [{ buckets }] = await api.db.query<{ buckets: string[] }>(
      `select array_agg(bucket order by bucket) as buckets from private.rate_limits where user_id = $1`,
      [organiser.userId],
    );
    expect(buckets).toContain("organiser_cover_uploads");
    expect(buckets).not.toContain("organiser_logo_uploads");
  });

  it("an organiser taken down while the cover was uploading gets a 409, and nothing is written", async () => {
    // The takedown lands between the handler's check and the write.
    const racing = new TestApi({
      query: async (text, params) => {
        if (text.includes("private.put_organiser_cover")) {
          await api.db.query(`select * from private.suspend_organiser($1, $2, 'Taken down')`, [
            organiser.organiserId,
            admin.userId,
          ]);
        }
        return api.db.query(text, params);
      },
    });
    const token = racing.tokenFor({ userId: organiser.userId, email: organiser.email, emailVerified: true, isAdmin: false });
    const res = await upload(token, await smallPng(), {}, racing);
    expect(res.status).toBe(409);
    expect(await storedCover(organiser.organiserId)).toBeUndefined();
    const entries = await logEntries(organiser.organiserId);
    expect(entries.some((e) => "cover" in e.changed_fields)).toBe(false);
  });

  it("put_organiser_cover writes nothing for an organiser that isn't approved, or no organiser", async () => {
    await suspend(organiser.organiserId);
    const before = await logEntries(organiser.organiserId);
    const [{ result }] = await api.db.query<{ result: string }>(
      `select private.put_organiser_cover($1, '\\x01'::bytea, '\\x01'::bytea) as result`,
      [organiser.userId],
    );
    expect(result).toBe("not_approved");
    expect(await storedCover(organiser.organiserId)).toBeUndefined();
    expect(await logEntries(organiser.organiserId)).toEqual(before);
    const [{ none }] = await api.db.query<{ none: string }>(
      `select private.put_organiser_cover($1, '\\x01'::bytea, '\\x01'::bytea) as none`,
      [crypto.randomUUID()],
    );
    expect(none).toBe("not_found");
  });

  it("the table's checks bound the stored sizes", async () => {
    for (const [image, small] of [
      [`'\\x'::bytea`, `'\\x01'::bytea`],
      [`'\\x01'::bytea`, `'\\x'::bytea`],
      [`decode(repeat('00', ${MAX_COVER_IMAGE_BYTES + 1}), 'hex')`, `'\\x01'::bytea`],
      [`'\\x01'::bytea`, `decode(repeat('00', ${MAX_COVER_SMALL_BYTES + 1}), 'hex')`],
    ]) {
      await expect(
        api.db.query(`insert into private.organiser_covers (organiser_id, image, small) values ($1, ${image}, ${small})`, [
          organiser.organiserId,
        ]),
      ).rejects.toThrow(/check/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Log, delete, admin removal
// ---------------------------------------------------------------------------

describe("the organiser log", () => {
  it("logs an upload, a replacement and a delete (with versions, never the image); deleting nothing logs nothing", async () => {
    expect((await upload(organiser.token, await smallPng())).status).toBe(200);
    const first = (await storedCover(organiser.organiserId))!.version;
    expect((await upload(organiser.token, await smallPng())).status).toBe(200);
    const second = (await storedCover(organiser.organiserId))!.version;
    // A new cover is always a new version (URL and ETag).
    expect(BigInt(second)).toBeGreaterThan(BigInt(first));

    const deleted = await removeOwn(organiser.token);
    expect(deleted.status).toBe(200);
    expect(deleted.headers.get("cache-control")).toBe("private, no-store");
    expect(deleted.body.coverUrl).toBeUndefined();
    expect(deleted.body.coverSmallUrl).toBeUndefined();
    expect(deleted.body.organiserId).toBe(organiser.organiserId);
    // Idempotent: nothing to delete is the same 200, and logs nothing.
    expect((await removeOwn(organiser.token)).status).toBe(200);

    const entries = await logEntries(organiser.organiserId);
    expect(entries).toEqual([
      { changed_fields: { cover: { old: null, new: first } }, actor_id: organiser.userId, reason: null },
      { changed_fields: { cover: { old: first, new: second } }, actor_id: organiser.userId, reason: null },
      { changed_fields: { cover: { old: second, new: null } }, actor_id: organiser.userId, reason: null },
    ]);

    // The admin queue shows them as `cover` changes by the organiser.
    const record = await adminRecord(organiser.organiserId);
    expect(record.recentEdits.map((e: { changes: unknown }) => e.changes)).toEqual([
      { cover: { old: second, new: null } },
      { cover: { old: first, new: second } },
      { cover: { old: null, new: first } },
    ]);
    expect(record.recentEdits.every((e: { byStaff?: boolean }) => e.byStaff === undefined)).toBe(true);
  });

  it("an upload bumps the organiser's updatedAt", async () => {
    await api.db.query(`update public.organisers set updated_at = now() - interval '1 day' where id = $1`, [
      organiser.organiserId,
    ]);
    const before = (await api.call(getMyOrganiser, { token: organiser.token })).body.updatedAt;
    const res = await upload(organiser.token, await smallPng());
    expect(Date.parse(res.body.updatedAt)).toBeGreaterThan(Date.parse(before));
  });
});

describe("DELETE /organisers/me/cover", () => {
  it("needs a token (401) and an organiser (404)", async () => {
    expect((await removeOwn(undefined)).status).toBe(401);
    const nobody = await api.signUp();
    expect((await removeOwn(nobody.token)).status).toBe(404);
  });

  it("works for a suspended organiser", async () => {
    await upload(organiser.token, await smallPng());
    await suspend(organiser.organiserId);
    const res = await removeOwn(organiser.token);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.coverUrl).toBeUndefined();
    expect(await storedCover(organiser.organiserId)).toBeUndefined();
  });

  it("only ever removes the caller's own cover", async () => {
    const other = await approvedOrganiser(api, admin, { displayName: "Other Org" });
    await upload(other.token, await smallPng());
    expect((await removeOwn(organiser.token)).status).toBe(200);
    expect(await storedCover(other.organiserId)).toBeDefined();
  });
});

describe("POST /admin/organisers/{id}/remove-cover", () => {
  const removeCover = (token: string | undefined, organiserId: string, body: unknown) =>
    api.call(adminRemoveOrganiserCover, { token, params: { organiserId }, body });

  it("removes it with a reason, logged as the Sheltüh team's edit; nothing to remove is a no-op", async () => {
    await upload(organiser.token, await smallPng());
    const version = (await storedCover(organiser.organiserId))!.version;

    const res = await removeCover(admin.token, organiser.organiserId, { reason: "Not their photo" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.coverUrl).toBeUndefined();
    expect(res.body.recentEdits[0]).toEqual({
      kind: "profile_edit",
      at: expect.any(String),
      changes: { cover: { old: version, new: null } },
      reason: "Not their photo",
      byStaff: true,
    });
    expect(await storedCover(organiser.organiserId)).toBeUndefined();
    expect((await getCover(organiser.organiserId)).status).toBe(404);

    const again = await removeCover(admin.token, organiser.organiserId, { reason: "Again" });
    expect(again.status).toBe(200);
    expect(again.body.recentEdits).toHaveLength(2);
  });

  it("works whatever the organiser's status", async () => {
    await upload(organiser.token, await smallPng());
    await suspend(organiser.organiserId);
    const res = await removeCover(admin.token, organiser.organiserId, { reason: "Gone" });
    expect(res.status).toBe(200);
    expect(await storedCover(organiser.organiserId)).toBeUndefined();
  });

  it("is admin only (401, 403), needs a reason (400) and a known organiser (404)", async () => {
    await upload(organiser.token, await smallPng());
    expect((await removeCover(undefined, organiser.organiserId, { reason: "x" })).status).toBe(401);
    expect((await removeCover(organiser.token, organiser.organiserId, { reason: "x" })).status).toBe(403);
    for (const body of [{}, { reason: "" }, { reason: "x".repeat(501) }, { reason: "bad\u0000" }]) {
      const res = await removeCover(admin.token, organiser.organiserId, body);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["reason"]);
    }
    expect((await removeCover(admin.token, crypto.randomUUID(), { reason: "x" })).status).toBe(404);
    expect((await removeCover(admin.token, "not-a-uuid", { reason: "x" })).status).toBe(404);
    expect(await storedCover(organiser.organiserId)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

describe("GET /organisers/{id}/cover", () => {
  it("is public for an approved organiser: WebP, shared at the CDN at its current version, ETag and 304", async () => {
    await upload(organiser.token, await smallPng());
    const { version } = (await storedCover(organiser.organiserId))!;

    const res = await getCover(organiser.organiserId, { query: `?v=${version}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // As a logo: an hour at the CDN, max-age as long.
    expect(COVER_CACHE).toBe("public, max-age=3600, s-maxage=3600");
    expect(res.headers.get("cache-control")).toBe(COVER_CACHE);
    expect(res.headers.get("etag")).toBe(`"${version}-l"`);
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(COVER_SIZE.width);

    const small = await getCover(organiser.organiserId, { query: `?size=small&v=${version}` });
    expect(small.headers.get("etag")).toBe(`"${version}-s"`);
    expect(small.headers.get("cache-control")).toBe(COVER_CACHE);
    expect((await sharp(Buffer.from(await small.arrayBuffer())).metadata()).width).toBe(COVER_SMALL_SIZE.width);

    const notModified = await getCover(organiser.organiserId, { headers: { "if-none-match": `"${version}-l"` } });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("etag")).toBe(`"${version}-l"`);
    // No `v`: browser only.
    expect(notModified.headers.get("cache-control")).toBe(COVER_UNVERSIONED_CACHE);
    expect((await notModified.arrayBuffer()).byteLength).toBe(0);
    const notModifiedVersioned = await getCover(organiser.organiserId, {
      query: `?v=${version}`,
      headers: { "if-none-match": `"${version}-l"` },
    });
    expect([notModifiedVersioned.status, notModifiedVersioned.headers.get("cache-control")]).toEqual([304, COVER_CACHE]);
    // The other size's ETag, an old version's, or a logo's, gets the image.
    for (const etag of [`"${version}-s"`, `"1-l"`, `"${version}-f"`]) {
      expect((await getCover(organiser.organiserId, { headers: { "if-none-match": etag } })).status).toBe(200);
    }
    // Any other `v` still serves the current cover, but never shared.
    expect(COVER_UNVERSIONED_CACHE).toBe("private, max-age=3600");
    for (const query of ["", "?v=1", `?v=${Number(version) + 1}`, `?size=small&v=${version}0`]) {
      const other = await getCover(organiser.organiserId, { query });
      expect([query, other.status, other.headers.get("cache-control")]).toEqual([query, 200, COVER_UNVERSIONED_CACHE]);
    }
  });

  it("is a 404 for unknown organisers and organisers without a cover", async () => {
    for (const organiserId of [crypto.randomUUID(), organiser.organiserId]) {
      const res = await getCover(organiserId);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("is a 404 for an id that isn't a uuid, without touching the database", async () => {
    let queries = 0;
    const counting = new TestApi({
      query: async (text, params) => {
        queries += 1;
        return api.db.query(text, params);
      },
    });
    for (const organiserId of ["me", "not-a-uuid", "1 or 1=1", ""]) {
      expect((await getCover(organiserId, { on: counting })).status).toBe(404);
    }
    expect(queries).toBe(0);
  });

  it("once the organiser isn't approved: a 404 for the public and other members, private for an admin or the owner", async () => {
    await upload(organiser.token, await smallPng());
    const { version } = (await storedCover(organiser.organiserId))!;
    await suspend(organiser.organiserId);

    const stranger = await api.signUp();
    for (const options of [
      {},
      { token: "forged" },
      { token: stranger.token },
      // A matching ETag is no way round it.
      { headers: { "if-none-match": `"${version}-l"` } },
    ]) {
      const res = await getCover(organiser.organiserId, options);
      expect(res.status).toBe(404);
    }

    for (const token of [admin.token, organiser.token]) {
      const res = await getCover(organiser.organiserId, { token, query: "?size=small" });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(COVER_SMALL_SIZE.width);
    }
  });
});

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

describe("cover URLs in the API's payloads", () => {
  it("coverUrl and coverSmallUrl on /organisers/me, the public profile and the admin queue", async () => {
    const profile = () => api.call(getPublicOrganiserProfile, { params: { organiserId: organiser.organiserId } });
    // None yet: the fields are absent.
    for (const body of [
      (await api.call(getMyOrganiser, { token: organiser.token })).body,
      (await profile()).body,
      await adminRecord(organiser.organiserId),
    ]) {
      expect(body.coverUrl).toBeUndefined();
      expect(body.coverSmallUrl).toBeUndefined();
    }

    await upload(organiser.token, await smallPng());
    const { version } = (await storedCover(organiser.organiserId))!;
    const base = `/api/organisers/${organiser.organiserId}/cover`;
    const urls = { coverUrl: `${base}?v=${version}`, coverSmallUrl: `${base}?size=small&v=${version}` };

    expect((await api.call(getMyOrganiser, { token: organiser.token })).body).toMatchObject(urls);
    expect((await profile()).body).toMatchObject(urls);
    expect(await adminRecord(organiser.organiserId)).toMatchObject(urls);

    // The URLs serve what they say, shared at the CDN.
    for (const url of Object.values(urls)) {
      const res = await getCover(organiser.organiserId, { query: url.slice(base.length) });
      expect([res.status, res.headers.get("cache-control")]).toEqual([200, COVER_CACHE]);
    }
  });
});
