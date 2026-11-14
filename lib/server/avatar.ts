import sharp from "sharp";
import {
  MAX_MEMBER_PHOTO_UPLOAD_BYTES,
  MEMBER_PHOTO_MAX_SIDE,
  MEMBER_PHOTO_THUMB_SIZE,
} from "@/lib/member-photo-rules";
import { HttpError } from "./http";
import { readCappedBytes, sniffImageType } from "./handlers/event-images";

/**
 * Member profile photos (docs/architecture.md, "Member profiles"), the
 * square re-encoder they share with organiser logos (organiser-logo.ts), and
 * member photos (encodeMemberPhoto; "Member photos"), which share the same
 * decode slots (AVATAR_ENCODE_CONCURRENCY) so a burst of either queues
 * behind the other. The upload
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
  photo: "Upload a JPEG, PNG or WebP photo.",
} as const;

export type SquareImageField = keyof typeof UNSUPPORTED_HINTS;

/** 400: not a JPEG, PNG or WebP, or doesn't decode (over the pixel limit included). */
export function unsupportedImage(field: SquareImageField): HttpError {
  return new HttpError(400, "That file isn't a supported image.", { [field]: UNSUPPORTED_HINTS[field] });
}

/**
 * The upload, read as a stream and cut off past MAX_AVATAR_UPLOAD_BYTES
 * (413), whose own bytes must be a JPEG, PNG or WebP (400): the declared
 * Content-Type isn't trusted, and nothing else (SVG, GIF, HEIC, ...) is
 * handed to the decoder.
 */
export function readAvatarUpload(req: Request): Promise<Uint8Array> {
  return readImageUpload(req, MAX_AVATAR_UPLOAD_BYTES, "avatar", "Use a photo under 5 MB.");
}

/** readAvatarUpload for a member photo: at most MAX_MEMBER_PHOTO_UPLOAD_BYTES (413), errors on `photo`. */
export function readMemberPhotoUpload(req: Request): Promise<Uint8Array> {
  return readImageUpload(req, MAX_MEMBER_PHOTO_UPLOAD_BYTES, "photo", "Use a photo under 4 MB.");
}

async function readImageUpload(req: Request, max: number, field: SquareImageField, sizeHint: string): Promise<Uint8Array> {
  const tooLarge = () => new HttpError(413, "That photo is too large.", { [field]: sizeHint });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  const bytes = await readCappedBytes(req, max);
  if (!bytes) throw tooLarge();
  if (!sniffImageType(bytes)) throw unsupportedImage(field);
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
 * The upload's decoder, after a header-only read confirms libvips chose its
 * own JPEG, PNG or WebP loader (it picks one from the bytes, independently of
 * our sniff), so a polyglot can't reach another decoder (SVG, PDF, TIFF…).
 * First frame only, at most MAX_AVATAR_INPUT_PIXELS (refused from the
 * header), EXIF orientation applied to the pixels (the tag itself isn't kept).
 */
async function decoder(input: Uint8Array, field: SquareImageField): Promise<ReturnType<typeof sharp>> {
  const format = await sharp(input, { failOn: "error" })
    .metadata()
    .then((m) => m.format, () => undefined);
  if (format !== "jpeg" && format !== "png" && format !== "webp") throw unsupportedImage(field);
  return sharp(input, { limitInputPixels: MAX_AVATAR_INPUT_PIXELS, failOn: "error", pages: 1 }).rotate();
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
    let pipeline = await decoder(input, options.field);
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

/** private.profile_photos.image's bound (bytes): the same as a report's photo copy (report_photos.image). */
export const MEMBER_PHOTO_MAX_BYTES = 512 * 1024;
/** private.profile_photos.thumb's bound (bytes). */
export const MEMBER_PHOTO_THUMB_MAX_BYTES = 64 * 1024;
/** WebP qualities tried in turn until the output fits its bound (most photos fit the first). */
const MEMBER_PHOTO_QUALITIES = [82, 70, 55, 40, 25] as const;
const MEMBER_THUMB_QUALITIES = [80, 70, 55, 40] as const;

export interface EncodedMemberPhoto {
  image: Buffer;
  thumb: Buffer;
  /** The stored image's size in pixels (each at most MEMBER_PHOTO_MAX_SIDE). */
  width: number;
  height: number;
}

export type RawPixels = { data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 };

/**
 * `pixels` as a WebP of at most `maxBytes`, made only from those pixels (no
 * metadata): each of `qualities` in turn, then, if even the lowest is too big
 * (only noise-like images get there), the pixels scaled down by a fifth at a
 * time at the lowest quality. A square `side` crops to fill that square
 * first. Returns the WebP and its size as encoded. Exported for its test.
 */
export async function webpWithin(
  pixels: RawPixels,
  maxBytes: number,
  qualities: readonly number[],
  side?: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  const raw = { raw: { width: pixels.width, height: pixels.height, channels: pixels.channels } };
  let width = side ?? pixels.width;
  let height = side ?? pixels.height;
  // The WebP and its real size (`fit: "inside"` can come out a pixel under the box).
  const encode = async (quality: number) => {
    const fit = side === undefined ? "inside" : "cover";
    const { data, info } = await sharp(pixels.data, raw)
      .resize(width, height, { fit, position: "centre" })
      .webp({ quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  };
  for (const quality of qualities) {
    const out = await encode(quality);
    if (out.data.length <= maxBytes) return out;
  }
  const lowest = qualities[qualities.length - 1];
  // Bounded: each step has 64% of the pixels, and a 1-pixel WebP is tiny.
  for (;;) {
    width = Math.max(1, Math.floor(width * 0.8));
    height = Math.max(1, Math.floor(height * 0.8));
    const out = await encode(lowest);
    if (out.data.length <= maxBytes) return out;
  }
}

/**
 * Re-encodes an uploaded member photo (already sniffed as JPEG, PNG or WebP),
 * decoding it once, in one of the decode slots it shares with profile photos
 * and logos (AVATAR_ENCODE_CONCURRENCY; 503 when the queue is full). The
 * upload becomes raw sRGB pixels fitted inside MEMBER_PHOTO_MAX_SIDE (never
 * enlarged), with any transparency flattened onto white (a photo, and it
 * keeps a noisy alpha channel from blowing the size bound); from those, a
 * WebP of at most MEMBER_PHOTO_MAX_BYTES and a MEMBER_PHOTO_THUMB_SIZE square
 * thumbnail (cropped to fill) of at most MEMBER_PHOTO_THUMB_MAX_BYTES, each
 * stepping its quality down until it fits. No metadata is written (no EXIF,
 * GPS, ICC or XMP). A file that doesn't decode (truncated, corrupt, over the
 * pixel limit) is a 400 on `photo`.
 */
export async function encodeMemberPhoto(input: Uint8Array): Promise<EncodedMemberPhoto> {
  return inEncodeSlot(async () => {
    const decoded = await (await decoder(input, "photo"))
      .flatten({ background: "#ffffff" })
      .resize(MEMBER_PHOTO_MAX_SIDE, MEMBER_PHOTO_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      // Into sRGB, so the image looks right without an embedded ICC profile.
      .toColourspace("srgb")
      // Raw pixels: nothing of the upload but them goes any further.
      .raw()
      .toBuffer({ resolveWithObject: true })
      .catch(() => {
        throw unsupportedImage("photo");
      });
    const pixels: RawPixels = {
      data: decoded.data,
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
    };
    const [image, thumb] = await Promise.all([
      webpWithin(pixels, MEMBER_PHOTO_MAX_BYTES, MEMBER_PHOTO_QUALITIES),
      webpWithin(pixels, MEMBER_PHOTO_THUMB_MAX_BYTES, MEMBER_THUMB_QUALITIES, MEMBER_PHOTO_THUMB_SIZE),
    ]);
    return { image: image.data, thumb: thumb.data, width: image.width, height: image.height };
  });
}
