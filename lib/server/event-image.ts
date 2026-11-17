import sharp from "sharp";
import { inEncodeSlot, loaderFormat, MAX_AVATAR_INPUT_PIXELS } from "./avatar";
import { HttpError } from "./http";
import { MAX_EVENT_IMAGE_BYTES, type ImageType } from "./image-upload";

/**
 * Event photos (docs/architecture.md, "event_images"). Like member photos and
 * organiser logos (avatar.ts), the upload is never stored as sent: it's
 * decoded once and re-encoded server-side, so the stored photo carries no
 * EXIF (camera, serial number, GPS location, capture time), ICC profile, XMP
 * or IPTC, whatever the browser did first (lib/image.ts passes a small enough
 * file through untouched, and an API client needn't use it at all). sharp
 * writes no metadata unless asked to, and nothing here asks. The EXIF
 * orientation is applied to the pixels first (the tag itself isn't kept), so
 * a phone photo isn't stored sideways.
 *
 * Unlike an avatar the photo isn't cropped or resized: it keeps its size and,
 * where it fits, its format (a JPEG stays a JPEG, a PNG a PNG, transparency
 * included). The same decode slots (AVATAR_ENCODE_CONCURRENCY), the same
 * loader check against polyglots, and the same 24-megapixel limit, refused
 * from the header (first frame only).
 */

/** Largest decoded photo accepted, in pixels: the member photo's limit (a decompression bomb is refused from the header). */
export const MAX_EVENT_IMAGE_INPUT_PIXELS = MAX_AVATAR_INPUT_PIXELS;

/** JPEG quality on re-encode: the browser's own downsizer's (lib/image.ts, 0.85). */
export const EVENT_IMAGE_JPEG_QUALITY = 85;
/** WebP quality on re-encode: the member photo's. */
export const EVENT_IMAGE_WEBP_QUALITY = 82;

export interface EncodedEventImage {
  bytes: Buffer;
  contentType: ImageType;
}

type Format = "jpeg" | "png" | "webp";

const notAnImage = () =>
  new HttpError(400, "That file isn't a supported image.", { image: "Upload a JPEG, PNG or WebP image." });

/**
 * Re-encodes an event photo (already read and sniffed by readEventImage),
 * with no metadata, in its own format; if that comes out over
 * MAX_EVENT_IMAGE_BYTES (a re-encode can be bigger than a tightly optimised
 * upload), as WebP, which keeps any transparency; if that's over too, 413.
 * A file that doesn't decode (truncated, corrupt, another loader, over the
 * pixel limit) is a 400 on `image`; a full decode queue a 503.
 */
export function encodeEventImage(input: Uint8Array): Promise<EncodedEventImage> {
  return inEncodeSlot(async () => {
    const format = await loaderFormat(input);
    if (!format) throw notAnImage();
    const encode = (as: Format): Promise<Buffer> => {
      const pipeline = sharp(input, { limitInputPixels: MAX_EVENT_IMAGE_INPUT_PIXELS, failOn: "error", pages: 1 })
        // Applies the EXIF orientation to the pixels (the tag itself isn't kept).
        .rotate()
        // Into sRGB, so the photo looks right without its embedded ICC profile.
        .toColourspace("srgb");
      // No keepMetadata/withMetadata/keepExif/keepIccProfile/keepXmp: nothing is written but pixels.
      const encoded =
        as === "jpeg"
          ? pipeline.jpeg({ quality: EVENT_IMAGE_JPEG_QUALITY })
          : as === "png"
            ? pipeline.png()
            : pipeline.webp({ quality: EVENT_IMAGE_WEBP_QUALITY, effort: 4 });
      return encoded.toBuffer().catch(() => {
        throw notAnImage();
      });
    };

    const same = await encode(format);
    if (same.length <= MAX_EVENT_IMAGE_BYTES) return { bytes: same, contentType: `image/${format}` };
    if (format !== "webp") {
      const webp = await encode("webp");
      if (webp.length <= MAX_EVENT_IMAGE_BYTES) return { bytes: webp, contentType: "image/webp" };
    }
    throw new HttpError(413, "That image is too large.", { image: "Use a smaller image." });
  });
}
