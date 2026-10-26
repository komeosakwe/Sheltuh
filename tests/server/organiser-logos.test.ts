import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "@/lib/image";
import { MAX_AVATAR_INPUT_PIXELS } from "@/lib/server/avatar";
import {
  adminListEvents,
  adminListOrganisers,
  adminRejectOrganiser,
  adminRemoveOrganiserLogo,
  adminSuspendOrganiser,
} from "@/lib/server/handlers/admin";
import { getMyEvent } from "@/lib/server/handlers/events";
import {
  deleteMyOrganiserLogo,
  getOrganiserLogo,
  LOGO_CACHE,
  LOGO_UNVERSIONED_CACHE,
  putMyOrganiserLogo,
} from "@/lib/server/handlers/organiser-logos";
import { applyAsOrganiser, getMyOrganiser } from "@/lib/server/handlers/organisers";
import { getPublicEventBySlug, listPublicEvents } from "@/lib/server/handlers/public-events";
import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import { LOGO_UPLOAD_RATE_LIMIT, MAX_LOGO_UPLOAD_BYTES } from "@/lib/server/organiser-logo";
import { runHandler, type Handler } from "@/lib/server/route";
import { SITE_URL, TestApi } from "./helpers/api";
import { application, approvedOrganiser, draftEvent, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { CAMERA_MAKE, GPS_SECONDS, jpegWithGps, webpChunks } from "./helpers/images";
import { createTestDb } from "./helpers/test-db";

// Organiser logos: docs/architecture.md, "Organiser profiles";
// supabase/migrations/20261105000000_organiser_logos.sql.

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
  return on.send(putMyOrganiserLogo, rawRequest("PUT", token, new Uint8Array(body), headers));
}

const removeOwn = (token: string | undefined) => api.call(deleteMyOrganiserLogo, { token, method: "DELETE" });

/** GET /organisers/{id}/logo as the raw Response (an image body). */
function getLogo(
  organiserId: string,
  options: { token?: string; query?: string; headers?: Record<string, string>; on?: TestApi } = {},
) {
  const req = new Request(`${SITE_URL}/api/test${options.query ?? ""}`, {
    headers: { ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...options.headers },
  });
  return runHandler(getOrganiserLogo as Handler<{ organiserId: string }>, req, { organiserId }, (options.on ?? api).deps);
}

async function storedLogo(organiserId: string) {
  const [row] = await api.db.query<{ image: Uint8Array; thumb: Uint8Array; version: string }>(
    `select image, thumb, floor(extract(epoch from updated_at) * 1000)::bigint::text as version
       from private.organiser_logos where organiser_id = $1`,
    [organiserId],
  );
  return row ? { image: Buffer.from(row.image), thumb: Buffer.from(row.thumb), version: row.version } : undefined;
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
async function pixel(bytes: Buffer, x: number, y: number) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return { r: data[at], g: data[at + 1], b: data[at + 2], channels: info.channels };
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

describe("PUT /organisers/me/logo: re-encoding", () => {
  it("the browser's downsizer aims under the same limit as the server", () => {
    expect(MAX_UPLOAD_BYTES).toBe(MAX_LOGO_UPLOAD_BYTES);
  });

  it("re-encodes to square WebP (512 and 96 px) and strips EXIF, GPS, ICC and XMP", async () => {
    const input = await jpegWithGps();
    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.exif).toBeDefined();
    expect(inputMeta.icc).toBeDefined();
    expect(input.includes(Buffer.from(CAMERA_MAKE))).toBe(true);
    expect(input.includes(GPS_SECONDS)).toBe(true);

    const res = await upload(organiser.token, input, { "content-type": "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const stored = (await storedLogo(organiser.organiserId))!;
    expect(res.body).toMatchObject({ organiserId: organiser.organiserId, status: "approved" });
    expect(res.body.logoUrl).toBe(`/api/organisers/${organiser.organiserId}/logo?v=${stored.version}`);
    expect(res.body.reviewedBy).toBeUndefined();

    for (const [bytes, size] of [
      [stored.image, 512],
      [stored.thumb, 96],
    ] as const) {
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("webp");
      expect([meta.width, meta.height]).toEqual([size, size]);
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

  it("fits the whole logo on white (not cropped) and flattens transparency onto white", async () => {
    // 400 × 100 opaque red, with an alpha channel: fitted, it's a red band across the middle.
    const wide = await sharp({ create: { width: 400, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
      .png()
      .toBuffer();
    expect((await upload(organiser.token, wide)).status).toBe(200);
    let stored = (await storedLogo(organiser.organiserId))!;
    const centre = await pixel(stored.image, 256, 256);
    expect(centre.channels).toBe(3);
    expect(centre.r).toBeGreaterThan(200);
    expect(centre.g).toBeLessThan(60);
    for (const [x, y] of [
      [0, 0],
      [511, 0],
      [0, 511],
      [511, 511],
      [256, 20],
    ]) {
      const corner = await pixel(stored.image, x, y);
      expect(Math.min(corner.r, corner.g, corner.b)).toBeGreaterThan(240);
    }
    const thumbCorner = await pixel(stored.thumb, 0, 0);
    expect(Math.min(thumbCorner.r, thumbCorner.g, thumbCorner.b)).toBeGreaterThan(240);

    // Fully transparent black: white once flattened, never black.
    const clear = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    expect((await upload(organiser.token, clear)).status).toBe(200);
    stored = (await storedLogo(organiser.organiserId))!;
    const flat = await pixel(stored.image, 256, 256);
    expect(Math.min(flat.r, flat.g, flat.b)).toBeGreaterThan(240);
    expect((await sharp(stored.image).metadata()).hasAlpha).toBe(false);
  });

  it.each([
    ["JPEG", () => sharp({ create: { width: 300, height: 200, channels: 3, background: "#123456" } }).jpeg().toBuffer()],
    ["PNG", () => smallPng()],
    ["WebP", () => sharp({ create: { width: 40, height: 80, channels: 3, background: "#ff4800" } }).webp().toBuffer()],
  ])("accepts %s", async (_name, make) => {
    expect((await upload(organiser.token, await make())).status).toBe(200);
    expect((await sharp((await storedLogo(organiser.organiserId))!.image).metadata()).width).toBe(512);
  });

  it("refuses other formats, whatever the declared type, and files that don't decode (400 on logo)", async () => {
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).gif().toBuffer();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    // Polyglots: a valid image signature followed by SVG markup.
    const svgBody = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    const riffSvg = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x60, 0, 0, 0]), Buffer.from("WEBP"), Buffer.from(svgBody)]);
    const pngSvg = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(svgBody)]);
    for (const body of [gif, svg, corrupt, riffSvg, pngSvg, Buffer.alloc(0)]) {
      const res = await upload(organiser.token, body, { "content-type": "image/png" });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["logo"]);
    }
    expect(await storedLogo(organiser.organiserId)).toBeUndefined();
    expect(await logEntries(organiser.organiserId)).toEqual([]);
  });

  it(`refuses over ${MAX_LOGO_UPLOAD_BYTES / 1024 / 1024} MB (413), by declared length or as the stream runs past it`, async () => {
    const big = new Uint8Array(MAX_LOGO_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    const streamed = await upload(organiser.token, big);
    expect(streamed.status).toBe(413);
    expect(Object.keys(streamed.body.fieldErrors)).toEqual(["logo"]);
    const declared = await upload(organiser.token, new Uint8Array([0xff, 0xd8, 0xff]), {
      "content-length": String(MAX_LOGO_UPLOAD_BYTES + 1),
    });
    expect(declared.status).toBe(413);
    expect(await storedLogo(organiser.organiserId)).toBeUndefined();
  });

  it(`refuses an image over ${MAX_AVATAR_INPUT_PIXELS / 1_000_000} megapixels from its header (400)`, async () => {
    const big = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(big.length).toBeLessThan(MAX_LOGO_UPLOAD_BYTES);
    const res = await upload(organiser.token, big);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["logo"]);
    expect(await storedLogo(organiser.organiserId)).toBeUndefined();
  });
});

describe("PUT /organisers/me/logo: who may", () => {
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
      // Not even a valid image: the 403 comes before the body.
      const res = await upload(token, new Uint8Array([1, 2, 3]));
      expect(res.status).toBe(403);
    }
    const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from private.organiser_logos`);
    expect(n).toBe(0);
  });

  it(`allows ${LOGO_UPLOAD_RATE_LIMIT.hits} uploads a day (429 after)`, async () => {
    await api.db.query(
      `insert into private.rate_limits (user_id, bucket, window_started_at, hits) values ($1, 'organiser_logo_uploads', now(), $2)`,
      [organiser.userId, LOGO_UPLOAD_RATE_LIMIT.hits],
    );
    expect((await upload(organiser.token, await smallPng())).status).toBe(429);
    expect(await storedLogo(organiser.organiserId)).toBeUndefined();
  });

  it("an organiser taken down while the logo was uploading gets a 409, and nothing is written", async () => {
    // The takedown lands between the handler's check and the write.
    const racing = new TestApi({
      query: async (text, params) => {
        if (text.includes("private.put_organiser_logo")) {
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
    expect(await storedLogo(organiser.organiserId)).toBeUndefined();
  });

  it("put_organiser_logo writes nothing for an organiser that isn't approved", async () => {
    await suspend(organiser.organiserId);
    const before = await logEntries(organiser.organiserId);
    const [{ result }] = await api.db.query<{ result: string }>(
      `select private.put_organiser_logo($1, '\\x01'::bytea, '\\x01'::bytea) as result`,
      [organiser.userId],
    );
    expect(result).toBe("not_approved");
    expect(await storedLogo(organiser.organiserId)).toBeUndefined();
    expect(await logEntries(organiser.organiserId)).toEqual(before);
    const [{ none }] = await api.db.query<{ none: string }>(
      `select private.put_organiser_logo($1, '\\x01'::bytea, '\\x01'::bytea) as none`,
      [crypto.randomUUID()],
    );
    expect(none).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// Log, delete, admin removal
// ---------------------------------------------------------------------------

describe("the organiser log", () => {
  it("logs an upload, a replacement and a delete (with versions, never the image); deleting nothing logs nothing", async () => {
    expect((await upload(organiser.token, await smallPng())).status).toBe(200);
    const first = (await storedLogo(organiser.organiserId))!.version;
    expect((await upload(organiser.token, await smallPng())).status).toBe(200);
    const second = (await storedLogo(organiser.organiserId))!.version;
    // A new logo is always a new version (URL and ETag).
    expect(BigInt(second)).toBeGreaterThan(BigInt(first));

    const deleted = await removeOwn(organiser.token);
    expect(deleted.status).toBe(200);
    expect(deleted.headers.get("cache-control")).toBe("private, no-store");
    expect(deleted.body.logoUrl).toBeUndefined();
    expect(deleted.body.organiserId).toBe(organiser.organiserId);
    // Idempotent: nothing to delete is the same 200, and logs nothing.
    expect((await removeOwn(organiser.token)).status).toBe(200);

    const entries = await logEntries(organiser.organiserId);
    expect(entries).toEqual([
      { changed_fields: { logo: { old: null, new: first } }, actor_id: organiser.userId, reason: null },
      { changed_fields: { logo: { old: first, new: second } }, actor_id: organiser.userId, reason: null },
      { changed_fields: { logo: { old: second, new: null } }, actor_id: organiser.userId, reason: null },
    ]);

    // The admin queue shows them as `logo` changes by the organiser.
    const record = await adminRecord(organiser.organiserId);
    expect(record.recentEdits.map((e: { changes: unknown }) => e.changes)).toEqual([
      { logo: { old: second, new: null } },
      { logo: { old: first, new: second } },
      { logo: { old: null, new: first } },
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

describe("DELETE /organisers/me/logo", () => {
  it("needs a token (401) and an organiser (404)", async () => {
    expect((await removeOwn(undefined)).status).toBe(401);
    const nobody = await api.signUp();
    expect((await removeOwn(nobody.token)).status).toBe(404);
  });

  it("works for a suspended organiser, and the public never sees it", async () => {
    await upload(organiser.token, await smallPng());
    await suspend(organiser.organiserId);
    const res = await removeOwn(organiser.token);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.logoUrl).toBeUndefined();
    expect(await storedLogo(organiser.organiserId)).toBeUndefined();
  });
});

describe("POST /admin/organisers/{id}/remove-logo", () => {
  const removeLogo = (token: string | undefined, organiserId: string, body: unknown) =>
    api.call(adminRemoveOrganiserLogo, { token, params: { organiserId }, body });

  it("removes it with a reason, logged as the Sheltüh team's edit; nothing to remove is a no-op", async () => {
    await upload(organiser.token, await smallPng());
    const version = (await storedLogo(organiser.organiserId))!.version;

    const res = await removeLogo(admin.token, organiser.organiserId, { reason: "Not their logo" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body.logoUrl).toBeUndefined();
    expect(res.body.recentEdits[0]).toEqual({
      kind: "profile_edit",
      at: expect.any(String),
      changes: { logo: { old: version, new: null } },
      reason: "Not their logo",
      byStaff: true,
    });
    expect(await storedLogo(organiser.organiserId)).toBeUndefined();
    expect((await getLogo(organiser.organiserId)).status).toBe(404);

    const again = await removeLogo(admin.token, organiser.organiserId, { reason: "Again" });
    expect(again.status).toBe(200);
    expect(again.body.recentEdits).toHaveLength(2);
  });

  it("works whatever the organiser's status", async () => {
    await upload(organiser.token, await smallPng());
    await suspend(organiser.organiserId);
    const res = await removeLogo(admin.token, organiser.organiserId, { reason: "Gone" });
    expect(res.status).toBe(200);
    expect(await storedLogo(organiser.organiserId)).toBeUndefined();
  });

  it("is admin only (401, 403), needs a reason (400) and a known organiser (404)", async () => {
    await upload(organiser.token, await smallPng());
    expect((await removeLogo(undefined, organiser.organiserId, { reason: "x" })).status).toBe(401);
    expect((await removeLogo(organiser.token, organiser.organiserId, { reason: "x" })).status).toBe(403);
    for (const body of [{}, { reason: "" }, { reason: "x".repeat(501) }, { reason: "bad\u0000" }]) {
      const res = await removeLogo(admin.token, organiser.organiserId, body);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.fieldErrors)).toEqual(["reason"]);
    }
    expect((await removeLogo(admin.token, crypto.randomUUID(), { reason: "x" })).status).toBe(404);
    expect((await removeLogo(admin.token, "not-a-uuid", { reason: "x" })).status).toBe(404);
    expect(await storedLogo(organiser.organiserId)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

describe("GET /organisers/{id}/logo", () => {
  it("is public for an approved organiser: WebP, shared at the CDN at its current version, ETag and 304", async () => {
    await upload(organiser.token, await smallPng());
    const { version } = (await storedLogo(organiser.organiserId))!;

    const res = await getLogo(organiser.organiserId, { query: `?v=${version}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // An hour in browsers, 23 more at the CDN: a takedown is gone within a day.
    expect(LOGO_CACHE).toBe("public, max-age=3600, s-maxage=82800");
    expect(res.headers.get("cache-control")).toBe(LOGO_CACHE);
    expect(res.headers.get("etag")).toBe(`"${version}-f"`);
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(512);

    const thumb = await getLogo(organiser.organiserId, { query: `?size=thumb&v=${version}` });
    expect(thumb.headers.get("etag")).toBe(`"${version}-t"`);
    expect(thumb.headers.get("cache-control")).toBe(LOGO_CACHE);
    expect((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width).toBe(96);

    const notModified = await getLogo(organiser.organiserId, { headers: { "if-none-match": `"${version}-f"` } });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("etag")).toBe(`"${version}-f"`);
    // No `v`: browser only.
    expect(notModified.headers.get("cache-control")).toBe(LOGO_UNVERSIONED_CACHE);
    expect((await notModified.arrayBuffer()).byteLength).toBe(0);
    const notModifiedVersioned = await getLogo(organiser.organiserId, {
      query: `?v=${version}`,
      headers: { "if-none-match": `"${version}-f"` },
    });
    expect([notModifiedVersioned.status, notModifiedVersioned.headers.get("cache-control")]).toEqual([304, LOGO_CACHE]);
    // The other size's ETag, or an old version's, gets the image.
    expect((await getLogo(organiser.organiserId, { headers: { "if-none-match": `"${version}-t"` } })).status).toBe(200);
    expect((await getLogo(organiser.organiserId, { headers: { "if-none-match": `"1-f"` } })).status).toBe(200);
    // Any other `v` still serves the current logo, but never shared: a copy
    // under a URL that isn't the current version could outlive a new logo.
    expect(LOGO_UNVERSIONED_CACHE).toBe("private, max-age=3600");
    for (const query of ["", "?v=1", `?v=${Number(version) + 1}`, `?size=thumb&v=${version}0`]) {
      const other = await getLogo(organiser.organiserId, { query });
      expect([query, other.status, other.headers.get("cache-control")]).toEqual([query, 200, LOGO_UNVERSIONED_CACHE]);
    }
  });

  it("is a 404 for unknown organisers and organisers without a logo", async () => {
    for (const organiserId of [crypto.randomUUID(), organiser.organiserId]) {
      const res = await getLogo(organiserId);
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
      expect((await getLogo(organiserId, { on: counting })).status).toBe(404);
    }
    expect(queries).toBe(0);
  });

  it("once the organiser isn't approved: a 404 for the public and other members, private for an admin or the owner", async () => {
    await upload(organiser.token, await smallPng());
    const { version } = (await storedLogo(organiser.organiserId))!;
    await suspend(organiser.organiserId);

    const stranger = await api.signUp();
    for (const options of [
      {},
      { token: "forged" },
      { token: stranger.token },
      // A matching ETag is no way round it.
      { headers: { "if-none-match": `"${version}-f"` } },
    ]) {
      const res = await getLogo(organiser.organiserId, options);
      expect(res.status).toBe(404);
    }

    for (const token of [admin.token, organiser.token]) {
      const res = await getLogo(organiser.organiserId, { token, query: "?size=thumb" });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(96);
    }
  });
});

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

describe("logo URLs in the API's payloads", () => {
  it("logoUrl on /organisers/me and the public profile; organiserLogoThumbUrl on every public event", async () => {
    const event = await publishedEvent(api, organiser, admin);
    const draft = await draftEvent(api, organiser, { title: "Draft" });

    // None yet: the fields are absent.
    expect((await api.call(getMyOrganiser, { token: organiser.token })).body.logoUrl).toBeUndefined();
    expect((await api.call(getPublicOrganiserProfile, { params: { organiserId: organiser.organiserId } })).body.logoUrl)
      .toBeUndefined();
    expect((await api.call(getPublicEventBySlug, { params: { slug: event.slug } })).body.organiserLogoThumbUrl)
      .toBeUndefined();

    await upload(organiser.token, await smallPng());
    const { version } = (await storedLogo(organiser.organiserId))!;
    const base = `/api/organisers/${organiser.organiserId}/logo`;
    const logoUrl = `${base}?v=${version}`;
    const thumbUrl = `${base}?size=thumb&v=${version}`;

    expect((await api.call(getMyOrganiser, { token: organiser.token })).body.logoUrl).toBe(logoUrl);
    const profile = await api.call(getPublicOrganiserProfile, { params: { organiserId: organiser.organiserId } });
    expect(profile.body.logoUrl).toBe(logoUrl);
    expect(profile.body.upcomingEvents.map((e: { organiserLogoThumbUrl?: string }) => e.organiserLogoThumbUrl)).toEqual([
      thumbUrl,
    ]);
    expect((await api.call(getPublicEventBySlug, { params: { slug: event.slug } })).body.organiserLogoThumbUrl).toBe(
      thumbUrl,
    );
    const list = await api.call(listPublicEvents, { query: { upcoming: "1" } });
    expect(list.body.items.map((e: { organiserLogoThumbUrl?: string }) => e.organiserLogoThumbUrl)).toEqual([thumbUrl]);
    expect(
      (await api.call(getMyEvent, { token: organiser.token, params: { eventId: draft.eventId } })).body
        .organiserLogoThumbUrl,
    ).toBe(thumbUrl);
    expect((await adminRecord(organiser.organiserId)).logoUrl).toBe(logoUrl);

    // The URLs serve what they say.
    expect((await getLogo(organiser.organiserId, { query: `?size=thumb&v=${version}` })).status).toBe(200);
  });

  it("an organiser that isn't approved has no organiserLogoThumbUrl on its events (the URL would be a 404)", async () => {
    const draft = await draftEvent(api, organiser);
    await upload(organiser.token, await smallPng());
    await suspend(organiser.organiserId);
    const events = await api.call(adminListEvents, { token: admin.token, query: { status: "draft" } });
    const item = events.body.items.find((e: { eventId: string }) => e.eventId === draft.eventId);
    expect(item).toBeDefined();
    expect(item.organiserLogoThumbUrl).toBeUndefined();
    // The owner's own record still says it has one (they can fetch it with their token, or delete it).
    expect((await api.call(getMyOrganiser, { token: organiser.token })).body.logoUrl).toMatch(/\/logo\?v=\d+$/);
  });
});
