/**
 * Event clips' limits and what people are told (docs/design/event-clips.md,
 * §5.4's error copy), shared by the API (lib/server/mp4.ts,
 * lib/server/handlers/event-clips.ts) and the browser's pre-checks, so both
 * say exactly the same thing. No server-only imports: safe in client code.
 */

/** The bucket's file_size_limit and event_clips.size_bytes' bound (owner decision: 10 MB). */
export const MAX_CLIP_BYTES = 10 * 1024 * 1024;
/** 15 s, plus half a second for encoder rounding (event_clips.duration_ms' bound). */
export const MAX_CLIP_DURATION_MS = 15_500;
/** The longest clip people are told about, in seconds. */
export const MAX_CLIP_SECONDS = 15;
/** About 1080p (1920 × 1080 is 2,073,600), either way round. */
export const MAX_CLIP_PIXELS = 2_100_000;
/** The longest side, in pixels, displayed or coded (so a 2-megapixel frame can't be a 1-pixel-high strip). */
export const MAX_CLIP_SIDE = 4096;
/** event_clips.description's bound. */
export const MAX_CLIP_DESCRIPTION_LENGTH = 300;
/** The types an upload may declare (the bucket's allowed_mime_types). The bytes are checked whatever it says. */
export const CLIP_UPLOAD_CONTENT_TYPES = ["video/mp4", "video/quicktime"] as const;
export type ClipUploadContentType = (typeof CLIP_UPLOAD_CONTENT_TYPES)[number];

/**
 * Megabytes (MiB) as people read them: one decimal place, no trailing ".0".
 * A file over the cap is never shown as the cap or less ("10.1", not "10").
 */
export function clipMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  let shown = Math.round(mb * 10) / 10;
  if (bytes > MAX_CLIP_BYTES && shown <= MAX_CLIP_BYTES / (1024 * 1024)) shown = Math.ceil(mb * 10) / 10;
  return String(shown);
}

/** Whole seconds, as the spec says them: rounded, and at least 1. */
export function clipSeconds(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / 1000));
}

/**
 * The exact strings (docs/design/event-clips.md §5.4). The API sends the
 * file's problems in fieldErrors.clip, and the others in fieldErrors.clip,
 * .description or .rightsConfirmed as noted.
 */
export const CLIP_MESSAGES = {
  /** Not an MP4/MOV at all (WebM, anything else). */
  notMp4: "This file isn’t an MP4 or MOV video. Export it as MP4 (H.264) and try again.",
  hevc: "This clip is HEVC, which many phones and browsers can’t play. Export as H.264 / Most Compatible and try again.",
  tooLong: (durationMs: number) =>
    `This clip is ${clipSeconds(durationMs)} seconds. Clips can be up to ${MAX_CLIP_SECONDS} seconds: trim it and try again.`,
  /** 413 (also the browser's pre-check). */
  tooLarge: (bytes: number) =>
    `This clip is ${clipMegabytes(bytes)} MB. Clips can be up to ${clipMegabytes(MAX_CLIP_BYTES)} MB: export at 1080p or lower and try again.`,
  tooManyPixels: "This clip is bigger than 1080p. Export at 1080p or lower and try again.",
  audio: "Clips can’t have sound — export without audio.",
  /** Damaged, fragmented, extra tracks, an unknown codec, no duration. */
  unreadable: "We couldn’t read this clip. Export it again as MP4 (H.264) and try again.",
  /** 409: the event was submitted or published (organiser), so nothing was attached. */
  editLocked: "This event can’t be edited now, so the clip wasn’t added.",
  /** 409 on a removal. */
  removeLocked: "This event can’t be edited now, so the clip wasn’t removed.",
  /** 410: the staged upload is gone (expired, never finished, or not this account's). */
  uploadExpired: "The upload expired. Choose the clip again.",
  /** 429: over the day's upload URLs. */
  rateLimited: "You’ve uploaded a lot of clips today. Try again tomorrow.",
  /** 503: Storage isn't configured, isn't answering, or the server is busy. */
  unavailable: "Clips can’t be uploaded right now. Save without it and add it later.",
  /** Browser only: the upload to Storage stopped. */
  networkDrop: "The upload stopped. Check your connection and try again.",
  /** fieldErrors.description */
  describe: "Describe the clip.",
  /** fieldErrors.rightsConfirmed */
  rights: "Confirm you have the rights to this clip.",
} as const;
