import postgres from "postgres";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEventImage, putEventImage } from "@/lib/server/handlers/event-images";
import { encodeEventImage } from "@/lib/server/event-image";
import { crc32 } from "@/lib/server/png";
import { runHandler } from "@/lib/server/route";
import {
  backfillEventImageMetadata,
  CONNECTION_STRING_ADVICE,
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
    env: { DATABASE_URL: "postgresql://postgres.abcdefgh:Sup3r-Secret-Pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres" },
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
    // The public event record points at the new version.
    const [{ image_url }] = await api.db.query<{ image_url: string }>(
      `select '/api/events/' || event_id || '/image?v=' || floor(extract(epoch from updated_at))::bigint as image_url
         from public.event_images where event_id = $1`,
      [events[1].eventId],
    );
    expect(image_url).toBe(`/api/events/${events[1].eventId}/image?v=${(await stored(events[1].eventId)).version}`);
    // A system clean-up, not someone's edit: nothing logged.
    expect(await moderationLogCount()).toBe(logBefore);
  });

  it("moves the version on even when the photo was written in the same second", async () => {
    const event = await draftEvent(api, organiser, FREE);
    await storeRaw(event.eventId, await jpegWithCameraOnly(), "image/jpeg", { updatedAt: new Date().toISOString() });
    const before = await stored(event.eventId);
    expect((await backfillEventImageMetadata(api.db, { apply: true })).cleaned).toBe(1);
    expect(Number((await stored(event.eventId)).version)).toBeGreaterThan(Number(before.version));
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
    /** The tables someone is waiting on a row of (a waiter holds a `tuple` lock on the row it waits for). */
    async function waitingOn(): Promise<string[]> {
      for (let i = 0; i < 500; i++) {
        const rows = await watcher.unsafe<{ relname: string }[]>(
          `select c.relname::text as relname from pg_locks l join pg_class c on c.oid = l.relation
            where l.locktype = 'tuple' and l.database = (select oid from pg_database where datname = current_database())`,
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
          // Committed only once the backfill's write is waiting, noting what it waits on.
          released = waitingOn().then(async (tables) => {
            await two.unsafe("commit");
            return tables;
          });
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

  it("needs DATABASE_URL", async () => {
    const deps = mainDeps({ env: {} });
    expect(await main(deps)).toBe(2);
    expect(deps.err[0]).toMatch(/^Missing DATABASE_URL/);
    expect(deps.connects).toBe(0);
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
