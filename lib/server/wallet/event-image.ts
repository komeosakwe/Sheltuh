import sharp from "sharp";
import type { ImageFocus } from "@/lib/types";
import { inEncodeSlot, loaderFormat, MAX_AVATAR_INPUT_PIXELS } from "../avatar";
import type { Db } from "../db";
import { sniffImageType } from "../image-upload";
import { eventImageEmailUrl } from "../ticket-email";
import { WALLET_COLOURS } from "./brand";
import { APPLE_PASS_IMAGES } from "./images";
import type { WalletTicket } from "./pass-content";

/**
 * The passes' image band from the event's own photo (the designer's 20 Nov
 * 2026 frames put it in Apple's strip and Google's hero), with the Sheltüh
 * band (lib/server/wallet/images.ts, GOOGLE_HERO_PATH) whenever the event has
 * no photo or its photo can't be used. A pass is never refused for its picture.
 *
 * The photo is the event's row in public.event_images, the one
 * GET /api/events/{id}/image serves (docs/architecture.md, "event_images").
 * Only the event's own path counts ("/api/events/{its id}/image?v={digits}",
 * as EVENT_COLUMNS and the wallet route build it): anything else, another
 * host, a protocol-relative or a non-https URL included, gets the stand-in.
 *
 * - Apple: the strip goes inside the .pkpass, so it's made here, from the
 *   bytes read straight from the database by event id and version, never by
 *   fetching a URL (as the link-preview cards read photos:
 *   lib/server/share-card-data.ts). No request leaves the server, so there's
 *   no host to allow or redirect to follow. Bounded all the same: at most
 *   WALLET_IMAGE_MAX_BYTES (the read returns no bytes over it), a JPEG, PNG
 *   or WebP by its own bytes and its stored type, and WALLET_IMAGE_TIMEOUT_MS
 *   for the read and the crop together, in the shared decode slots
 *   (lib/server/avatar.ts inEncodeSlot). Kept in a small in-memory LRU, so a
 *   buyer adding several tickets doesn't crop the same photo again.
 * - Google: Google fetches the hero itself, so its sourceUri is the photo's
 *   public URL on this site (the ticket email's rule, eventImageEmailUrl:
 *   same origin, https). Google crops a photo that isn't its banner's shape.
 */

/** The longest the strip's read and crop may take before the pass is made with the stand-in. */
export const WALLET_IMAGE_TIMEOUT_MS = 3_000;

/**
 * The largest stored photo the strip is made from (bytes). The database already
 * caps a photo at 2 MB (event_images' check constraint); this holds even if that changes.
 */
export const WALLET_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** How many events' strips are kept in memory (each up to a few hundred KB). */
export const APPLE_STRIP_CACHE_SIZE = 16;

/** The strip's files, by their name in the .pkpass. */
export type AppleStrip = Readonly<Record<"strip.png" | "strip@2x.png" | "strip@3x.png", Buffer>>;

const STRIP_NAMES = ["strip.png", "strip@2x.png", "strip@3x.png"] as const;

/** A PNG's width and height, from its IHDR. */
function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** The strip's pixel sizes: the stand-in's own (375 × 98, 750 × 196, 1125 × 294), so the two are always the same shape. */
export const APPLE_STRIP_SIZES: Readonly<Record<(typeof STRIP_NAMES)[number], { width: number; height: number }>> = Object.fromEntries(
  STRIP_NAMES.map((name) => [name, pngSize(Buffer.from(APPLE_PASS_IMAGES[name], "base64"))]),
) as Record<(typeof STRIP_NAMES)[number], { width: number; height: number }>;

/** An event's own photo path, capturing its id and version. Nothing else: no host, no other query. */
const EVENT_IMAGE_PATH = /^\/api\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/image\?v=(\d{1,20})$/;

/** The photo's version when `ticket.imageUrl` is the ticket's own event's photo path; undefined for anything else. */
export function walletImageVersion(ticket: Pick<WalletTicket, "eventId" | "imageUrl">): string | undefined {
  const match = ticket.imageUrl ? EVENT_IMAGE_PATH.exec(ticket.imageUrl) : null;
  return match && match[1] === ticket.eventId ? match[2] : undefined;
}

/**
 * Google's hero URL for the event's photo: its absolute URL on the site
 * (eventImageEmailUrl: same origin, https only), or undefined for the
 * stand-in (no photo, not the event's own path, or a site that isn't https).
 */
export function googleEventHeroUri(ticket: Pick<WalletTicket, "eventId" | "imageUrl">, siteUrl: string): string | undefined {
  if (!walletImageVersion(ticket)) return undefined;
  return eventImageEmailUrl(siteUrl, ticket.imageUrl) ?? undefined;
}

/**
 * The photo cover-cropped to each strip size around its focus point (percent
 * from the left and top, as the site's object-position; the middle when
 * there's none), as PNGs. One decode: the largest crop is made first and the
 * smaller two scaled from it, so all three frame the same part. EXIF
 * orientation applied, into sRGB, any transparency on the pass's white, as
 * 256-colour PNGs (a .pkpass is downloaded whole: a photo's truecolour strips
 * would be about 1 MB) holding only the chunks that draw the picture: no
 * metadata (sharp writes none unless asked, and nothing here asks; its pixel
 * density chunk is dropped too).
 * Rejects for anything that isn't a JPEG, PNG or WebP that decodes in time.
 */
export async function cropAppleStrip(bytes: Uint8Array, focus?: ImageFocus, timeoutSeconds = Math.ceil(WALLET_IMAGE_TIMEOUT_MS / 1000)): Promise<AppleStrip> {
  if (!sniffImageType(bytes) || !(await loaderFormat(bytes))) throw new Error("not a supported image");
  const { width: W, height: H } = APPLE_STRIP_SIZES["strip@3x.png"];
  const source = sharp(bytes, { limitInputPixels: MAX_AVATAR_INPUT_PIXELS, failOn: "error", pages: 1 });
  const { width = 0, height = 0, orientation = 1 } = await source.metadata();
  // EXIF orientations 5-8 are turned a quarter: rotate() swaps the sides.
  const [w, h] = orientation >= 5 ? [height, width] : [width, height];
  if (w < 1 || h < 1) throw new Error("no pixels");
  const scale = Math.max(W / w, H / h);
  const scaledWidth = Math.max(W, Math.round(w * scale));
  const scaledHeight = Math.max(H, Math.round(h * scale));
  const fx = Math.min(100, Math.max(0, focus?.x ?? 50)) / 100;
  const fy = Math.min(100, Math.max(0, focus?.y ?? 50)) / 100;
  const { data, info } = await source
    .rotate()
    .toColourspace("srgb")
    .resize(scaledWidth, scaledHeight, { fit: "fill" })
    .extract({ left: Math.round(fx * (scaledWidth - W)), top: Math.round(fy * (scaledHeight - H)), width: W, height: H })
    .flatten({ background: WALLET_COLOURS.white })
    .timeout({ seconds: timeoutSeconds })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { raw: { width: info.width, height: info.height, channels: info.channels } } as const;
  const png = (size: { width: number; height: number }) =>
    sharp(data, raw)
      .resize(size.width, size.height, { fit: "fill" })
      .timeout({ seconds: timeoutSeconds })
      // A 256-colour palette (dithered): a photo's three strips come to about a third of their truecolour size.
      .png({ compressionLevel: 9, palette: true, quality: 90, effort: 2 })
      .toBuffer()
      .then(pixelChunksOnly);
  const [x1, x2, x3] = await Promise.all(STRIP_NAMES.map((name) => png(APPLE_STRIP_SIZES[name])));
  return { "strip.png": x1, "strip@2x.png": x2, "strip@3x.png": x3 };
}

/** The chunks that draw a PNG. Everything else (sharp writes pHYs, the pixel density) is left out. */
const PIXEL_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);

/** `png` with only PIXEL_CHUNKS, each copied whole (its CRC with it). */
function pixelChunksOnly(png: Buffer): Buffer {
  const parts = [png.subarray(0, 8)];
  for (let i = 8; i + 12 <= png.length; ) {
    const end = i + 12 + png.readUInt32BE(i);
    if (end > png.length) throw new Error("truncated PNG");
    if (PIXEL_CHUNKS.has(png.toString("latin1", i + 4, i + 8))) parts.push(png.subarray(i, end));
    i = end;
  }
  return Buffer.concat(parts);
}

/** Recently made strips, oldest first (a Map keeps insertion order). */
const stripCache = new Map<string, AppleStrip>();

/** Forgets every cached strip (tests). */
export function clearAppleStripCache(): void {
  stripCache.clear();
}

function remember(key: string, strip: AppleStrip): void {
  stripCache.delete(key);
  stripCache.set(key, strip);
  while (stripCache.size > APPLE_STRIP_CACHE_SIZE) stripCache.delete(stripCache.keys().next().value as string);
}

class StripUnavailable extends Error {}

async function readAndCrop(db: Db, eventId: string, version: string, focus: ImageFocus | undefined, maxBytes: number, timeoutMs: number): Promise<AppleStrip> {
  // By primary key, at the version the ticket was read with, while the event is published (what the public route serves).
  const [row] = await db.query<{ content_type: string; data: Uint8Array | null }>(
    `select i.content_type, case when octet_length(i.data) <= $3 then i.data end as data
       from public.event_images i
       join public.events e on e.id = i.event_id and e.status = 'published'
      where i.event_id = $1 and floor(extract(epoch from i.updated_at))::bigint::text = $2`,
    [eventId, version, maxBytes],
  );
  if (!row) throw new StripUnavailable("gone or changed");
  if (!row.data) throw new StripUnavailable("too large");
  const bytes = new Uint8Array(row.data);
  if (sniffImageType(bytes) !== row.content_type) throw new StripUnavailable("not an image of its stored type");
  return inEncodeSlot(() => cropAppleStrip(bytes, focus, Math.max(1, Math.ceil(timeoutMs / 1000))));
}

/** `work`, or a rejection after `ms`; `work` keeps running, but nothing waits on it (and its rejection is handled). */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  work.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StripUnavailable("timed out")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The Apple strip from the ticket's event photo, or undefined for the
 * stand-in: no photo, not the event's own path, the photo replaced or the
 * event unpublished since the ticket was read, over WALLET_IMAGE_MAX_BYTES,
 * not an image of its stored type, a read or crop that fails or takes over
 * `timeoutMs`, or a full decode queue. Never throws. A failure is logged as
 * one line with its kind only (no URL, id or error text).
 */
export async function appleEventStrip(
  db: Db,
  ticket: Pick<WalletTicket, "eventId" | "imageUrl" | "imageFocus">,
  { timeoutMs = WALLET_IMAGE_TIMEOUT_MS, maxBytes = WALLET_IMAGE_MAX_BYTES }: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<AppleStrip | undefined> {
  const version = walletImageVersion(ticket);
  if (!version) return undefined;
  const focus = ticket.imageFocus;
  // The photo's path (its event and version) and where it's cropped: a moved focus point is a new strip.
  const key = `${ticket.imageUrl}#${focus ? `${focus.x},${focus.y}` : ""}`;
  const cached = stripCache.get(key);
  if (cached) {
    remember(key, cached);
    return cached;
  }
  try {
    const strip = await within(readAndCrop(db, ticket.eventId, version, focus, maxBytes, timeoutMs), timeoutMs);
    remember(key, strip);
    return strip;
  } catch (err) {
    const why = err instanceof StripUnavailable ? err.message : "couldn't be read or cropped";
    console.warn(`Apple Wallet pass made with the Sheltüh strip: the event's photo ${why}.`);
    return undefined;
  }
}
