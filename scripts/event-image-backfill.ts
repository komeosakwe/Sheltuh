/**
 * The logic behind scripts/backfill-event-image-metadata.ts: a one-off,
 * owner-run clean-up of event photos stored before uploads were re-encoded
 * server-side (lib/server/event-image.ts, November 2026). Those rows may still
 * carry what the camera or editor wrote (EXIF with GPS, camera make, model and
 * serial number, ICC, XMP, IPTC, PNG text chunks, JPEG comments, data after
 * the image). See docs/supabase-setup.md, "Event photos stored before
 * re-encoding".
 *
 * - Dry run (the default): reads every row of public.event_images, one at a
 *   time, decides whether it carries metadata (its own byte structure, plus
 *   what sharp reports) and whether it would re-encode (and in which format:
 *   a copy over 2 MB in its own format is stored as WebP, as an upload is),
 *   and prints a summary. A row without metadata is reported clean only once
 *   its pixels decode. Writes nothing.
 * - --apply: re-encodes only the rows with metadata, with encodeEventImage
 *   (exactly what an upload goes through today), one row at a time, each in
 *   one UPDATE statement (its own transaction), which:
 *     1. locks the event row (for no key update), then the image row (the
 *        UPDATE itself): the order every image writer uses
 *        (20261023000100_review_hardening.sql), so it can't deadlock with
 *        an organiser's or admin's upload;
 *     2. writes only if the photo is still the one that was read (same
 *        content type, same SHA-256 of the bytes): one the organiser or an
 *        admin replaced meanwhile is skipped, never overwritten;
 *     3. sets only data, content_type and updated_at. focus_x / focus_y and
 *        banner_fit (where that column exists) aren't named, so they're
 *        kept whatever they are, on either schema.
 *
 * Versions: the photo's URL and ETag carry its version, the whole seconds of
 * event_images.updated_at (records.ts image_url, GET /api/events/{id}/image),
 * and the CDN and browsers keep the current version for an hour. A cleaned
 * photo must get a new one, or caches would go on serving the old bytes under
 * the old version, so updated_at moves to now(), and always at least a whole
 * second past its old value (two writes within one second would otherwise
 * share a version). The event_images_touch_event trigger also bumps the
 * event's own updated_at in the same transaction, as for every photo write:
 * an admin with that event open in the editor gets the usual "changed since
 * you opened it" refusal and reloads. Old URLs (in emails already sent, or
 * cached pages) still work: any other `v` is served the current bytes,
 * privately cached.
 *
 * Not logged in public.event_moderation_log: that log records people's
 * edits (an `edited` entry is shown to the organiser as a photo change by the
 * Sheltüh team), there is no entry kind for a system change, and nothing
 * anyone can see changes (same pixels, same focus and fit). The script's own
 * output is the record.
 *
 * Printed: counts, and for each row that isn't already clean the first 8
 * characters of its event id, its status, format, size and what was found.
 * Never image bytes, URLs, the connection string or tokens; every line goes
 * through the shared redactor (scripts/redact-secrets.ts) and has the
 * connection string and its password removed, and arguments are only echoed
 * through showArg.
 *
 * Connection: DATABASE_URL must name its host and database, and exactly one
 * host; a host off this computer is only reached with full certificate
 * verification against DATABASE_CA_CERT (the Supabase CA), never with
 * unverified TLS, so the password can't go to an impostor
 * (databaseSettingsProblem, connectBackfillDatabase). Neither value is ever
 * printed.
 *
 * Kept free of process (env and the database are passed in) so
 * tests/server/event-image-backfill.test.ts runs it against the test database
 * directly.
 */
import { createHash } from "node:crypto";
import postgres from "postgres";
import sharp, { type Metadata } from "sharp";
import { connectPostgres, forcedDatabaseTls, type Db } from "../lib/server/db";
import {
  encodeEventImage,
  EVENT_IMAGE_ENCODE_TIMEOUT_SECONDS,
  MAX_EVENT_IMAGE_INPUT_PIXELS,
  type EncodedEventImage,
} from "../lib/server/event-image";
import { HttpError } from "../lib/server/http";
import { MAX_EVENT_IMAGE_BYTES } from "../lib/server/image-upload";
import { echoable, looksSecret, redactSecrets, ROTATE_ADVICE, showArg } from "./redact-secrets";

// ---------------------------------------------------------------------------
// Finding metadata
// ---------------------------------------------------------------------------

/**
 * What a photo carries: `gps` (where it was taken: an EXIF GPS block or XMP
 * GPS fields), `camera` (make, model, serial numbers, lens, owner, maker
 * notes) and `other` (anything else: other EXIF such as the time or
 * orientation, ICC, XMP, IPTC, PNG text, JPEG comments, unknown chunks, a
 * JFIF thumbnail, data after the image).
 */
export type MetadataKind = "gps" | "camera" | "other";
export const METADATA_KINDS: readonly MetadataKind[] = ["gps", "camera", "other"];

export type ImageFormat = "jpeg" | "png" | "webp";

export type MetadataScan =
  /** `animated`: more than one frame (a WebP's ANIM/ANMF chunks, a PNG's acTL, or sharp reports pages). */
  | { ok: true; format: ImageFormat; kinds: MetadataKind[]; animated?: true }
  | { ok: false; reason: string };

/** What a structure walk noticed besides metadata. */
interface ScanFlags {
  animated: boolean;
}

// EXIF tags (TIFF IFD0 and the Exif sub-IFD) that identify the camera or its owner.
const EXIF_POINTER = 0x8769;
const GPS_POINTER = 0x8825;
const CAMERA_TAGS = new Set([
  0x010f, // Make
  0x0110, // Model
  0x013b, // Artist
  0x8298, // Copyright
  0x927c, // MakerNote (often holds a serial number)
  0xa430, // CameraOwnerName
  0xa431, // BodySerialNumber
  0xa432, // LensSpecification
  0xa433, // LensMake
  0xa434, // LensModel
  0xa435, // LensSerialNumber
  0xc614, // UniqueCameraModel (DNG)
  0xc62f, // CameraSerialNumber (DNG)
]);

/** Bytes of a TIFF value type, for working out whether a value is stored inline. */
const TIFF_TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/** The kinds an EXIF block (a TIFF structure, "Exif\0\0" first or not) holds. Anything it can't read is `other`. */
export function exifKinds(payload: Uint8Array): Set<MetadataKind> {
  const kinds = new Set<MetadataKind>();
  let tiff = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  if (tiff.subarray(0, 6).equals(Buffer.from("Exif\0\0", "latin1"))) tiff = tiff.subarray(6);
  const order = tiff.toString("latin1", 0, 2);
  if (tiff.length < 8 || (order !== "II" && order !== "MM")) {
    kinds.add("other");
    return kinds;
  }
  const le = order === "II";
  const u16 = (at: number) => (le ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (le ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));

  /** The entries of the IFD at `offset` as [tag, type, count, value-or-offset]; null if it doesn't fit. */
  const entries = (offset: number): [number, number, number, number][] | null => {
    if (offset < 8 || offset + 2 > tiff.length) return null;
    const count = u16(offset);
    if (offset + 2 + count * 12 > tiff.length) return null;
    return Array.from({ length: count }, (_, i) => {
      const at = offset + 2 + i * 12;
      return [u16(at), u16(at + 2), u32(at + 4), u32(at + 8)];
    });
  };

  const ifd0 = entries(u32(4));
  if (!ifd0) {
    kinds.add("other");
    return kinds;
  }
  for (const [tag, type, count, value] of ifd0) {
    if (tag === GPS_POINTER) {
      const gps = entries(value);
      // A GPS block that's there but unreadable is still treated as a location.
      if (!gps || gps.length > 0) kinds.add("gps");
    } else if (tag === EXIF_POINTER) {
      const sub = entries(value);
      if (!sub) {
        kinds.add("other");
        continue;
      }
      for (const [subTag] of sub) kinds.add(CAMERA_TAGS.has(subTag) ? "camera" : "other");
    } else if (CAMERA_TAGS.has(tag) && count * (TIFF_TYPE_SIZES[type] ?? 1) > 0) {
      kinds.add("camera");
    } else {
      kinds.add("other");
    }
  }
  if (kinds.size === 0) kinds.add("other");
  return kinds;
}

/** The kinds an XMP packet holds: always `other` (XMP carries editing history, dates, software), plus GPS or camera fields. */
export function xmpKinds(packet: Uint8Array): Set<MetadataKind> {
  const text = Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength).toString("latin1");
  const kinds = new Set<MetadataKind>(["other"]);
  if (/GPS(?:Latitude|Longitude|Altitude|Position)/.test(text)) kinds.add("gps");
  if (/tiff:Make|tiff:Model|SerialNumber|LensModel|LensMake|CameraOwnerName|aux:Lens/.test(text)) kinds.add("camera");
  return kinds;
}

const JPEG_XMP_IDS = ["http://ns.adobe.com/xap/1.0/\0", "http://ns.adobe.com/xmp/extension/\0"];

function startsWith(data: Buffer, prefix: string): boolean {
  return data.length >= prefix.length && data.toString("latin1", 0, prefix.length) === prefix;
}

function addAll(into: Set<MetadataKind>, from: Iterable<MetadataKind>) {
  for (const kind of from) into.add(kind);
}

/** A JPEG marker segment's metadata, if it holds any (tables, frames and scans don't). */
function jpegSegmentKinds(marker: number, payload: Buffer, kinds: Set<MetadataKind>) {
  if (marker === 0xe0) {
    // APP0 JFIF without a thumbnail is what every encoder (sharp included) writes; anything else (JFXX, a thumbnail) is other.
    const plainJfif = startsWith(payload, "JFIF\0") && payload.length >= 14 && payload[12] === 0 && payload[13] === 0;
    if (!plainJfif) kinds.add("other");
  } else if (marker === 0xe1) {
    if (startsWith(payload, "Exif\0\0")) addAll(kinds, exifKinds(payload));
    else if (JPEG_XMP_IDS.some((id) => startsWith(payload, id))) addAll(kinds, xmpKinds(payload));
    else kinds.add("other");
  } else if ((marker >= 0xe2 && marker <= 0xef) || marker === 0xfe) {
    // APP2 (ICC, multi-picture), APP13 (Photoshop/IPTC), APP14 (Adobe), the rest, COM.
    kinds.add("other");
  }
}

/** Walks a JPEG's segments and scans to its EOI. False if the structure doesn't hold together. */
function scanJpeg(b: Buffer, kinds: Set<MetadataKind>): boolean {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  let i = 2;
  for (;;) {
    if (i >= b.length || b[i] !== 0xff) return false;
    while (i + 1 < b.length && b[i + 1] === 0xff) i += 1; // fill bytes
    if (i + 1 >= b.length) return false;
    const marker = b[i + 1];
    if (marker === 0xd9) {
      // EOI: anything after it (another file, an editor's leftovers) is data a viewer never shows.
      if (i + 2 < b.length) kinds.add("other");
      return true;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (i + 4 > b.length) return false;
    const length = b.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > b.length) return false;
    jpegSegmentKinds(marker, b.subarray(i + 4, i + 2 + length), kinds);
    i += 2 + length;
    if (marker === 0xda) {
      // Entropy-coded data: FF only appears stuffed (FF 00) or as a restart marker, until the next marker.
      while (i + 1 < b.length) {
        if (b[i] === 0xff) {
          const next = b[i + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            i += 2;
            continue;
          }
          if (next !== 0xff) break;
        }
        i += 1;
      }
      if (i + 1 >= b.length) return false; // no EOI: truncated
    }
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** PNG chunks that are pixels or how to show them: anything else (eXIf, tEXt, iTXt, zTXt, iCCP, tIME, private chunks) is metadata. */
const PNG_IMAGE_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "pHYs", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD"]);

function scanPng(b: Buffer, kinds: Set<MetadataKind>, flags: ScanFlags): boolean {
  if (!b.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  for (let i = 8; ; ) {
    if (i + 12 > b.length) return false; // no IEND
    const length = b.readUInt32BE(i);
    const type = b.toString("latin1", i + 4, i + 8);
    const end = i + 12 + length;
    if (end > b.length) return false;
    const data = b.subarray(i + 8, i + 8 + length);
    if (type === "IEND") {
      if (end < b.length) kinds.add("other");
      return true;
    }
    if (type === "acTL") flags.animated = true; // APNG: still counted as other below
    if (type === "eXIf") addAll(kinds, exifKinds(data));
    else if (type === "iTXt" && startsWith(data, "XML:com.adobe.xmp\0")) addAll(kinds, xmpKinds(data));
    else if (!PNG_IMAGE_CHUNKS.has(type)) kinds.add("other");
    i = end;
  }
}

/** WebP chunks that are pixels or the extended header: EXIF, XMP, ICCP, animation and unknown chunks count as metadata. */
const WEBP_IMAGE_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH"]);

function scanWebp(b: Buffer, kinds: Set<MetadataKind>, flags: ScanFlags): boolean {
  if (b.length < 12 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") return false;
  const riffEnd = 8 + b.readUInt32LE(4);
  if (riffEnd > b.length || riffEnd < 12) return false;
  if (riffEnd < b.length) kinds.add("other"); // data after the RIFF container
  for (let i = 12; i + 8 <= riffEnd; ) {
    const type = b.toString("latin1", i, i + 4);
    const size = b.readUInt32LE(i + 4);
    const end = i + 8 + size;
    if (end > riffEnd) return false;
    const data = b.subarray(i + 8, end);
    if (type === "ANIM" || type === "ANMF") flags.animated = true; // still counted as other below
    if (type === "EXIF") addAll(kinds, exifKinds(data));
    else if (type === "XMP ") addAll(kinds, xmpKinds(data));
    else if (!WEBP_IMAGE_CHUNKS.has(type)) kinds.add("other");
    i = end + (size & 1);
  }
  return true;
}

/**
 * Whether a stored photo carries metadata, and what kind: from its own byte
 * structure (the JPEG segments up to EOI, the PNG chunks up to IEND, the WebP
 * RIFF chunks, and anything after them) and from what sharp reports (EXIF,
 * ICC, XMP, IPTC, PNG text, orientation). Not ok when it isn't a JPEG, PNG or
 * WebP whose structure holds together, or sharp can't read its header as one.
 */
export async function scanImageMetadata(input: Uint8Array): Promise<MetadataScan> {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const kinds = new Set<MetadataKind>();
  const format: ImageFormat | null =
    bytes[0] === 0xff && bytes[1] === 0xd8
      ? "jpeg"
      : bytes.subarray(0, 8).equals(PNG_SIGNATURE)
        ? "png"
        : bytes.toString("latin1", 0, 4) === "RIFF"
          ? "webp"
          : null;
  if (!format) return { ok: false, reason: "isn't a JPEG, PNG or WebP" };
  const flags: ScanFlags = { animated: false };
  const readable =
    format === "jpeg" ? scanJpeg(bytes, kinds) : format === "png" ? scanPng(bytes, kinds, flags) : scanWebp(bytes, kinds, flags);
  if (!readable) return { ok: false, reason: `isn't a complete ${format.toUpperCase()} file` };

  let meta: Metadata;
  try {
    meta = await sharp(bytes, { failOn: "error" }).metadata();
  } catch {
    return { ok: false, reason: "doesn't decode" };
  }
  if (meta.format !== format) return { ok: false, reason: `doesn't decode as a ${format.toUpperCase()}` };
  if (meta.exif) addAll(kinds, exifKinds(meta.exif));
  if (meta.xmp) addAll(kinds, xmpKinds(meta.xmp));
  if (meta.icc || meta.iptc || meta.orientation !== undefined || (meta.comments?.length ?? 0) > 0) kinds.add("other");
  if ((meta.pages ?? 1) > 1) flags.animated = true;
  const found = METADATA_KINDS.filter((kind) => kinds.has(kind));
  return flags.animated ? { ok: true, format, kinds: found, animated: true } : { ok: true, format, kinds: found };
}

// ---------------------------------------------------------------------------
// The backfill
// ---------------------------------------------------------------------------

export type RowResult =
  /** No metadata: not touched. */
  | "clean"
  /** Dry run: has metadata and re-encodes cleanly; --apply would replace it. */
  | "would_clean"
  /** --apply: replaced by its re-encoded copy. */
  | "cleaned"
  /** --apply: replaced or deleted by someone else after it was read; left as it is now. */
  | "skipped"
  /** Doesn't decode, or can't be re-encoded within the limits: left untouched. */
  | "failed";

export interface RowOutcome {
  /** The first 8 characters of the event's id. */
  event: string;
  status: string;
  result: RowResult;
  format?: ImageFormat;
  kinds: MetadataKind[];
  bytes: number;
  /** The re-encoded size (would_clean, cleaned). */
  newBytes?: number;
  /** The re-encoded format (would_clean, cleaned): not always `format`, as a copy over 2 MB in its own format is stored as WebP. */
  newFormat?: ImageFormat;
  /** Why it failed or was skipped. */
  reason?: string;
}

export interface BackfillSummary {
  apply: boolean;
  total: number;
  /** Rows found with metadata (would_clean, cleaned, skipped, and failed rows that decoded, animated ones aside). */
  withMetadata: number;
  byKind: Record<MetadataKind, number>;
  clean: number;
  wouldClean: number;
  cleaned: number;
  skipped: number;
  failed: number;
  rows: RowOutcome[];
}

export interface BackfillOptions {
  /** Write the re-encoded photos (default: dry run, nothing written). */
  apply?: boolean;
  /** Each row's line as it's done (already safe to print: no bytes, URLs or full ids). */
  print?: (line: string) => void;
  /** The re-encoder: encodeEventImage, what every upload goes through. */
  encode?: (input: Uint8Array) => Promise<EncodedEventImage>;
}

const DOESNT_DECODE = "doesn't decode (corrupt, over 24 megapixels, or too slow)";
const ANIMATED =
  "animated: re-encoding keeps only the first frame, so it isn't re-encoded; replace it by hand (the admin event editor) if a still photo will do";

/** Why a re-encode failed, in words (never the error's own text, which could quote input). */
function encodeFailure(err: unknown): string {
  if (err instanceof HttpError && err.statusCode === 413) return "over 2 MB even as WebP once re-encoded";
  if (err instanceof HttpError && err.statusCode === 400) return DOESNT_DECODE;
  if (err instanceof HttpError && err.statusCode === 503) return "the decode queue was full";
  return "couldn't be re-encoded";
}

const KIND_LABELS: Record<MetadataKind, string> = { gps: "GPS", camera: "camera", other: "other" };

function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** " as WebP" when the re-encoded copy changes format (over 2 MB in its own), else nothing. */
function formatChange(row: RowOutcome): string {
  return row.newFormat && row.newFormat !== row.format ? ` as ${row.newFormat === "webp" ? "WebP" : row.newFormat.toUpperCase()}` : "";
}

/** One printed line for a row (rows already clean aren't printed). */
export function describeRow(row: RowOutcome): string {
  const found = row.kinds.length > 0 ? row.kinds.map((k) => KIND_LABELS[k]).join(", ") : "nothing";
  const head = `  ${row.event}  ${row.status.padEnd(14)} ${(row.format ?? "?").padEnd(4)}  ${kb(row.bytes).padStart(7)}`;
  switch (row.result) {
    case "would_clean":
      return `${head}  metadata: ${found}; would re-encode${formatChange(row)} (${kb(row.newBytes ?? 0)})`;
    case "cleaned":
      return `${head}  metadata: ${found}; re-encoded${formatChange(row)} (${kb(row.newBytes ?? 0)}), new version`;
    case "skipped":
      return `${head}  metadata: ${found}; skipped: ${row.reason}`;
    case "failed":
      return `${head}  FAILED, left untouched: ${row.reason}`;
    default:
      return `${head}  clean`;
  }
}

function sha256(bytes: Uint8Array): Buffer {
  return createHash("sha256").update(bytes).digest();
}

/**
 * Whether every pixel decodes, within an upload's limits (24 megapixels, the
 * encode timeout, first frame only): a photo is only reported clean once it
 * has. Its structure and header (scanImageMetadata) can be whole while its
 * compressed data (a PNG's IDAT, a WebP's VP8 bitstream) is corrupt, and
 * sharp's metadata() never decodes pixels. Nothing is written.
 */
async function pixelsDecode(input: Uint8Array): Promise<boolean> {
  try {
    await sharp(input, { limitInputPixels: MAX_EVENT_IMAGE_INPUT_PIXELS, failOn: "error", pages: 1 })
      .timeout({ seconds: EVENT_IMAGE_ENCODE_TIMEOUT_SECONDS })
      .raw()
      .toBuffer();
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads every event photo, one at a time (never all of them in memory), and
 * finds, and with `apply` strips, the metadata of each. Never throws for one
 * photo: a row that doesn't decode or can't be re-encoded is `failed` and
 * left untouched (a database error does throw). See the file's header for
 * the locks, the version and what's printed.
 */
export async function backfillEventImageMetadata(db: Db, options: BackfillOptions = {}): Promise<BackfillSummary> {
  const apply = options.apply ?? false;
  const encode = options.encode ?? encodeEventImage;
  const print = options.print ?? (() => {});
  const summary: BackfillSummary = {
    apply,
    total: 0,
    withMetadata: 0,
    byKind: { gps: 0, camera: 0, other: 0 },
    clean: 0,
    wouldClean: 0,
    cleaned: 0,
    skipped: 0,
    failed: 0,
    rows: [],
  };

  const ids = await db.query<{ event_id: string }>(`select event_id::text as event_id from public.event_images order by event_id`);
  for (const { event_id: eventId } of ids) {
    const [row] = await db.query<{ data: Uint8Array; content_type: string; status: string }>(
      `select i.data, i.content_type, e.status::text as status
         from public.event_images i
         join public.events e on e.id = i.event_id
        where i.event_id = $1::uuid`,
      [eventId],
    );
    if (!row) continue; // deleted since the list was read: nothing to clean
    summary.total += 1;
    const data = new Uint8Array(row.data);
    const outcome: RowOutcome = { event: eventId.slice(0, 8), status: row.status, result: "clean", kinds: [], bytes: data.length };
    summary.rows.push(outcome);

    const scan = await scanImageMetadata(data);
    if (!scan.ok) {
      outcome.result = "failed";
      outcome.reason = scan.reason;
      summary.failed += 1;
      print(describeRow(outcome));
      continue;
    }
    outcome.format = scan.format;
    outcome.kinds = scan.kinds;
    if (scan.animated) {
      // encodeEventImage reads the first frame only (as every upload does), so a copy would silently drop the
      // animation: never written, in either mode, and not counted under "with metadata".
      outcome.result = "failed";
      outcome.reason = ANIMATED;
      summary.failed += 1;
      print(describeRow(outcome));
      continue;
    }
    if (scan.kinds.length === 0) {
      // Clean only if its pixels decode too (left untouched either way: nothing to strip).
      if (await pixelsDecode(data)) {
        summary.clean += 1;
      } else {
        outcome.result = "failed";
        outcome.reason = DOESNT_DECODE;
        summary.failed += 1;
        print(describeRow(outcome));
      }
      continue;
    }
    summary.withMetadata += 1;
    for (const kind of scan.kinds) summary.byKind[kind] += 1;

    let encoded: EncodedEventImage;
    try {
      encoded = await encode(data);
    } catch (err) {
      outcome.result = "failed";
      outcome.reason = encodeFailure(err);
      summary.failed += 1;
      print(describeRow(outcome));
      continue;
    }
    // The copy must itself be clean (and within the column's limit), or a second run would find it again.
    const check = await scanImageMetadata(encoded.bytes);
    if (!check.ok || check.kinds.length > 0 || encoded.bytes.length > MAX_EVENT_IMAGE_BYTES) {
      outcome.result = "failed";
      outcome.reason = "the re-encoded copy didn't come out clean";
      summary.failed += 1;
      print(describeRow(outcome));
      continue;
    }
    outcome.newBytes = encoded.bytes.length;
    outcome.newFormat = check.format;

    if (!apply) {
      outcome.result = "would_clean";
      summary.wouldClean += 1;
      print(describeRow(outcome));
      continue;
    }

    // One statement, so one transaction: the event row is locked first (the CTE, for no key update), then
    // the image row (the UPDATE), as every image writer does. Written only if the photo is still the one
    // read (content type and SHA-256 of the bytes; under Read Committed a row changed meanwhile is re-checked
    // at its newest version). focus_x / focus_y / banner_fit aren't named, so they're kept. updated_at (the
    // photo's version, in whole seconds) moves to now() and at least a second on, so caches get new bytes.
    const written = await db.query<{ event_id: string }>(
      `with e as (
         select e.id from public.events e where e.id = $1::uuid for no key update
       )
       update public.event_images i
          set data = $4::bytea, content_type = $5::text,
              updated_at = greatest(now(), i.updated_at + interval '1 second')
         from e
        where i.event_id = e.id and i.content_type = $2::text and sha256(i.data) = $3::bytea
        returning i.event_id`,
      [eventId, row.content_type, sha256(data), Buffer.from(encoded.bytes), encoded.contentType],
    );
    if (written.length === 0) {
      outcome.result = "skipped";
      outcome.reason = "the photo was replaced or removed after it was read (run again to check the new one)";
      summary.skipped += 1;
    } else {
      outcome.result = "cleaned";
      summary.cleaned += 1;
    }
    print(describeRow(outcome));
  }
  return summary;
}

/** The summary's lines. */
export function describeSummary(summary: BackfillSummary): string[] {
  const { byKind } = summary;
  const lines = [
    "",
    "Summary",
    `  Photos checked:       ${summary.total}`,
    `  With metadata:        ${summary.withMetadata}  (GPS ${byKind.gps}, camera ${byKind.camera}, other ${byKind.other}; a photo can count under more than one)`,
    `  Already clean:        ${summary.clean}`,
  ];
  if (summary.apply) {
    lines.push(`  Re-encoded:           ${summary.cleaned}`);
    lines.push(`  Skipped (changed):    ${summary.skipped}`);
  } else {
    lines.push(`  Would be re-encoded:  ${summary.wouldClean}`);
  }
  lines.push(`  Failed (untouched):   ${summary.failed}`);
  lines.push("");
  if (summary.failed > 0) {
    lines.push("Some photos couldn't be checked or cleaned (listed above as FAILED). They were left exactly as they are.");
    lines.push(
      "Replace each one through the admin event editor (the organiser can only replace it while the event is a draft or rejected), then run this again.",
    );
  }
  if (!summary.apply) {
    lines.push(
      summary.wouldClean > 0
        ? "Dry run: nothing was changed. Run again with --apply to re-encode the photos listed above."
        : "Dry run: nothing was changed, and there's nothing to re-encode.",
    );
  } else if (summary.skipped > 0) {
    lines.push("Skipped photos were changed by someone while this ran. Run --apply again to check them.");
  } else if (summary.cleaned === 0) {
    lines.push(summary.failed === 0 ? "Nothing to do: every photo is already clean." : "Nothing was re-encoded.");
  } else {
    lines.push("Done. Running it again should find nothing to re-encode.");
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Arguments and running
// ---------------------------------------------------------------------------

export const DATABASE_URL_ENV = "DATABASE_URL";

export const USAGE = [
  "Usage:",
  `  ${DATABASE_URL_ENV}=… npx tsx scripts/backfill-event-image-metadata.ts            dry run: report, change nothing`,
  `  ${DATABASE_URL_ENV}=… npx tsx scripts/backfill-event-image-metadata.ts --apply    re-encode the photos with metadata`,
  "",
  `The database's connection string comes from ${DATABASE_URL_ENV} only (never an argument), and for a database that`,
  "isn't on this computer, the Supabase CA certificate (PEM) from DATABASE_CA_CERT, so the server is verified.",
  "Exits non-zero if any photo couldn't be checked or cleaned. See docs/supabase-setup.md.",
].join("\n");

export const CONNECTION_STRING_ADVICE =
  `An argument looks like a database connection string, so it isn't shown and nothing was run. Give it as ${DATABASE_URL_ENV} instead. ` +
  "If it held the real password, treat it as exposed (it may be in your shell history) and reset the database password in Supabase.";

/** A connection string (postgres://…, anything with a scheme or user info) given as an argument by mistake. */
function looksLikeConnectionString(arg: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(arg) || arg.includes("://") || arg.includes("@") || /password=/i.test(arg);
}

export type ParsedArgs = { ok: true; action: "dry-run" | "apply" | "help" } | { ok: false; errors: string[] };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  // A secret pasted in the wrong place: refused before anything else, never echoed (even with --help).
  if (argv.some(looksSecret)) return { ok: false, errors: [ROTATE_ADVICE] };
  if (argv.some(looksLikeConnectionString)) return { ok: false, errors: [CONNECTION_STRING_ADVICE] };
  let apply = false;
  let help = false;
  const errors: string[] = [];
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--apply") apply = true;
    // Only ever echoed through showArg: quoted when short and not key-like, otherwise described.
    else errors.push(echoable(arg) ? `Unknown argument ${showArg(arg)}.` : `Unknown argument: ${showArg(arg)}.`);
  }
  // Help only once every argument is known: `--aply --help` is still refused (exit 2), not taken as a request for help.
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, action: help ? "help" : apply ? "apply" : "dry-run" };
}

export const DATABASE_URL_INCOMPLETE =
  `${DATABASE_URL_ENV} must be a full connection string naming the database's host and database ` +
  "(postgresql://user:password@host:port/postgres), so it can't fall back to PGHOST, PGDATABASE or another default. " +
  "Copy the URI again from Supabase → Project Settings → Database. It isn't shown here, and nothing was run.";

export const DATABASE_URL_ONE_HOST =
  `${DATABASE_URL_ENV} must name exactly one host: a list of hosts (a comma in the host part) lets the database driver try ` +
  "the next one when the first doesn't answer, so --apply could write somewhere else. " +
  "Copy the URI again from Supabase → Project Settings → Database. It isn't shown here, and nothing was run.";

export const DATABASE_CA_CERT_ENV = "DATABASE_CA_CERT";

export const DATABASE_CA_CERT_REQUIRED =
  `${DATABASE_CA_CERT_ENV} is needed for a database that isn't on this computer: the Supabase CA certificate (PEM), ` +
  "so the script checks it's talking to your database (certificate and host name) before it sends the password. " +
  "Download it from Supabase → Project Settings → Database → SSL Configuration → Download certificate, " +
  "and set it as described in docs/supabase-setup.md. Nothing was run.";

/**
 * Whether a connection string names its own host and database: a postgres://
 * or postgresql:// URI with a host and a database name in its path. Without
 * either, postgres.js would fill it from PGHOST / PGDATABASE (or the user
 * name, or localhost), so --apply could run against whatever those name.
 */
export function namesHostAndDatabase(databaseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return false;
  }
  return (url.protocol === "postgres:" || url.protocol === "postgresql:") && url.hostname !== "" && url.pathname.length > 1;
}

/**
 * The hosts (and unix socket path, if any) postgres.js itself will connect to
 * for this URL, read the way it reads it (it splits the host part on commas,
 * after percent-decoding it). Creating a client doesn't connect: nothing is
 * sent. Undefined if postgres.js can't read the URL.
 */
function resolvedTarget(databaseUrl: string): { host: string[]; path: string | false } | undefined {
  try {
    const { host, path } = postgres(databaseUrl, { max: 1, onnotice: () => {} }).options;
    return { host, path: path || false };
  } catch {
    return undefined;
  }
}

/** On this computer (localhost, 127.0.0.1, ::1 or a unix socket): the app's own rule (lib/server/db.ts), which needs no TLS there. */
function isLocalTarget(target: { host: string[]; path: string | false }): boolean {
  return forcedDatabaseTls({ ...target, ssl: false }) === undefined;
}

/**
 * Why DATABASE_URL (with DATABASE_CA_CERT) can't be used, or undefined when
 * it can: it must name its host and database, exactly one host (as
 * postgres.js resolves it), and a host off this computer needs the CA
 * certificate, so the connection verifies the server before the password is
 * sent. Only presence is checked here; connectBackfillDatabase reads the PEM.
 */
export function databaseSettingsProblem(databaseUrl: string, env: Record<string, string | undefined>): string | undefined {
  const target = resolvedTarget(databaseUrl);
  // A host list first: with ports (h1:5432,h2:5432) it isn't a URL the other check can read either.
  if (target && target.host.length > 1) return DATABASE_URL_ONE_HOST;
  if (!namesHostAndDatabase(databaseUrl) || !target || target.host.length !== 1 || target.host[0] === "") return DATABASE_URL_INCOMPLETE;
  if (!isLocalTarget(target) && !env[DATABASE_CA_CERT_ENV]?.trim()) return DATABASE_CA_CERT_REQUIRED;
  return undefined;
}

/** TLS that checks the server: a CA to chain to, and unauthorised certificates refused (the host name is checked too, as by default). */
function isVerifyingTls(ssl: unknown): ssl is { ca: string; rejectUnauthorized: true } {
  if (typeof ssl !== "object" || ssl === null) return false;
  const { ca, rejectUnauthorized } = ssl as { ca?: unknown; rejectUnauthorized?: unknown };
  return typeof ca === "string" && ca.length > 0 && rejectUnauthorized === true;
}

/**
 * The backfill's database connection (opened on the first query): one
 * connection, no prepared statements (works through Supabase's pooler too),
 * notices not printed. Through connectPostgres, so the app's TLS rule
 * applies, and with DATABASE_CA_CERT a host off this computer gets full
 * verification (the certificate must chain to that CA and name the host;
 * postgres.js sends the host as the TLS server name). Unlike the app, the
 * backfill never settles for unverified TLS ("require") off this computer:
 * it throws instead, before anything is sent. Throws too, naming only the
 * variable, when DATABASE_CA_CERT isn't a PEM certificate. `tls` is the
 * setting the connection will use (for the tests).
 */
export function connectBackfillDatabase(
  databaseUrl: string,
  env: Record<string, string | undefined>,
): { db: Db; end: () => Promise<void>; tls: unknown } {
  const sql = connectPostgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} }, env);
  const { host, path, ssl } = sql.options;
  if (!isLocalTarget({ host, path: path || false }) && !isVerifyingTls(ssl)) {
    throw new Error(`the database isn't on this computer, and without ${DATABASE_CA_CERT_ENV} its certificate can't be checked`);
  }
  return {
    db: {
      async query<T>(text: string, params: unknown[] = []) {
        return (await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[];
      },
    },
    end: () => sql.end({ timeout: 5 }),
    tls: ssl,
  };
}

/** `text` with the connection string, its password and anything key-shaped removed. */
export function redactConnection(text: string, databaseUrl: string | undefined): string {
  let out = text;
  if (databaseUrl) {
    out = out.split(databaseUrl).join("[redacted]");
    try {
      const password = decodeURIComponent(new URL(databaseUrl).password);
      const raw = new URL(databaseUrl).password;
      for (const secret of [password, raw]) if (secret.length >= 4) out = out.split(secret).join("[redacted]");
    } catch {
      // Not a URL postgres.js would read either; the whole string was already removed.
    }
  }
  return redactSecrets(out);
}

export interface MainDeps {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  /** Opens the database (not connecting until the first query; may throw, e.g. for a bad CA certificate); `end` closes it. */
  connect: (databaseUrl: string, env: Record<string, string | undefined>) => { db: Db; end: () => Promise<void> };
  print: (line: string) => void;
  printError: (line: string) => void;
  encode?: (input: Uint8Array) => Promise<EncodedEventImage>;
}

/** The whole run; returns the exit code (0 nothing failed, 1 a photo failed or the run did, 2 bad arguments or settings). */
export async function main(deps: MainDeps): Promise<number> {
  const databaseUrl = deps.env[DATABASE_URL_ENV]?.trim() || undefined;
  const print = (line: string) => deps.print(redactConnection(line, databaseUrl));
  const printError = (line: string) => deps.printError(redactConnection(line, databaseUrl));

  const parsed = parseArgs(deps.argv);
  if (!parsed.ok) {
    for (const error of parsed.errors) printError(error);
    printError("");
    printError(USAGE);
    return 2;
  }
  if (parsed.action === "help") {
    print(USAGE);
    return 0;
  }
  if (!databaseUrl) {
    printError(`Missing ${DATABASE_URL_ENV}: the database's connection string (Supabase → Project Settings → Database). See docs/supabase-setup.md.`);
    return 2;
  }
  const problem = databaseSettingsProblem(databaseUrl, deps.env);
  if (problem) {
    printError(problem);
    return 2;
  }

  const apply = parsed.action === "apply";
  print(
    apply
      ? "Event photo metadata backfill: APPLY. Photos with metadata are re-encoded, one at a time."
      : "Event photo metadata backfill: DRY RUN. Nothing will be changed.",
  );
  print("Photos that aren't already clean (event id's first 8 characters, status, format, size, what was found):");
  let connection: { db: Db; end: () => Promise<void> } | undefined;
  try {
    try {
      connection = deps.connect(databaseUrl, deps.env);
    } catch (err) {
      // Setting it up failed (a bad DATABASE_CA_CERT, say): nothing was sent. Redacted, never the stack.
      const message = err instanceof Error ? err.message : "unknown error";
      printError(`The backfill couldn't set up the database connection: ${message}. Nothing was read or changed.`);
      return 2;
    }
    const summary = await backfillEventImageMetadata(connection.db, { apply, print, encode: deps.encode });
    for (const line of describeSummary(summary)) print(line);
    return summary.failed > 0 ? 1 : 0;
  } catch (err) {
    // Database errors only (a photo's own failure never throws). The message is redacted; never the stack or query.
    const message = err instanceof Error ? err.message : "unknown error";
    printError(`The backfill stopped: ${message}`);
    if (apply) printError("Photos already re-encoded stay re-encoded (each was its own transaction); running it again carries on.");
    return 1;
  } finally {
    // Only a connection that was set up is closed.
    if (connection) await connection.end().catch(() => {});
  }
}
