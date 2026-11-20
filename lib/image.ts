export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_EDGE_PX = 1600;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export class ImageError extends Error {}

/**
 * Validates a picked file and shrinks it to at most 1600px on its long edge
 * (re-encoded as JPEG), so uploads stay small and fast. Files already under
 * the limit are passed through untouched if the browser can't resize them.
 */
export async function prepareEventImage(file: File): Promise<Blob> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new ImageError("Choose a JPEG, PNG or WebP image.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size <= MAX_UPLOAD_BYTES) return file;
    throw new ImageError("That image is too large. Choose one under 2 MB.");
  }

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_UPLOAD_BYTES) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("Couldn't process that image.");
  ctx.fillStyle = "#ffffff"; // flatten transparency for JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob || blob.size > MAX_UPLOAD_BYTES) {
    throw new ImageError("That image is too large. Choose one under 2 MB.");
  }
  return blob;
}

/** An organiser cover's upload limit: the API's (lib/server/organiser-cover.ts MAX_COVER_UPLOAD_BYTES). */
export const MAX_COVER_UPLOAD_BYTES = 4 * 1024 * 1024;
/** The cover's shape, width over height: the server crops every upload to 7:2 (2240 × 640). */
export const COVER_ASPECT = 7 / 2;
/** The stored cover's width; a narrower crop is enlarged to it, and may look soft. */
export const COVER_WIDTH_PX = 2240;
/** The widest cover sent: a little over the stored width, so the server only ever shrinks a large one. */
export const MAX_COVER_WIDTH_PX = 2800;

const COVER_TOO_LARGE = "That image is over 4 MB, even after shrinking it. Choose a smaller one.";

/** A cover ready to upload, and how wide its 7:2 crop is (null when the browser couldn't read the file). */
export interface PreparedCover {
  image: Blob;
  width: number | null;
}

/**
 * The centre 7:2 strip of a `width` × `height` image (the server's own crop,
 * lib/server/organiser-cover.ts), then at most MAX_COVER_WIDTH_PX wide
 * (≤ 2800 × 800): the source rectangle, and the size to draw it at.
 */
export function coverCrop(width: number, height: number) {
  const cropWidth = Math.max(1, Math.min(width, Math.round(height * COVER_ASPECT)));
  const cropHeight = Math.max(1, Math.min(height, Math.round(cropWidth / COVER_ASPECT)));
  const outWidth = Math.min(cropWidth, MAX_COVER_WIDTH_PX);
  return {
    source: {
      x: Math.round((width - cropWidth) / 2),
      y: Math.round((height - cropHeight) / 2),
      width: cropWidth,
      height: cropHeight,
    },
    width: outWidth,
    height: Math.max(1, Math.round((outWidth * cropHeight) / cropWidth)),
  };
}

/**
 * Validates a picked cover and crops it in the browser as the server will:
 * the centre 7:2 strip first, then at most 2800 px wide, re-encoded as JPEG
 * (EXIF-oriented, transparency on white, no metadata). Cropping before
 * scaling keeps a tall phone photo's full width (a 3000 × 4000 portrait
 * gives 2800 × 800, not a 2100-wide crop) and doesn't send pixels the
 * server would throw away. `width` is the prepared crop's width, for the
 * "it's been enlarged" warning (under COVER_WIDTH_PX). A file the browser
 * can't read is sent as it is when it's within 4 MB (the server decides),
 * with `width` null.
 */
export async function prepareCoverImage(file: File): Promise<PreparedCover> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new ImageError("Choose a JPEG, PNG or WebP image.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size <= MAX_COVER_UPLOAD_BYTES) return { image: file, width: null };
    throw new ImageError(COVER_TOO_LARGE);
  }

  const crop = coverCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new ImageError("Couldn't process that image.");
  }
  ctx.fillStyle = "#ffffff"; // flatten transparency for JPEG
  ctx.fillRect(0, 0, crop.width, crop.height);
  const { x, y, width, height } = crop.source;
  ctx.drawImage(bitmap, x, y, width, height, 0, 0, crop.width, crop.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new ImageError("Couldn't process that image.");
  if (blob.size > MAX_COVER_UPLOAD_BYTES) throw new ImageError(COVER_TOO_LARGE);
  return { image: blob, width: crop.width };
}
