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
