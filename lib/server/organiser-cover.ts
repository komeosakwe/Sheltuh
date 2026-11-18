import sharp from "sharp";
import { decoder, inEncodeSlot, unsupportedImage } from "./avatar";
import { HttpError } from "./http";
import { readCappedBytes, sniffImageType } from "./image-upload";

/**
 * Organiser cover images (docs/architecture.md, "Organiser profiles"): the
 * wide banner at the top of an organiser's public profile. Like logos
 * (organiser-logo.ts) and member photos (avatar.ts), the upload is never
 * stored as sent: it's decoded once, in the decode slots every upload shares
 * (AVATAR_ENCODE_CONCURRENCY), with the same format, polyglot and
 * 24-megapixel checks (decoder), then centre-cropped to fill 7:2 at
 * COVER_SIZE (a smaller upload is enlarged), with any transparency flattened
 * onto white, and re-encoded to two WebPs with no metadata (no EXIF, GPS, ICC
 * or XMP): COVER_SIZE and COVER_SMALL_SIZE, each stepping its quality down
 * until it fits its bound (the private.organiser_covers check constraints).
 */

/** Largest upload read (bytes); the stream is cut off past it (413). Under Vercel's ~4.5 MB request body limit. */
export const MAX_COVER_UPLOAD_BYTES = 4 * 1024 * 1024;

/** The stored cover (7:2), in pixels. */
export const COVER_SIZE = { width: 2240, height: 640 } as const;
/** The smaller copy (`?size=small`): phones and narrow layouts. */
export const COVER_SMALL_SIZE = { width: 1120, height: 320 } as const;

/** private.organiser_covers.image's bound (bytes). */
export const MAX_COVER_IMAGE_BYTES = 1024 * 1024;
/** private.organiser_covers.small's bound (bytes). */
export const MAX_COVER_SMALL_BYTES = 256 * 1024;

/** WebP qualities tried in turn until the output fits its bound (photos fit the first). */
export const COVER_QUALITIES = [82, 70, 55, 40] as const;

/** What transparency is flattened onto. */
export const COVER_BACKGROUND = "#ffffff";

/** Cover uploads per organiser account per window (each one is a decode). Bucket `organiser_cover_uploads`. */
export const COVER_UPLOAD_RATE_LIMIT = { hits: 20, window: "24 hours" } as const;

export interface EncodedCover {
  image: Buffer;
  small: Buffer;
}

/**
 * The upload, read as a stream and cut off past MAX_COVER_UPLOAD_BYTES (413),
 * whose own bytes must be a JPEG, PNG or WebP (400 on `cover`): the declared
 * Content-Type isn't trusted.
 */
export async function readCoverUpload(req: Request): Promise<Uint8Array> {
  const tooLarge = () => new HttpError(413, "That image is too large.", { cover: "Use an image under 4 MB." });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_COVER_UPLOAD_BYTES) throw tooLarge();
  const bytes = await readCappedBytes(req, MAX_COVER_UPLOAD_BYTES);
  if (!bytes) throw tooLarge();
  if (!sniffImageType(bytes)) throw unsupportedImage("cover");
  return bytes;
}

export type RawPixels = { data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 };

/**
 * `pixels` scaled to `size` as a WebP of at most `maxBytes` (each of
 * COVER_QUALITIES in turn, the first that fits), or null if none fits.
 * Exported for its tests.
 */
export async function coverWebp(
  pixels: RawPixels,
  size: { width: number; height: number },
  maxBytes: number,
): Promise<Buffer | null> {
  const raw = { raw: { width: pixels.width, height: pixels.height, channels: pixels.channels } };
  for (const quality of COVER_QUALITIES) {
    // No keepMetadata/withMetadata/keepExif/keepIccProfile: nothing is written but pixels.
    const out = await sharp(pixels.data, raw)
      .resize(size.width, size.height, { fit: "cover", position: "centre" })
      .webp({ quality, effort: 4 })
      .toBuffer();
    if (out.length <= maxBytes) return out;
  }
  return null;
}

/**
 * Re-encodes a cover (already read by readCoverUpload): decoded once to raw
 * sRGB pixels at COVER_SIZE (cropped to fill, centred; enlarged if smaller;
 * transparency flattened onto white), and both WebPs made from those. 400 on
 * `cover` for a file that doesn't decode (truncated, corrupt, over the pixel
 * limit) or, only for noise-like images, can't fit its bound at the lowest
 * quality; 503 when the decode queue is full.
 */
export async function encodeCover(input: Uint8Array): Promise<EncodedCover> {
  return inEncodeSlot(async () => {
    const decoded = await (await decoder(input, "cover"))
      // No alpha: transparent areas become white (libvips flattens before resizing).
      .flatten({ background: COVER_BACKGROUND })
      .resize(COVER_SIZE.width, COVER_SIZE.height, { fit: "cover", position: "centre" })
      // Into sRGB, so the image looks right without an embedded ICC profile.
      .toColourspace("srgb")
      // Raw pixels: nothing of the upload but them goes any further.
      .raw()
      .toBuffer({ resolveWithObject: true })
      .catch(() => {
        throw unsupportedImage("cover");
      });
    const pixels: RawPixels = {
      data: decoded.data,
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
    };
    const [image, small] = await Promise.all([
      coverWebp(pixels, COVER_SIZE, MAX_COVER_IMAGE_BYTES),
      coverWebp(pixels, COVER_SMALL_SIZE, MAX_COVER_SMALL_BYTES),
    ]);
    if (!image || !small) {
      throw new HttpError(400, "That image is too detailed to use as a cover.", {
        cover: "Try a different photo, or a less detailed one.",
      });
    }
    return { image, small };
  });
}
