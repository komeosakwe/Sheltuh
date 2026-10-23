import { encodeSquareImage, unsupportedImage, type EncodedAvatar } from "./avatar";
import { HttpError } from "./http";
import { MAX_EVENT_IMAGE_BYTES, readCappedBytes, sniffImageType } from "./handlers/event-images";

/**
 * Organiser logos (docs/architecture.md, "Organiser profiles"). Like member
 * photos (avatar.ts), the upload is never stored as sent: it's decoded once
 * and re-encoded to a 512 px square WebP and a 96 px thumbnail with no
 * metadata, in the same decode slots (AVATAR_ENCODE_CONCURRENCY), with the
 * same format, polyglot and 24-megapixel checks. A logo isn't cropped: the
 * whole image is fitted into the square on white, and any transparency is
 * flattened onto white, so it reads the same on any page background.
 */

/** Largest upload read (bytes): the event photo's limit, which the browser's downsizer (lib/image.ts) aims under. */
export const MAX_LOGO_UPLOAD_BYTES = MAX_EVENT_IMAGE_BYTES;

/** What a logo is fitted on (and transparency flattened onto). */
export const LOGO_BACKGROUND = "#ffffff";

/** Logo uploads per organiser account per window (each one is a decode). Bucket `organiser_logo_uploads`. */
export const LOGO_UPLOAD_RATE_LIMIT = { hits: 20, window: "24 hours" } as const;

/**
 * The upload, read as a stream and cut off past MAX_LOGO_UPLOAD_BYTES (413),
 * whose own bytes must be a JPEG, PNG or WebP (400 on `logo`): the declared
 * Content-Type isn't trusted.
 */
export async function readLogoUpload(req: Request): Promise<Uint8Array> {
  const tooLarge = () => new HttpError(413, "That image is too large.", { logo: "Use an image under 2 MB." });
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_LOGO_UPLOAD_BYTES) throw tooLarge();
  const bytes = await readCappedBytes(req, MAX_LOGO_UPLOAD_BYTES);
  if (!bytes) throw tooLarge();
  if (!sniffImageType(bytes)) throw unsupportedImage("logo");
  return bytes;
}

/** Re-encodes a logo (already read by readLogoUpload): fitted whole on white, no alpha. 400 on `logo`; 503 when busy. */
export function encodeLogo(input: Uint8Array): Promise<EncodedAvatar> {
  return encodeSquareImage(input, { field: "logo", fit: "contain", background: LOGO_BACKGROUND });
}
