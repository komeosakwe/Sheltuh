/**
 * Reading an image upload's bytes, shared by event photos
 * (handlers/event-images.ts, event-image.ts), member photos (avatar.ts) and
 * organiser logos (organiser-logo.ts). A leaf module (it imports nothing of
 * ours), so the re-encoders and the handlers can all use it without an
 * import cycle.
 */

/** Mirrors the event_images check constraint. The client downsizes well below this. */
export const MAX_EVENT_IMAGE_BYTES = 2 * 1024 * 1024;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** Identifies the format from the file's own bytes — the declared Content-Type isn't trusted. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Reads a request body, returning null as soon as it exceeds `max` bytes.
 * Cancelling the rest of the stream is best-effort: a cancel that rejects
 * (the client already gone, say) still returns null, so the caller's 413
 * isn't turned into a 500.
 */
export async function readCappedBytes(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
