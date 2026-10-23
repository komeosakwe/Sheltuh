import sharp from "sharp";
import { HttpError } from "./http";
import { readCappedBytes, sniffImageType } from "./handlers/event-images";

/**
 * Member profile photos (docs/architecture.md, "Member profiles"), and the
 * square re-encoder they share with organiser logos (organiser-logo.ts). The upload
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
 * Largest decoded image accepted, in pixels (24 megapixels: 6000 × 4000, a
 * full-size photo from most cameras and phones): a small file can claim a
 * huge canvas ("decompression bomb"), which sharp refuses from the header,
 * before allocating it. A bigger photo has to be downsized first.
 */
export const MAX_AVATAR_INPUT_PIXELS = 24_000_000;
/**
 * Photos decoded at once per server instance, and how many more may wait for
 * a turn: decoding is CPU- and memory-heavy, so a burst of uploads queues
 * instead of running side by side, and past the queue it's a 503.
 */
export const AVATAR_ENCODE_CONCURRENCY = { running: 2, waiting: 8 } as const;

export interface EncodedAvatar {
  image: Buffer;
  thumb: Buffer;
}

/** The fieldErrors key a re-encoded upload's errors are reported on, and what it says. */
const UNSUPPORTED_HINTS = {
  avatar: "Upload a JPEG, PNG or WebP photo.",
  logo: "Upload a JPEG, PNG or WebP image.",
} as const;

export type SquareImageField = keyof typeof UNSUPPORTED_HINTS;

/** 400: not a JPEG, PNG or WebP, or doesn't decode (over the pixel limit included). */
export function unsupportedImage(field: SquareImageField): HttpError {
  return new HttpError(400, "That file isn't a supported image.", { [field]: UNSUPPORTED_HINTS[field] });
}

const NOT_AN_IMAGE = () => unsupportedImage("avatar");

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

let running = 0;
const waiting: (() => void)[] = [];

/** Runs `work` in one of AVATAR_ENCODE_CONCURRENCY's slots, waiting for one if needed; 503 when the queue is full. */
async function inEncodeSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < AVATAR_ENCODE_CONCURRENCY.running) {
    running += 1;
  } else {
    if (waiting.length >= AVATAR_ENCODE_CONCURRENCY.waiting) {
      throw new HttpError(503, "Lots of photos are being uploaded right now. Try again in a minute.");
    }
    // The slot is handed over by the finishing job (running stays the same).
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

export interface SquareImageOptions {
  /** The fieldErrors key for an upload that isn't a supported image (400). */
  field: SquareImageField;
  /**
   * `cover`: crops to fill the square (a photo; transparency kept).
   * `contain`: the whole image, centred, the rest of the square `background`,
   * with any transparency flattened onto `background` first (a logo).
   */
  fit: "cover" | "contain";
  /** `contain` only: the colour behind the image (CSS-style, e.g. "#ffffff"). */
  background?: string;
}

/**
 * Re-encodes an upload (already sniffed as JPEG, PNG or WebP), decoding it
 * once: the upload becomes a 512 px square of raw sRGB pixels, and both WebPs
 * are made from those (the thumbnail scaled down from them). A file that
 * doesn't decode (truncated, corrupt, over the pixel limit) is a 400 on
 * `options.field`; a full queue (AVATAR_ENCODE_CONCURRENCY, shared by every
 * caller) a 503.
 */
export async function encodeSquareImage(input: Uint8Array, options: SquareImageOptions): Promise<EncodedAvatar> {
  const notAnImage = () => unsupportedImage(options.field);
  return inEncodeSlot(async () => {
    // libvips picks its loader from the bytes, independently of our sniff. A
    // header-only read confirms it chose a JPEG, PNG or WebP loader, so a
    // polyglot can't reach another decoder (SVG, PDF, TIFF…).
    const format = await sharp(input, { failOn: "error" })
      .metadata()
      .then((m) => m.format, () => undefined);
    if (format !== "jpeg" && format !== "png" && format !== "webp") throw notAnImage();
    let pipeline = sharp(input, { limitInputPixels: MAX_AVATAR_INPUT_PIXELS, failOn: "error", pages: 1 })
      // Applies the EXIF orientation to the pixels (the tag itself isn't kept).
      .rotate();
    if (options.fit === "contain") {
      const background = options.background ?? "#ffffff";
      pipeline = pipeline
        // No alpha: transparent areas become the background (libvips flattens before resizing).
        .flatten({ background })
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "contain", position: "centre", background });
    } else {
      pipeline = pipeline.resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" });
    }
    const square = await pipeline
      // Into sRGB, so the image looks right without an embedded ICC profile.
      .toColourspace("srgb")
      // Raw pixels: nothing of the upload but them goes any further.
      .raw()
      .toBuffer({ resolveWithObject: true })
      .catch(() => {
        throw notAnImage();
      });
    const raw = { raw: { width: square.info.width, height: square.info.height, channels: square.info.channels } };
    // No keepMetadata/withMetadata/keepExif/keepIccProfile: nothing is written but pixels.
    const [image, thumb] = await Promise.all([
      sharp(square.data, raw).webp({ quality: 82, effort: 4 }).toBuffer(),
      sharp(square.data, raw)
        .resize(AVATAR_THUMB_SIZE, AVATAR_THUMB_SIZE, { fit: "cover", position: "centre" })
        .webp({ quality: 80, effort: 4 })
        .toBuffer(),
    ]);
    return { image, thumb };
  });
}

/**
 * Re-encodes an uploaded member photo: encodeSquareImage, cropped to fill the
 * square (errors on `avatar`).
 */
export function encodeAvatar(input: Uint8Array): Promise<EncodedAvatar> {
  return encodeSquareImage(input, { field: "avatar", fit: "cover" });
}
