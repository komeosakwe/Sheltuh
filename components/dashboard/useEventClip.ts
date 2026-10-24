"use client";

import { useCallback, useRef, useState } from "react";
import {
  uploadClipToStorage,
  type AttachClipInput,
  type ClipUploadRequest,
  type ClipUploadTicket,
} from "@/lib/api/clips";
import { ApiError, type GetToken } from "@/lib/api/client";
import type { EventRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { precheckClip, type ClipMetadata } from "@/lib/clip-precheck";
import { CLIP_MESSAGES, type ClipUploadContentType } from "@/lib/clip-rules";
import type { EventClip } from "@/lib/types";

/** The clip routes a save uses: the organiser's (lib/api/clips.ts) or the admin's, which answer with the record they're given. */
export interface ClipRoutes<R extends EventRecord> {
  request: (eventId: string, input: ClipUploadRequest, getToken: GetToken) => Promise<ClipUploadTicket>;
  attach: (eventId: string, input: AttachClipInput, getToken: GetToken) => Promise<R>;
  remove: (eventId: string, getToken: GetToken) => Promise<R>;
}

/** Where a save's clip step is (§5.4's status line). */
export type ClipPhase =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "checking" }
  | { kind: "saved" };

export interface ClipFieldErrors {
  clip?: string;
  description?: string;
  rightsConfirmed?: string;
}

export interface ClipDraftState {
  /** The event's clip as last saved (from the record), if it has one. */
  saved?: EventClip;
  /** A newly chosen clip waiting for the next save, its declared type, and what the browser read from it. */
  file: File | null;
  contentType: ClipUploadContentType;
  metadata: ClipMetadata | null;
  description: string;
  rights: boolean;
  /** The saved clip is to be removed at the next save. */
  removed: boolean;
  phase: ClipPhase;
  errors: ClipFieldErrors;
  /** The upload stopped (the connection dropped): offer Try again. */
  networkFailed: boolean;
  /** The browser is reading a chosen file (its pre-checks). */
  checkingFile: boolean;
}

/**
 * Thrown by `sync` when the clip step didn't finish (refused, failed, or
 * cancelled): the reason is already shown in the clip field, so the editor
 * says nothing more, and stops (no navigation, no submission).
 */
export class ClipSyncError extends Error {
  constructor(public cancelled = false) {
    super(cancelled ? "The clip upload was cancelled." : "The clip wasn’t saved.");
    this.name = "ClipSyncError";
  }
}

const IDLE: ClipPhase = { kind: "idle" };

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** The field's errors for a failed clip call: the server's own strings, or the spec's for its status. */
export function clipErrorsFrom(err: unknown, removing: boolean, fileSize?: number): ClipFieldErrors {
  if (err instanceof ApiError) {
    const fields = err.fieldErrors ?? {};
    const errors: ClipFieldErrors = {};
    if (fields.description) errors.description = fields.description;
    if (fields.rightsConfirmed) errors.rightsConfirmed = fields.rightsConfirmed;
    if (fields.clip) errors.clip = fields.clip;
    else if (!errors.description && !errors.rightsConfirmed) {
      errors.clip =
        err.status === 409
          ? removing
            ? CLIP_MESSAGES.removeLocked
            : CLIP_MESSAGES.editLocked
          : err.status === 410
            ? CLIP_MESSAGES.uploadExpired
            : err.status === 413 && fileSize !== undefined
              ? CLIP_MESSAGES.tooLarge(fileSize)
              : err.status === 429
                ? CLIP_MESSAGES.rateLimited
                : err.status === 503
                  ? CLIP_MESSAGES.unavailable
                  : err.message;
    }
    return errors;
  }
  return { clip: err instanceof Error && err.message ? err.message : CLIP_MESSAGES.unavailable };
}

/**
 * The event editor's clip (docs/design/event-clips.md §5.4): what's chosen,
 * described and confirmed, and the save's clip step. Like the photo, nothing
 * is uploaded until the event is saved: `sync` then uploads a new clip
 * (signed URL, the file straight to Storage with progress and Cancel, then
 * the server's check and attach), removes one, or saves a changed
 * description, and returns the latest record. A second `sync` (Submit while
 * a save is uploading) waits for the first. `enabled` false (the flag off):
 * `sync` and `validate` do nothing.
 */
export function useEventClip({ enabled, getToken, saved }: { enabled: boolean; getToken: GetToken; saved?: EventClip }) {
  const [state, setState] = useState<ClipDraftState>(() => ({
    saved,
    file: null,
    contentType: "video/mp4",
    metadata: null,
    description: saved?.description ?? "",
    rights: false,
    removed: false,
    phase: IDLE,
    errors: {},
    networkFailed: false,
    checkingFile: false,
  }));
  // The source of truth across a save's awaits (state lags a render behind); every change goes through `patch`.
  const current = useRef(state);
  const abortRef = useRef<AbortController | null>(null);
  const inFlight = useRef<Promise<unknown> | null>(null);
  /** Each pick, so a slow pre-check of an earlier file never lands after a later one. */
  const pickSeq = useRef(0);

  const patch = useCallback((next: Partial<ClipDraftState>) => {
    current.current = { ...current.current, ...next };
    setState(current.current);
  }, []);

  const pick = useCallback(
    async (file: File) => {
      const seq = ++pickSeq.current;
      patch({ errors: {}, networkFailed: false, phase: IDLE, checkingFile: true });
      const result = await precheckClip(file);
      if (seq !== pickSeq.current) return;
      if (!result.ok) {
        patch({ checkingFile: false, errors: { clip: result.message } });
        return;
      }
      patch({
        checkingFile: false,
        file,
        contentType: result.contentType,
        metadata: result.metadata,
        rights: false,
        removed: false,
      });
    },
    [patch],
  );

  const discard = useCallback(() => {
    pickSeq.current += 1;
    patch({ file: null, metadata: null, rights: false, errors: {}, networkFailed: false, phase: IDLE, checkingFile: false });
  }, [patch]);

  const remove = useCallback(() => {
    patch({ removed: true, errors: {}, networkFailed: false, phase: IDLE });
  }, [patch]);

  const setDescription = useCallback(
    (description: string) => {
      const { errors } = current.current;
      patch({ description, errors: errors.description ? { ...errors, description: undefined } : errors });
    },
    [patch],
  );

  const setRights = useCallback(
    (rights: boolean) => {
      const { errors } = current.current;
      patch({ rights, errors: errors.rightsConfirmed ? { ...errors, rightsConfirmed: undefined } : errors });
    },
    [patch],
  );

  const cancelUpload = useCallback(() => abortRef.current?.abort(), []);

  /** The description and rights a save needs (§5.4); false (with the field's errors shown) if they're missing. */
  const validate = useCallback((): boolean => {
    if (!enabled) return true;
    const s = current.current;
    const hasClip = Boolean(s.file) || Boolean(s.saved && !s.removed);
    const errors: ClipFieldErrors = {};
    if (hasClip && !s.description.trim()) errors.description = CLIP_MESSAGES.describe;
    if (s.file && !s.rights) errors.rightsConfirmed = CLIP_MESSAGES.rights;
    if (Object.keys(errors).length > 0) {
      patch({ errors });
      return false;
    }
    return true;
  }, [enabled, patch]);

  async function run<R extends EventRecord>(record: R, routes: ClipRoutes<R>): Promise<R> {
    const eventId = record.eventId;
    // The record is the server's word on the event's clip.
    patch({ saved: record.clip });
    const s = current.current;
    const description = s.description.trim();
    const removing = !s.file && s.removed;
    try {
      if (s.file) {
        const file = s.file;
        const controller = new AbortController();
        abortRef.current = controller;
        patch({ phase: { kind: "uploading", percent: 0 }, errors: {}, networkFailed: false });
        const ticket = await routes.request(eventId, { sizeBytes: file.size, contentType: s.contentType }, getToken);
        if (controller.signal.aborted) throw new DOMException("The upload was cancelled.", "AbortError");
        let shown = 0;
        await uploadClipToStorage(ticket.uploadUrl, file, {
          contentType: s.contentType,
          signal: controller.signal,
          // Every 10%, so the status line isn't rewritten (and re-announced) at every byte.
          onProgress: (fraction) => {
            const percent = Math.floor(fraction * 10) * 10;
            if (percent === shown) return;
            shown = percent;
            patch({ phase: { kind: "uploading", percent } });
          },
        });
        abortRef.current = null;
        patch({ phase: { kind: "checking" } });
        const updated = await routes.attach(eventId, { uploadId: ticket.uploadId, description, rightsConfirmed: true }, getToken);
        // A pick made while this one uploaded stays for the next save.
        const replaced = current.current.file === file;
        patch({
          saved: updated.clip,
          ...(replaced ? { file: null, metadata: null, rights: false } : {}),
          removed: false,
          description: replaced ? (updated.clip?.description ?? description) : current.current.description,
          phase: { kind: "saved" },
        });
        return updated;
      }
      if (removing && s.saved) {
        const updated = await routes.remove(eventId, getToken);
        patch({ saved: updated.clip, removed: false, description: "", phase: IDLE, errors: {} });
        return updated;
      }
      if (s.saved && !s.removed && description && description !== s.saved.description) {
        // The description only (the rights were confirmed when this clip was added).
        const updated = await routes.attach(eventId, { description, rightsConfirmed: true }, getToken);
        patch({ saved: updated.clip, description: updated.clip?.description ?? description, errors: {} });
        return updated;
      }
      if (removing) patch({ removed: false, description: "" });
      return record;
    } catch (err) {
      abortRef.current = null;
      if (err instanceof SessionExpiredError) {
        patch({ phase: IDLE });
        throw err;
      }
      if (isAbort(err)) {
        patch({ phase: IDLE });
        throw new ClipSyncError(true);
      }
      patch({
        phase: IDLE,
        errors: clipErrorsFrom(err, removing, s.file?.size),
        networkFailed: err instanceof ApiError && err.status === 0 && err.message === CLIP_MESSAGES.networkDrop,
      });
      throw new ClipSyncError();
    }
  }

  /** The save's clip step, after the event (and its photo) are saved. Throws ClipSyncError or SessionExpiredError. */
  async function sync<R extends EventRecord>(record: R, routes: ClipRoutes<R>): Promise<R> {
    if (!enabled) return record;
    while (inFlight.current) {
      await inFlight.current.catch(() => undefined);
    }
    const running = run(record, routes);
    inFlight.current = running;
    try {
      return await running;
    } finally {
      if (inFlight.current === running) inFlight.current = null;
    }
  }

  return { state, pick, discard, remove, setDescription, setRights, cancelUpload, validate, sync };
}

export type EventClipDraft = ReturnType<typeof useEventClip>;
