import {
  CLIP_MESSAGES,
  MAX_CLIP_BYTES,
  MAX_CLIP_DURATION_MS,
  MAX_CLIP_PIXELS,
  MAX_CLIP_SIDE,
  type ClipUploadContentType,
} from "@/lib/clip-rules";

/**
 * The browser's checks on a chosen clip before anything is uploaded
 * (docs/design/event-clips.md §5.4): its type, its size, and (where this
 * browser can read the file) its length and size in pixels, each with the
 * server's exact message (lib/clip-rules.ts). They're only for a quicker,
 * clearer answer: the server checks every file itself (lib/server/mp4.ts),
 * including what a browser can't see (HEVC, a sound track).
 */

/** What a browser could read from the file, or null where it couldn't (no decoder for it, a timeout). */
export interface ClipMetadata {
  /** Null when the file doesn't say (a live stream's Infinity, NaN). */
  durationMs: number | null;
  width: number;
  height: number;
}

export type ClipPrecheck =
  | { ok: true; contentType: ClipUploadContentType; metadata: ClipMetadata | null }
  | { ok: false; message: string };

/** How long the hidden video may take to read the file's header before the check is skipped. */
export const METADATA_TIMEOUT_MS = 8000;

/**
 * The type to declare for the upload, from the file's type or, where the
 * browser gives none (some systems leave .mov blank), its name. Null: not an
 * MP4 or MOV.
 */
export function clipContentType(file: Pick<File, "type" | "name">): ClipUploadContentType | null {
  const type = file.type.toLowerCase();
  if (type === "video/mp4" || type === "video/x-m4v") return "video/mp4";
  if (type === "video/quicktime") return "video/quicktime";
  if (type !== "" && type !== "application/octet-stream") return null;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (extension === "mp4" || extension === "m4v") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  return null;
}

/**
 * Reads a video file's length and size in pixels with a hidden, detached
 * `<video>` on an object URL (nothing is played or shown; the URL is revoked
 * after). Resolves null when this browser can't read it (no decoder, a
 * damaged file, or nothing by `timeoutMs`), so the server decides.
 */
export function readClipMetadata(file: Blob, timeoutMs = METADATA_TIMEOUT_MS): Promise<ClipMetadata | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (value: ClipMetadata | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const seconds = video.duration;
      finish({
        durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/**
 * All the browser's checks, in the order people fix them: type, size, then
 * (if the file could be read) length and pixels. `readMetadata` is
 * `readClipMetadata` unless a test gives another.
 */
export async function precheckClip(
  file: File,
  readMetadata: (file: Blob) => Promise<ClipMetadata | null> = readClipMetadata,
): Promise<ClipPrecheck> {
  const contentType = clipContentType(file);
  if (!contentType) return { ok: false, message: CLIP_MESSAGES.notMp4 };
  if (file.size > MAX_CLIP_BYTES) return { ok: false, message: CLIP_MESSAGES.tooLarge(file.size) };
  if (file.size === 0) return { ok: false, message: CLIP_MESSAGES.unreadable };
  const metadata = await readMetadata(file);
  if (metadata) {
    if (metadata.durationMs !== null && metadata.durationMs > MAX_CLIP_DURATION_MS) {
      return { ok: false, message: CLIP_MESSAGES.tooLong(metadata.durationMs) };
    }
    const { width, height } = metadata;
    if (width * height > MAX_CLIP_PIXELS || Math.max(width, height) > MAX_CLIP_SIDE) {
      return { ok: false, message: CLIP_MESSAGES.tooManyPixels };
    }
  }
  return { ok: true, contentType, metadata };
}
