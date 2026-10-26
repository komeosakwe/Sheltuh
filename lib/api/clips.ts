import { CLIP_MESSAGES, type ClipUploadContentType } from "@/lib/clip-rules";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { ApiError, apiFetch, type GetToken } from "./client";
import type { AdminEventRecord, EventRecord } from "./types";

/**
 * Event clips (lib/server/handlers/event-clips.ts; docs/design/event-clips.md):
 * every clip call, the organiser's and the admin's, plus the one direct
 * Storage call (the file's upload to a signed URL).
 *
 * Attaching a new clip is three steps:
 *   1. requestClipUpload (or adminRequestClipUpload): a signed upload URL.
 *   2. uploadClipToStorage: the file itself, straight to Supabase Storage.
 *   3. attachClip (or adminAttachClip) with the uploadId: the server checks
 *      the file and attaches it. Errors carry the spec's exact strings in
 *      ApiError.fieldErrors (`clip`, `description`, `rightsConfirmed`).
 */

export { CLIP_MESSAGES, CLIP_UPLOAD_CONTENT_TYPES, MAX_CLIP_BYTES, MAX_CLIP_DURATION_MS } from "@/lib/clip-rules";
export type { ClipUploadContentType } from "@/lib/clip-rules";

export interface ClipUploadRequest {
  /** The file's size in bytes (413 over MAX_CLIP_BYTES). */
  sizeBytes: number;
  /** The file's type: video/mp4 or video/quicktime (the bytes are checked whatever it says). */
  contentType: ClipUploadContentType;
}

/** 201 from POST …/clip/uploads. */
export interface ClipUploadTicket {
  /** Pass to attachClip once the upload is done. */
  uploadId: string;
  /** Upload the file here with uploadClipToStorage (a PUT; once only, no overwrite). */
  uploadUrl: string;
  /** When uploadUrl stops working (2 hours on). */
  expiresAt: string;
  /** The cap, in bytes (10 MB): for "up to {cap} MB". */
  maxBytes: number;
}

/**
 * PUT …/clip's body: a new clip (its uploadId, with the rights confirmed),
 * or, without an uploadId, a new description for the event's clip (the
 * rights were confirmed when it was added, so they aren't sent again).
 */
export type AttachClipInput =
  | {
      /** From requestClipUpload. */
      uploadId: string;
      /** 1–300 characters: the clip's text alternative. */
      description: string;
      /** The rights checkbox: must be true, and only with an uploadId. */
      rightsConfirmed: true;
    }
  | {
      uploadId?: never;
      /** 1–300 characters: the clip's text alternative. */
      description: string;
      rightsConfirmed?: never;
    };

export type AdminAttachClipInput = AttachClipInput & {
  /** Optional, up to 500 characters, shown in the event's log. */
  reason?: string;
};

/** 200 from GET …/clip/preview: a short-lived (10-minute) URL for a <video> src. */
export interface ClipPreview {
  url: string;
  expiresAt: string;
}

const clipPath = (eventId: string) => `/events/${encodeURIComponent(eventId)}/clip`;
const adminClipPath = (eventId: string) => `/admin/events/${encodeURIComponent(eventId)}/clip`;

// ---------------------------------------------------------------------------
// The organiser's own event (a draft or rejected)
// ---------------------------------------------------------------------------

/**
 * A signed upload URL for a new clip. ApiError 400 (fieldErrors.clip) a type
 * or size that can't be a clip; 404; 409 the event isn't a draft or
 * rejected; 413 over the cap; 429 over 20 a day; 503 clips unavailable.
 */
export async function requestClipUpload(eventId: string, input: ClipUploadRequest, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<ClipUploadTicket>(`${clipPath(eventId)}/uploads`, { method: "POST", body: input, token });
}

/**
 * Attaches the uploaded clip (or, without an uploadId, changes its
 * description). Returns the event, its `clip` the new version. ApiError 400
 * fieldErrors; 404; 409; 410 the upload expired (choose the clip again); 413;
 * 503 clips unavailable (CLIP_MESSAGES.unavailable in fieldErrors.clip).
 */
export async function attachClip(eventId: string, input: AttachClipInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(clipPath(eventId), { method: "PUT", body: input, token });
}

/** Removes the event's clip (fine if it has none). Returns the event. ApiError 404; 409. */
export async function deleteClip(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<EventRecord>(clipPath(eventId), { method: "DELETE", token });
}

/** The owner's (or an admin's) preview of a clip on any event, published or not. ApiError 404; 503. */
export async function getClipPreview(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<ClipPreview>(`${clipPath(eventId)}/preview`, { token });
}

// ---------------------------------------------------------------------------
// Admin: any event, any status (logged `edited`)
// ---------------------------------------------------------------------------

export async function adminRequestClipUpload(eventId: string, input: ClipUploadRequest, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<ClipUploadTicket>(`${adminClipPath(eventId)}/uploads`, { method: "POST", body: input, token });
}

/** Returns the AdminEventRecord: take the event's next version (`updatedAt`) from it. */
export async function adminAttachClip(eventId: string, input: AdminAttachClipInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminEventRecord>(adminClipPath(eventId), { method: "PUT", body: input, token });
}

export async function adminDeleteClip(eventId: string, getToken: GetToken, reason?: string) {
  const token = await getToken();
  return apiFetch<AdminEventRecord>(adminClipPath(eventId), {
    method: "DELETE",
    ...(reason ? { body: { reason } } : {}),
    token,
  });
}

// ---------------------------------------------------------------------------
// The upload itself
// ---------------------------------------------------------------------------

export interface UploadClipOptions {
  /** The type given to requestClipUpload. */
  contentType: ClipUploadContentType;
  /** 0–1, as the bytes go out. */
  onProgress?: (fraction: number) => void;
  /** Cancels the upload: the promise then rejects with an AbortError DOMException. */
  signal?: AbortSignal;
}

/**
 * PUTs the file to a signed upload URL from requestClipUpload, as
 * @supabase/storage-js's uploadToSignedUrl does for a raw body (a PUT to
 * /object/upload/sign/… with the URL's token, `content-type`,
 * `x-upsert: false` and `cache-control`), plus the publishable key as
 * `apikey`. Uses XMLHttpRequest for upload progress. Refuses a URL that isn't
 * on this project's Supabase origin. Rejects with an ApiError: status 0 and
 * CLIP_MESSAGES.networkDrop when the connection drops, 413 too large, 410
 * the URL expired, anything else as Storage answered.
 */
export function uploadClipToStorage(uploadUrl: string, file: Blob, options: UploadClipOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(uploadUrl);
    } catch {
      reject(new ApiError(0, CLIP_MESSAGES.unavailable, { clip: CLIP_MESSAGES.unavailable }));
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || url.origin !== new URL(SUPABASE_URL).origin) {
      reject(new ApiError(0, CLIP_MESSAGES.unavailable, { clip: CLIP_MESSAGES.unavailable }));
      return;
    }
    if (options.signal?.aborted) {
      reject(options.signal.reason ?? new DOMException("The upload was cancelled.", "AbortError"));
      return;
    }

    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanUp = () => options.signal?.removeEventListener("abort", onAbort);
    xhr.open("PUT", url.href);
    xhr.setRequestHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("content-type", options.contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) options.onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      cleanUp();
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        resolve();
        return;
      }
      if (xhr.status === 413) {
        const message = CLIP_MESSAGES.tooLarge(file.size);
        reject(new ApiError(413, message, { clip: message }));
      } else if ((xhr.status === 400 || xhr.status === 415) && /mime/i.test(xhr.responseText ?? "")) {
        // The bucket's allowed_mime_types refused the declared type.
        reject(new ApiError(415, CLIP_MESSAGES.notMp4, { clip: CLIP_MESSAGES.notMp4 }));
      } else if (xhr.status === 400 || xhr.status === 401 || xhr.status === 403) {
        // An expired or used upload URL (Storage answers 400 with "jwt expired", or 403).
        reject(new ApiError(410, CLIP_MESSAGES.uploadExpired, { clip: CLIP_MESSAGES.uploadExpired }));
      } else {
        reject(new ApiError(xhr.status, CLIP_MESSAGES.unavailable, { clip: CLIP_MESSAGES.unavailable }));
      }
    };
    xhr.onerror = () => {
      cleanUp();
      reject(new ApiError(0, CLIP_MESSAGES.networkDrop, { clip: CLIP_MESSAGES.networkDrop }));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      cleanUp();
      reject(options.signal?.reason ?? new DOMException("The upload was cancelled.", "AbortError"));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(file);
  });
}
