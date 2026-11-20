import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_MEMBER_PHOTO_UPLOAD_BYTES, MAX_MEMBER_PHOTOS } from "@/lib/member-photo-rules";
import {
  AVATAR_ENCODE_CONCURRENCY,
  encodeAvatar,
  encodeMemberPhoto,
  MEMBER_PHOTO_MAX_BYTES,
  MEMBER_PHOTO_THUMB_MAX_BYTES,
  webpWithin,
} from "@/lib/server/avatar";
import { adminGetMemberProfile, AVATAR_VIEW_RATE_LIMIT, getMemberAvatar, getMemberProfile } from "@/lib/server/handlers/member-profiles";
import {
  deleteMyPhoto,
  getMemberPhoto,
  patchMyPhoto,
  PHOTO_UPLOAD_RATE_LIMIT,
  postMyPhoto,
} from "@/lib/server/handlers/profile-photos";
import { deleteMyProfile, getMyProfile, putMyAvatar } from "@/lib/server/handlers/profiles";
import { runHandler, type Handler } from "@/lib/server/route";
import { SITE_URL, TestApi } from "./helpers/api";
import { signUpAdmin } from "./helpers/fixtures";
import { CAMERA_MAKE, GPS_SECONDS, jpegWithGps, webpChunks } from "./helpers/images";
import { member, suspend, type Member } from "./helpers/members";
import { createTestDb } from "./helpers/test-db";

// Member photos: docs/architecture.md, "Member photos";
// supabase/migrations/20261125000000_profile_photos.sql. Runs on PGlite, and
// on real Postgres with TEST_DATABASE_URL (the concurrency block needs it).

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_MEMBER_PHOTOS", "1");
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
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

function upload(token: string | undefined, body: Uint8Array, headers: Record<string, string> = {}) {
  // A copy into a plain ArrayBuffer-backed array (a Buffer's backing store isn't a BodyInit).
  return api.send(postMyPhoto, rawRequest("POST", token, new Uint8Array(body), headers));
}

const describePhoto = (token: string | undefined, photoId: string, body: unknown) =>
  api.call(patchMyPhoto, { token, params: { photoId }, body, method: "PATCH" });
const remove = (token: string | undefined, photoId: string) =>
  api.call(deleteMyPhoto, { token, params: { photoId }, method: "DELETE" });
const me = (token: string) => api.call(getMyProfile, { token });

/** A small PNG; each `n` is a different colour, so a different image (and SHA-256). */
const png = (n = 0, size = 64) =>
  sharp({ create: { width: size, height: size, channels: 3, background: { r: n % 256, g: (n * 7) % 256, b: 90 } } })
    .png()
    .toBuffer();

/** Random pixels: the hardest thing to compress. */
function noise(width: number, height: number, channels: 3 | 4 = 3) {
  const data = Buffer.alloc(width * height * channels);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.floor(Math.random() * 256);
  return sharp(data, { raw: { width, height, channels } });
}

function serve(token: string | undefined, profileId: string, photoId: string, query = "", headers: Record<string, string> = {}) {
  return runHandler(
    getMemberPhoto,
    new Request(`${SITE_URL}/api/test${query}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } }),
    { profileId, photoId },
    api.deps,
  );
}

async function raw<P extends Record<string, string>>(handler: Handler<P>, req: Request, params: P) {
  return runHandler(handler, req, params, api.deps);
}

async function profileIdOf(m: { userId: string }): Promise<string> {
  const [row] = await api.db.query<{ public_id: string }>(`select public_id from public.profiles where user_id = $1`, [m.userId]);
  return row.public_id;
}

async function makeVisible(m: { userId: string }, visible = true) {
  await api.db.query(`update public.profiles set profile_visible = $2 where user_id = $1`, [m.userId, visible]);
}

async function block(blocker: { userId: string }, blocked: { userId: string }) {
  await api.db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [blocker.userId, blocked.userId]);
}

async function photoCount(m: { userId: string }): Promise<number> {
  const [row] = await api.db.query<{ n: number }>(`select count(*)::int as n from private.profile_photos where user_id = $1`, [
    m.userId,
  ]);
  return row.n;
}

async function uploadsUsed(m: { userId: string }): Promise<number> {
  const [row] = await api.db.query<{ hits: number }>(
    `select hits from private.rate_limits where user_id = $1 and bucket = 'profile_photo_uploads'`,
    [m.userId],
  );
  return row?.hits ?? 0;
}

async function storedPhoto(photoId: string) {
  const [row] = await api.db.query<{ image: Uint8Array; thumb: Uint8Array; width: number; height: number }>(
    `select image, thumb, width, height from private.profile_photos where id = $1`,
    [photoId],
  );
  return { image: Buffer.from(row.image), thumb: Buffer.from(row.thumb), width: row.width, height: row.height };
}

/** `count` photos for `m`, through the API. Returns their ids, oldest first. */
async function addPhotos(m: Member, count: number, from = 0): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const res = await upload(m.token, await png(from + i + 1));
    if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
    ids.push(res.body.photo.photoId);
  }
  return ids;
}

/** A member with a visible profile and one photo. */
async function withPhoto(options: { visible?: boolean } = {}) {
  const m = await member(api);
  const [photoId] = await addPhotos(m, 1);
  if (options.visible !== false) await makeVisible(m);
  return { ...m, profileId: await profileIdOf(m), photoId };
}

function expectNoMetadata(bytes: Buffer, meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>) {
  expect(meta.format).toBe("webp");
  expect(meta.exif).toBeUndefined();
  expect(meta.icc).toBeUndefined();
  expect(meta.xmp).toBeUndefined();
  // Only image data chunks: no EXIF, ICCP or XMP chunk at all.
  for (const chunk of webpChunks(bytes)) expect(["VP8 ", "VP8L", "VP8X", "ALPH"]).toContain(chunk);
  expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
  expect(bytes.includes(Buffer.from(CAMERA_MAKE))).toBe(false);
  expect(bytes.includes(GPS_SECONDS)).toBe(false);
}

// ---------------------------------------------------------------------------
// The encoder
// ---------------------------------------------------------------------------

describe("encodeMemberPhoto", () => {
  it("keeps the shape without enlarging, makes a 320 px square thumbnail, and strips EXIF, GPS, ICC and XMP", async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    expect(input.includes(GPS_SECONDS)).toBe(true);

    const out = await encodeMemberPhoto(input);
    expect([out.width, out.height]).toEqual([900, 600]);
    const image = await sharp(out.image).metadata();
    expect([image.width, image.height]).toEqual([900, 600]);
    expectNoMetadata(out.image, image);
    const thumb = await sharp(out.thumb).metadata();
    expect([thumb.width, thumb.height]).toEqual([320, 320]);
    expectNoMetadata(out.thumb, thumb);
  });

  it("fits a big photo inside 1080 px, either way round, and applies the EXIF orientation", async () => {
    const wide = await encodeMemberPhoto(
      await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#336699" } }).jpeg().toBuffer(),
    );
    expect([wide.width, wide.height]).toEqual([1080, 720]);
    // Stored 400 × 200 with "rotate 90° clockwise": shown 200 × 400.
    const rotated = await encodeMemberPhoto(
      await sharp({ create: { width: 400, height: 200, channels: 3, background: "#996633" } })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    );
    expect([rotated.width, rotated.height]).toEqual([200, 400]);
    const meta = await sharp(rotated.image).metadata();
    expect([meta.width, meta.height, meta.orientation]).toEqual([200, 400, undefined]);
  });

  it(`noise, the worst case, still fits ${MEMBER_PHOTO_MAX_BYTES / 1024} KB and ${MEMBER_PHOTO_THUMB_MAX_BYTES / 1024} KB; transparency is flattened`, async () => {
    for (const input of [
      await noise(2000, 2000).png().toBuffer(),
      await noise(1500, 1500, 4).png().toBuffer(),
    ]) {
      const out = await encodeMemberPhoto(input);
      expect(out.image.length).toBeLessThanOrEqual(MEMBER_PHOTO_MAX_BYTES);
      expect(out.thumb.length).toBeLessThanOrEqual(MEMBER_PHOTO_THUMB_MAX_BYTES);
      expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(1080);
      const meta = await sharp(out.image).metadata();
      expect([meta.width, meta.height, meta.hasAlpha]).toEqual([out.width, out.height, false]);
    }
  }, 60_000);

  it("past the lowest quality it shrinks, and reports the size it really encoded", async () => {
    // 301 × 199 of noise can't fit 4 KB at any quality: only shrinking gets there, and
    // fitting inside the shrunk box can come out a pixel under it.
    const { data, info } = await noise(301, 199).raw().toBuffer({ resolveWithObject: true });
    const out = await webpWithin({ data, width: info.width, height: info.height, channels: 3 }, 4096, [40]);
    expect(out.data.length).toBeLessThanOrEqual(4096);
    expect(out.width).toBeLessThan(301);
    const meta = await sharp(out.data).metadata();
    expect([out.width, out.height]).toEqual([meta.width, meta.height]);
  });

  it("is deterministic: the same upload makes the same bytes (so a retry finds the first)", async () => {
    const input = await jpegWithGps();
    const [a, b] = [await encodeMemberPhoto(input), await encodeMemberPhoto(input)];
    expect(a.image.equals(b.image)).toBe(true);
    expect(a.thumb.equals(b.thumb)).toBe(true);
  });

  it("refuses an image over 24 megapixels from its header (400 on photo)", async () => {
    const big = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#010203" } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(encodeMemberPhoto(big)).rejects.toMatchObject({ statusCode: 400, fieldErrors: { photo: expect.any(String) } });
  });

  it(`shares the profile photos' decode slots: ${AVATAR_ENCODE_CONCURRENCY.running} at once, ${AVATAR_ENCODE_CONCURRENCY.waiting} waiting, then 503`, async () => {
    const input = await png();
    const total = AVATAR_ENCODE_CONCURRENCY.running + AVATAR_ENCODE_CONCURRENCY.waiting + 1;
    // Half profile photos, half member photos: one queue.
    const results = await Promise.allSettled(
      Array.from({ length: total }, (_, i) => (i % 2 === 0 ? encodeAvatar(input) : encodeMemberPhoto(input))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(total - 1);
    const [refused] = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(refused.reason).toMatchObject({ statusCode: 503 });
    expect((await encodeMemberPhoto(input)).thumb.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Uploading
// ---------------------------------------------------------------------------

describe("POST /profiles/me/photos", () => {
  it("201 with the photo and the profile; the photo is listed on GET /me, oldest first", async () => {
    const m = await member(api);
    const profileId = await profileIdOf(m);
    const res = await upload(m.token, await jpegWithGps(), { "content-type": "image/jpeg" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const { photo, profile } = res.body;
    expect(Object.keys(photo).sort()).toEqual(["height", "photoId", "thumbUrl", "url", "width"]);
    expect(photo).toEqual({
      photoId: expect.any(String),
      url: `/api/profiles/${profileId}/photos/${photo.photoId}`,
      thumbUrl: `/api/profiles/${profileId}/photos/${photo.photoId}?size=thumb`,
      width: 900,
      height: 600,
    });
    expect(profile.photos).toEqual([photo]);
    expect(profile.profileId).toBe(profileId);

    const stored = await storedPhoto(photo.photoId);
    expect([stored.width, stored.height]).toEqual([900, 600]);
    expectNoMetadata(stored.image, await sharp(stored.image).metadata());

    const second = await upload(m.token, await png(9));
    expect(second.status).toBe(201);
    expect((await me(m.token)).body.photos.map((p: { photoId: string }) => p.photoId)).toEqual([
      photo.photoId,
      second.body.photo.photoId,
    ]);
    expect(JSON.stringify(res.body)).not.toContain(m.userId);
  });

  it("the same image again is a 200 with the photo already there, adding nothing", async () => {
    const m = await member(api);
    const image = await png(3);
    const first = await upload(m.token, image);
    expect(first.status).toBe(201);
    const again = await upload(m.token, image);
    expect(again.status).toBe(200);
    expect(again.body.photo).toEqual(first.body.photo);
    expect(await photoCount(m)).toBe(1);
    // Another member's copy of the same image is their own photo.
    const other = await member(api);
    expect((await upload(other.token, image)).status).toBe(201);
  });

  it(`at ${MAX_MEMBER_PHOTOS} photos it's a 409 photos_full, before the allowance, the body or the decoder`, async () => {
    const m = await member(api);
    await addPhotos(m, MAX_MEMBER_PHOTOS);
    const used = await uploadsUsed(m);
    expect(used).toBe(MAX_MEMBER_PHOTOS);
    for (const body of [await png(99), Buffer.from("not an image at all")]) {
      const res = await upload(m.token, body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("photos_full");
    }
    expect(await uploadsUsed(m)).toBe(used);
    expect(await photoCount(m)).toBe(MAX_MEMBER_PHOTOS);
    // Deleting one makes room.
    const [oldest] = (await me(m.token)).body.photos;
    expect((await remove(m.token, oldest.photoId)).status).toBe(204);
    expect((await upload(m.token, await png(99))).status).toBe(201);
  });

  it("the database holds the line too: add_profile_photo says full, and a direct 7th insert fails", async () => {
    const m = await member(api);
    await addPhotos(m, MAX_MEMBER_PHOTOS);
    const { image, thumb, width, height } = await encodeMemberPhoto(await png(77));
    const [res] = await api.db.query<{ result: string; photo_id: string | null }>(
      `select * from private.add_profile_photo($1, $2::bytea, $3::bytea, $4, $5)`,
      [m.userId, image, thumb, width, height],
    );
    expect(res).toEqual({ result: "full", photo_id: null });
    await expect(
      api.db.query(
        `insert into private.profile_photos (user_id, image, thumb, image_sha256, width, height)
         values ($1, $2::bytea, $3::bytea, sha256($2::bytea), $4, $5)`,
        [m.userId, image, thumb, width, height],
      ),
    ).rejects.toThrow(/at most 6 photos/);
    // A mismatched hash, an oversized image, a too-long or multi-line description: refused by constraints.
    const other = await member(api);
    for (const [sql, params] of [
      [`insert into private.profile_photos (user_id, image, thumb, image_sha256, width, height) values ($1, $2::bytea, $2::bytea, sha256('x'::bytea), 10, 10)`, [other.userId, image]],
      [`insert into private.profile_photos (user_id, image, thumb, image_sha256, width, height) values ($1, $2::bytea, $2::bytea, sha256($2::bytea), 1081, 10)`, [other.userId, thumb]],
    ] as const) {
      await expect(api.db.query(sql, [...params])).rejects.toThrow();
    }
    const [{ photo_id }] = await api.db.query<{ photo_id: string }>(
      `select photo_id from private.add_profile_photo($1, $2::bytea, $3::bytea, $4, $5)`,
      [other.userId, image, thumb, width, height],
    );
    for (const bad of ["x".repeat(101), "two\nlines", " padded"]) {
      await expect(
        api.db.query(`update private.profile_photos set description = $2 where id = $1`, [photo_id, bad]),
      ).rejects.toThrow();
    }
  });

  it("needs sign-in (401), a verified email (403), a profile (404), no suspension (403), and 20 a day (429)", async () => {
    const image = await png();
    expect((await upload(undefined, image)).status).toBe(401);
    const unverified = await member(api, { emailVerified: false });
    expect((await upload(unverified.token, image)).status).toBe(403);
    const none = await member(api, { profile: false });
    expect((await upload(none.token, image)).status).toBe(404);
    const suspended = await member(api);
    await suspend(api, suspended);
    expect((await upload(suspended.token, image)).status).toBe(403);
    for (const m of [unverified, none, suspended]) expect(await uploadsUsed(m)).toBe(0);

    const m = await member(api);
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'profile_photo_uploads', now(), $2)`,
      [m.userId, PHOTO_UPLOAD_RATE_LIMIT.hits],
    );
    expect((await upload(m.token, image)).status).toBe(429);
    expect(await photoCount(m)).toBe(0);
    // Its own bucket: the profile photo's allowance is untouched.
    expect((await api.send(putMyAvatar, rawRequest("PUT", m.token, new Uint8Array(image)))).status).toBe(200);
  });

  it("refuses other formats, whatever the declared type, and files that don't decode (400 on photo)", async () => {
    const m = await member(api);
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).gif().toBuffer();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    const svgBody = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    const riffSvg = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x60, 0, 0, 0]), Buffer.from("WEBP"), Buffer.from(svgBody)]);
    const pngSvg = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(svgBody)]);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(32)]);
    for (const body of [gif, svg, corrupt, riffSvg, pngSvg, heic, Buffer.alloc(0)]) {
      const res = await upload(m.token, body, { "content-type": "image/jpeg" });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["photo"]);
    }
    expect(await photoCount(m)).toBe(0);
  });

  it.each([
    ["PNG", () => png(5)],
    ["WebP", () => sharp({ create: { width: 40, height: 80, channels: 3, background: "#ff4800" } }).webp().toBuffer()],
  ])("accepts %s", async (_name, make) => {
    const m = await member(api);
    expect((await upload(m.token, await make())).status).toBe(201);
  });

  it("refuses over 4 MB (413), by declared length or as the stream runs past it", async () => {
    const m = await member(api);
    const big = new Uint8Array(MAX_MEMBER_PHOTO_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    const streamed = await upload(m.token, big);
    expect(streamed.status).toBe(413);
    expect(Object.keys(streamed.body.fieldErrors)).toEqual(["photo"]);
    const declared = await upload(m.token, new Uint8Array([0xff, 0xd8, 0xff]), {
      "content-length": String(MAX_MEMBER_PHOTO_UPLOAD_BYTES + 1),
    });
    expect(declared.status).toBe(413);
    expect(await photoCount(m)).toBe(0);
  });

  it("503 while NEXT_PUBLIC_MEMBER_PHOTOS isn't 1 (the default), after sign-in, using nothing", async () => {
    const m = await member(api);
    for (const value of ["", "0", "true", undefined]) {
      vi.stubEnv("NEXT_PUBLIC_MEMBER_PHOTOS", value);
      const res = await upload(m.token, await png());
      expect(res.status, String(value)).toBe(503);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["photo"]);
    }
    expect((await upload(undefined, await png())).status).toBe(401);
    expect(await photoCount(m)).toBe(0);
    expect(await uploadsUsed(m)).toBe(0);
    vi.stubEnv("NEXT_PUBLIC_MEMBER_PHOTOS", "1");
    expect((await upload(m.token, await png())).status).toBe(201);
  });

  it("describing, deleting and seeing photos don't depend on the flag", async () => {
    const target = await withPhoto();
    vi.stubEnv("NEXT_PUBLIC_MEMBER_PHOTOS", "");
    const viewer = await member(api);
    expect((await serve(viewer.token, target.profileId, target.photoId)).status).toBe(200);
    expect((await describePhoto(target.token, target.photoId, { description: "Hi" })).status).toBe(200);
    expect((await remove(target.token, target.photoId)).status).toBe(204);
    expect(await photoCount(target)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Descriptions and deleting
// ---------------------------------------------------------------------------

describe("PATCH /profiles/me/photos/{photoId}", () => {
  it("sets the description (on one line) and clears it with null or blank", async () => {
    const m = await member(api);
    const [photoId] = await addPhotos(m, 1);
    const res = await describePhoto(m.token, photoId, { description: "  Me at  the\nNorthcote   Social Club 🎶 " });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.photo).toMatchObject({ photoId, description: "Me at the Northcote Social Club 🎶" });
    expect(res.body.profile.photos).toEqual([res.body.photo]);
    expect((await describePhoto(m.token, photoId, { description: "x".repeat(100) })).status).toBe(200);
    for (const cleared of [null, "", "   "]) {
      const off = await describePhoto(m.token, photoId, { description: cleared });
      expect(off.status).toBe(200);
      expect(off.body.photo.description).toBeUndefined();
    }
  });

  it("refuses a description that renders blank (Hangul fillers, blank Braille, other default-ignorables); emoji joiners and flags are fine", async () => {
    const m = await member(api);
    const [photoId] = await addPhotos(m, 1);
    for (const blank of ["\u3164", "\u3164\u3164 \u3164", "\u2800", "\u115F\u1160", "hi\u3164", "a\u034Fb", "x\uFE00"]) {
      const res = await describePhoto(m.token, photoId, { description: blank });
      expect([JSON.stringify(blank), res.status]).toEqual([JSON.stringify(blank), 400]);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["description"]);
    }
    for (const fine of ["👩\u200D💻 coding", "❤\uFE0F gig", "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} away game", "1\uFE0F\u20E3 first"]) {
      const res = await describePhoto(m.token, photoId, { description: fine });
      expect([JSON.stringify(fine), res.status]).toEqual([JSON.stringify(fine), 200]);
      expect(res.body.photo.description).toBe(fine);
    }
  });

  it("an upper-case photo id works like the lower-case one", async () => {
    const m = await member(api);
    const [photoId] = await addPhotos(m, 1);
    await makeVisible(m);
    const upper = photoId.toUpperCase();
    const res = await describePhoto(m.token, upper, { description: "Loud" });
    expect(res.status).toBe(200);
    expect(res.body.photo).toMatchObject({ photoId, description: "Loud" });

    const profileId = await profileIdOf(m);
    const viewer = await member(api);
    const served = await serve(viewer.token, profileId.toUpperCase(), upper);
    expect(served.status).toBe(200);
    expect(served.headers.get("etag")).toBe(`"${photoId}-f"`);
    expect((await serve(viewer.token, profileId, upper, "", { "if-none-match": `"${photoId}-f"` })).status).toBe(304);

    expect((await remove(m.token, upper)).status).toBe(204);
    expect(await photoCount(m)).toBe(0);
  });

  it("400 for too long, a link, invisible characters or no description field", async () => {
    const m = await member(api);
    const [photoId] = await addPhotos(m, 1);
    for (const body of [
      { description: "x".repeat(101) },
      { description: "see sheltuh.com.au" },
      { description: "https://example.com" },
      { description: "hidden​text" },
      { description: "flipped ‮text" },
      { description: 42 },
      {},
    ]) {
      const res = await describePhoto(m.token, photoId, body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["description"]);
    }
  });

  it("another member's photo, an unknown or malformed id is a 404; 401, 403 unverified or suspended", async () => {
    const owner = await withPhoto();
    const other = await member(api);
    expect((await describePhoto(other.token, owner.photoId, { description: "Mine now" })).status).toBe(404);
    expect((await describePhoto(owner.token, crypto.randomUUID(), { description: "Hi" })).status).toBe(404);
    expect((await describePhoto(owner.token, "not-a-uuid", { description: "Hi" })).status).toBe(404);
    expect((await describePhoto(undefined, owner.photoId, { description: "Hi" })).status).toBe(401);
    const unverified = api.tokenFor({ userId: owner.userId, email: owner.email, emailVerified: false, isAdmin: false });
    expect((await describePhoto(unverified, owner.photoId, { description: "Hi" })).status).toBe(403);
    await suspend(api, owner);
    expect((await describePhoto(owner.token, owner.photoId, { description: "Hi" })).status).toBe(403);
    const [row] = await api.db.query<{ description: string | null }>(`select description from private.profile_photos where id = $1`, [
      owner.photoId,
    ]);
    expect(row.description).toBeNull();
  });
});

describe("DELETE /profiles/me/photos/{photoId}", () => {
  it("is idempotent (204); another member's photo or a malformed id is a no-op; signed in is enough", async () => {
    const owner = await withPhoto();
    const other = await member(api);
    expect((await remove(other.token, owner.photoId)).status).toBe(204);
    expect((await remove(other.token, "nope")).status).toBe(204);
    expect(await photoCount(owner)).toBe(1);
    expect((await remove(undefined, owner.photoId)).status).toBe(401);

    // Suspended and unverified members can always remove their own.
    await suspend(api, owner);
    const unverified = api.tokenFor({ userId: owner.userId, email: owner.email, emailVerified: false, isAdmin: false });
    expect((await remove(unverified, owner.photoId)).status).toBe(204);
    expect((await remove(owner.token, owner.photoId)).status).toBe(204);
    expect(await photoCount(owner)).toBe(0);
  });

  it("photos go with the profile, and with the account", async () => {
    const m = await member(api);
    await addPhotos(m, 2);
    expect((await api.call(deleteMyProfile, { token: m.token, method: "DELETE" })).status).toBe(204);
    expect(await photoCount(m)).toBe(0);

    const n = await member(api);
    await addPhotos(n, 2);
    await api.db.query(`delete from auth.users where id = $1`, [n.userId]);
    expect(await photoCount(n)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

describe("GET /profiles/{profileId}/photos/{photoId}", () => {
  it("serves a visible profile's photo to verified members with a profile: private, revalidated, never public", async () => {
    const target = await withPhoto();
    const viewer = await member(api);
    const res = await serve(viewer.token, target.profileId, target.photoId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("etag")).toBe(`"${target.photoId}-f"`);
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(64);

    const thumb = await serve(viewer.token, target.profileId, target.photoId, "?size=thumb");
    expect(thumb.headers.get("etag")).toBe(`"${target.photoId}-t"`);
    const meta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([320, 320]);

    const notModified = await serve(viewer.token, target.profileId, target.photoId, "", { "if-none-match": `"${target.photoId}-f"` });
    expect([notModified.status, notModified.headers.get("cache-control")]).toEqual([304, "private, no-cache"]);
  });

  it("the same 404 when hidden, blocked either way, suspended either way, or the viewer has no profile; 401/403 for the caller", async () => {
    const hidden = await withPhoto({ visible: false });
    const viewer = await member(api);
    const status = async (token: string, t: { profileId: string; photoId: string }) =>
      (await serve(token, t.profileId, t.photoId)).status;
    expect(await status(viewer.token, hidden)).toBe(404);
    // The owner sees their own, hidden or not.
    expect(await status(hidden.token, hidden)).toBe(200);

    const target = await withPhoto();
    const blocker = await member(api);
    await block(blocker, target);
    expect(await status(blocker.token, target)).toBe(404);
    const blocked = await member(api);
    await block(target, blocked);
    expect(await status(blocked.token, target)).toBe(404);

    const noProfile = await member(api, { profile: false });
    expect(await status(noProfile.token, target)).toBe(404);
    expect((await serve(undefined, target.profileId, target.photoId)).status).toBe(401);
    const unverified = await member(api, { emailVerified: false });
    expect(await status(unverified.token, target)).toBe(403);

    const suspendedViewer = await member(api);
    expect(await status(suspendedViewer.token, target)).toBe(200);
    await suspend(api, suspendedViewer);
    expect(await status(suspendedViewer.token, target)).toBe(404);

    expect(await status(viewer.token, target)).toBe(200);
    await suspend(api, target);
    const gone = await serve(viewer.token, target.profileId, target.photoId);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "Photo not found." });
  });

  it("another member's photo id under this profile, an unknown id or a malformed one: the same 404", async () => {
    const a = await withPhoto();
    const b = await withPhoto();
    const viewer = await member(api);
    const answers = await Promise.all(
      [
        [a.profileId, b.photoId],
        [a.profileId, crypto.randomUUID()],
        [crypto.randomUUID(), a.photoId],
        ["nope", a.photoId],
        [a.profileId, "nope"],
      ].map(async ([profileId, photoId]) => {
        const res = await serve(viewer.token, profileId, photoId);
        return [res.status, await res.json()];
      }),
    );
    for (const answer of answers) expect(answer).toEqual([404, { error: "Photo not found." }]);
    // Even for admins and owners: a photo is only served under its own profile.
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect((await serve(admin.token, a.profileId, b.photoId)).status).toBe(404);
    expect((await serve(b.token, a.profileId, b.photoId)).status).toBe(404);
  });

  it("If-None-Match never gets a 304 past the visibility check: hidden or blocked since, it's a 404", async () => {
    const target = await withPhoto();
    const viewer = await member(api);
    const etag = (await serve(viewer.token, target.profileId, target.photoId)).headers.get("etag")!;
    await makeVisible(target, false);
    const hidden = await serve(viewer.token, target.profileId, target.photoId, "", { "if-none-match": etag });
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("etag")).toBeNull();
    await makeVisible(target);
    expect((await serve(viewer.token, target.profileId, target.photoId, "", { "if-none-match": etag })).status).toBe(304);
    await block(target, viewer);
    expect((await serve(viewer.token, target.profileId, target.photoId, "", { "if-none-match": etag })).status).toBe(404);
  });

  it("admins can see any photo, whatever its visibility; every admin read is logged by ids only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const hidden = await withPhoto({ visible: false });
    expect((await serve(admin.token, hidden.profileId, hidden.photoId)).status).toBe(200);
    expect((await serve(admin.token, hidden.profileId, hidden.photoId, "?size=thumb")).status).toBe(200);
    const logged = info.mock.calls.flat().map(String);
    expect(logged).toEqual([
      `Admin ${admin.userId} read photo ${hidden.photoId} of member profile ${hidden.profileId}.`,
      `Admin ${admin.userId} read the thumbnail of photo ${hidden.photoId} of member profile ${hidden.profileId}.`,
    ]);
    expect(logged.join("\n")).not.toContain(hidden.userId);
    // Admins aren't rate-limited.
    const [row] = await api.db.query<{ n: number }>(`select count(*)::int as n from private.rate_limits where user_id = $1`, [admin.userId]);
    expect(row.n).toBe(0);
  });

  it(`shares the profile photos' view limit (${AVATAR_VIEW_RATE_LIMIT.hits} per ${AVATAR_VIEW_RATE_LIMIT.window}, 304s included)`, async () => {
    const target = await withPhoto();
    const viewer = await member(api);
    expect((await serve(viewer.token, target.profileId, target.photoId)).status).toBe(200);
    const [row] = await api.db.query<{ hits: number }>(
      `select hits from private.rate_limits where user_id = $1 and bucket = 'avatar_views'`,
      [viewer.userId],
    );
    expect(row.hits).toBe(1);
    await api.db.query(`update private.rate_limits set hits = $2 where user_id = $1 and bucket = 'avatar_views'`, [
      viewer.userId,
      AVATAR_VIEW_RATE_LIMIT.hits,
    ]);
    expect((await serve(viewer.token, target.profileId, target.photoId)).status).toBe(429);
    expect((await serve(viewer.token, target.profileId, target.photoId, "", { "if-none-match": `"${target.photoId}-f"` })).status).toBe(429);
    // The same bucket as the profile photo.
    expect((await raw(getMemberAvatar, rawRequest("GET", viewer.token), { profileId: target.profileId })).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Profiles carry their photos
// ---------------------------------------------------------------------------

describe("photos on profiles", () => {
  it("a member profile lists its photos only when the viewer may see it; admins see them on any profile", async () => {
    const target = await member(api);
    const ids = await addPhotos(target, 2);
    await describePhoto(target.token, ids[1], { description: "Second" });
    const profileId = await profileIdOf(target);
    const viewer = await member(api);

    // Hidden: the 404, with nothing about the photos.
    const hidden = await api.call(getMemberProfile, { token: viewer.token, params: { profileId } });
    expect(hidden.status).toBe(404);
    expect(JSON.stringify(hidden.body)).not.toContain(ids[0]);

    await makeVisible(target);
    const res = await api.call(getMemberProfile, { token: viewer.token, params: { profileId } });
    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual([
      { photoId: ids[0], url: `/api/profiles/${profileId}/photos/${ids[0]}`, thumbUrl: `/api/profiles/${profileId}/photos/${ids[0]}?size=thumb`, width: 64, height: 64 },
      { photoId: ids[1], url: `/api/profiles/${profileId}/photos/${ids[1]}`, thumbUrl: `/api/profiles/${profileId}/photos/${ids[1]}?size=thumb`, width: 64, height: 64, description: "Second" },
    ]);

    await block(target, viewer);
    expect((await api.call(getMemberProfile, { token: viewer.token, params: { profileId } })).status).toBe(404);

    vi.spyOn(console, "info").mockImplementation(() => {});
    await makeVisible(target, false);
    const asAdmin = await api.call(adminGetMemberProfile, { token: admin.token, params: { profileId } });
    expect(asAdmin.body.photos.map((p: { photoId: string }) => p.photoId)).toEqual(ids);
  });

  it("GET /profiles/me always has the list (empty with none)", async () => {
    const m = await member(api);
    expect((await me(m.token)).body.photos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

// PGlite is one connection, so this runs only with TEST_DATABASE_URL; the
// API's postgres.js pool runs up to 5 requests at once.
describe.skipIf(!process.env.TEST_DATABASE_URL)("uploads at once (real Postgres only)", () => {
  it(`at ${MAX_MEMBER_PHOTOS - 1} photos, of several different uploads at once exactly one is added`, async () => {
    const m = await member(api);
    await addPhotos(m, MAX_MEMBER_PHOTOS - 1);
    const images = await Promise.all([png(201), png(202), png(203)]);
    const results = await Promise.all(images.map((image) => upload(m.token, image)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    for (const r of results.filter((r) => r.status === 409)) expect(r.body.code).toBe("photos_full");
    expect(await photoCount(m)).toBe(MAX_MEMBER_PHOTOS);
  });

  it("the same image twice at once: one photo, both answers name it", async () => {
    const m = await member(api);
    const image = await png(300);
    const results = await Promise.all([upload(m.token, image), upload(m.token, image)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.photo.photoId).toBe(results[1].body.photo.photoId);
    expect(await photoCount(m)).toBe(1);
  });
});
