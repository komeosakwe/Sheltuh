import sharp from "sharp";
import { HttpError } from "./http";
import { readCappedBytes, sniffImageType } from "./handlers/event-images";

/**
 * Member profile photos (docs/architecture.md, "Member profiles"). The upload
 * is never stored as sent: it's decoded and re-encoded here, server-side, to
 * a square WebP (AVATAR_SIZE) and a thumbnail (AVATAR_THUMB_SIZE). sharp
 * writes no metadata unless asked to, so the output carries no EXIF (camera,
 * GPS location, time), ICC profile or XMP: only pixels. EXIF orientation is
 * applied to the pixels first, so a phone photo isn't stored sideways.
 *
 * sharp is declared in package.json at the version Next itself uses (its
 * image optimiser), and is on Next's built-in server-external list
 * (serverExternalPackages), so route handlers load it with Node's own
 * `require` and Vercel's file tracing ships its native linux-x64 binary
 * (@img/sharp-linux-x64, installed by `npm ci` on Vercel's Linux builders).
 */

/** Largest upload read (bytes); the stream is cut off past it (413). */
export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
/** The stored photo's side, in pixels. */
export const AVATAR_SIZE = 512;
/** The thumbnail's side (Who's Going list, messages). */
export const AVATAR_THUMB_SIZE = 96;
/**
 * Largest decoded image accepted, in pixels (about 7000 × 7000): a small
 * file can claim a huge canvas ("decompression bomb"), which sharp refuses
 * before allocating it.
 */
export const MAX_AVATAR_INPUT_PIXELS = 50_000_000;

export interface EncodedAvatar {
  image: Buffer;
  thumb: Buffer;
}

const NOT_AN_IMAGE = () =>
  new HttpError(400, "That file isn't a supported image.", { avatar: "Upload a JPEG, PNG or WebP photo." });

/**
 * The upload, read as a stream and cut off past MAX_AVATAR_UPLOAD_BYTES
 * (413), whose own bytes must be a JPEG, PNG or WebP (400): the declared
 * Content-Type isn't trusted, and nothing else (SVG, GIF, HEIC, ...) is
 * handed to the decoder.
 */
export async function readAvatarUpload(req: Request): Promise<Uint8Array> {
  const tooLarge = () => new HttpError(413, "That photo is too large.", { avatar: "Use a photo under 5 MB." });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AVATAR_UPLOAD_BYTES) throw tooLarge();
  const bytes = await readCappedBytes(req, MAX_AVATAR_UPLOAD_BYTES);
  if (!bytes) throw tooLarge();
  if (!sniffImageType(bytes)) throw NOT_AN_IMAGE();
  return bytes;
}

function square(input: Uint8Array, size: number, quality: number): Promise<Buffer> {
  return (
    sharp(input, { limitInputPixels: MAX_AVATAR_INPUT_PIXELS, failOn: "error", pages: 1 })
      // Applies the EXIF orientation to the pixels (the tag itself isn't kept).
      .rotate()
      .resize(size, size, { fit: "cover", position: "centre" })
      // Into sRGB, so the image looks right without an embedded ICC profile.
      .toColourspace("srgb")
      // No keepMetadata/withMetadata/keepExif/keepIccProfile: nothing is written but pixels.
      .webp({ quality, effort: 4 })
      .toBuffer()
  );
}

/**
 * Re-encodes an uploaded photo (already sniffed as JPEG, PNG or WebP). A file
 * that doesn't decode (truncated, corrupt, over the pixel limit) is a 400.
 */
export async function encodeAvatar(input: Uint8Array): Promise<EncodedAvatar> {
  try {
    const [image, thumb] = await Promise.all([square(input, AVATAR_SIZE, 82), square(input, AVATAR_THUMB_SIZE, 80)]);
    return { image, thumb };
  } catch {
    throw NOT_AN_IMAGE();
  }
}
