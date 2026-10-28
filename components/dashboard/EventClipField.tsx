"use client";

import { useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { getClipPreview } from "@/lib/api/clips";
import type { GetToken } from "@/lib/api/client";
import { clipMegabytes, MAX_CLIP_BYTES, MAX_CLIP_DESCRIPTION_LENGTH } from "@/lib/clip-rules";
import type { EventClipDraft } from "./useEventClip";

const PREVIEW_FAILED = "Couldn’t load the preview";
const LOCAL_PREVIEW_FAILED = "This browser can’t preview this clip";
const READY = "Ready to upload when you save.";

/**
 * The status line (§5.4): the file's check, the save's clip step, or what the
 * person's last action did. Blank while the field shows an error, which says
 * it all.
 */
export function clipStatusText(draft: EventClipDraft["state"]): string {
  if (draft.errors.clip) return "";
  if (draft.checkingFile) return "Checking the file…";
  switch (draft.phase.kind) {
    case "uploading":
      return `Uploading clip… ${draft.phase.percent}%`;
    case "checking":
      return "Checking the clip…";
    case "saved":
      return draft.file ? READY : "Clip saved.";
    case "idle":
      if (draft.notice === "cancelled") return "Upload cancelled. The event was saved without the new clip.";
      if (draft.file) return READY;
      if (draft.removed && draft.saved) return "The clip will be removed when you save.";
      if (draft.notice === "removed") return "Clip removed.";
      if (draft.notice === "kept") return "Keeping the current clip.";
      return "";
  }
}

/** Where focus goes once the field has re-rendered (the file input stays disabled until an upload has stopped). */
type FocusTarget = "event-clip" | "event-clip-remove" | "event-clip-undo";

/**
 * The event editor's clip (docs/design/event-clips.md §5.4), right after the
 * photo, in organiser and admin modes: an optional short, silent MP4 or MOV
 * (H.264) with a required description, and for a new clip the rights
 * confirmation. The browser checks the file first (lib/clip-precheck.ts);
 * it's uploaded when the event is saved (`useEventClip`'s `sync`), with
 * progress and Cancel. Every error, the browser's or the server's, is shown
 * here in the server's own words, and a failed save's reason gets focus.
 * Without `canUpload` (uploads switched off: an admin looking after a clip
 * that's already there) only choosing a file is gone: the saved clip can
 * still be described, previewed and removed.
 */
export default function EventClipField({
  draft,
  getToken,
  eventId,
  onRetry,
  canUpload = true,
}: {
  draft: EventClipDraft;
  getToken: GetToken;
  /** The saved event (for a saved clip's preview); none before the first save. */
  eventId?: string;
  /** The upload stopped: save again. */
  onRetry: () => void;
  /** A new clip can be chosen (NEXT_PUBLIC_EVENT_CLIPS). */
  canUpload?: boolean;
}) {
  const { state } = draft;
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [savedPreview, setSavedPreview] = useState<{ key: string; url: string } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  /** A signed preview URL that wouldn't play is fetched again, once per clip version (it may have expired). */
  const [refreshedKey, setRefreshedKey] = useState<string | null>(null);
  const [previewReload, setPreviewReload] = useState(0);
  /** The new pick's object URL, when this browser can't play it. */
  const [localFailed, setLocalFailed] = useState<string | null>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const seenFailures = useRef(state.failures);

  useEffect(() => {
    // After a failed clip step, its reason (the field's error, or the field it's about).
    if (state.failures !== seenFailures.current) {
      seenFailures.current = state.failures;
      const { errors } = state;
      const target = errors.clip
        ? "event-clip-error"
        : errors.description
          ? "event-clip-description"
          : errors.rightsConfirmed
            ? "event-clip-rights"
            : null;
      if (target) {
        pendingFocus.current = null;
        document.getElementById(target)?.focus();
        return;
      }
    }
    const id = pendingFocus.current;
    if (!id) return;
    const element = document.getElementById(id);
    if (!element || (element instanceof HTMLInputElement && element.disabled)) return; // Not there, or not usable, yet.
    pendingFocus.current = null;
    element.focus();
  });

  const savedClip = state.saved && !state.removed ? state.saved : undefined;
  const hasClip = Boolean(state.file) || Boolean(savedClip);
  // A saved clip's preview, again for each new version (its URL is versioned).
  const previewKey = !state.file && savedClip && eventId ? `${eventId} ${savedClip.url}` : null;

  useEffect(() => {
    if (!state.file) return;
    const url = URL.createObjectURL(state.file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived object URL, revoked in cleanup
    setPendingPreview(url);
    return () => {
      URL.revokeObjectURL(url);
      setPendingPreview(null);
    };
  }, [state.file]);

  useEffect(() => {
    if (!previewKey || !eventId) return;
    let cancelled = false;
    // A draft's clip isn't public: the owner (or an admin) gets a short-lived URL for it.
    getClipPreview(eventId, getToken)
      .then((preview) => {
        if (!cancelled) setSavedPreview({ key: previewKey, url: preview.url });
      })
      .catch(() => {
        if (!cancelled) setFailedKey(previewKey);
      });
    return () => {
      cancelled = true;
    };
  }, [previewKey, eventId, getToken, previewReload]);

  const previewSrc = state.file ? pendingPreview : savedPreview && savedPreview.key === previewKey ? savedPreview.url : null;
  const previewFailed = state.file
    ? pendingPreview !== null && localFailed === pendingPreview
    : failedKey !== null && failedKey === previewKey;
  const busy = state.phase.kind === "uploading" || state.phase.kind === "checking";
  const status = clipStatusText(state);
  const { errors } = state;
  const cap = clipMegabytes(MAX_CLIP_BYTES);
  const canUndo = state.removed && Boolean(state.saved) && !state.file && !busy;

  function previewError() {
    if (state.file) {
      setLocalFailed(pendingPreview);
    } else if (previewKey && refreshedKey !== previewKey) {
      setRefreshedKey(previewKey);
      setPreviewReload((n) => n + 1);
    } else {
      setFailedKey(previewKey);
    }
  }

  function removeOrDiscard() {
    if (state.file) draft.discard();
    else draft.remove();
    pendingFocus.current = canUpload ? "event-clip" : "event-clip-undo";
  }

  return (
    <div className="flex flex-col gap-3" data-clip-field="">
      <p id="event-clip-title" className="eyebrow text-muted">
        Event clip (optional)
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {previewSrc && !previewFailed ? (
          <div className="aspect-[3/2] w-full shrink-0 overflow-hidden rounded-control bg-ink sm:w-64">
            <video
              key={`${previewSrc} ${previewReload}`}
              src={previewSrc}
              controls
              muted
              playsInline
              preload="metadata"
              aria-label="Clip preview"
              onError={previewError}
              className="block size-full object-contain"
            />
          </div>
        ) : (
          <div className="flex aspect-[3/2] w-full shrink-0 items-center justify-center rounded-control bg-surface px-3 text-center text-xs text-muted sm:w-64">
            {hasClip
              ? previewFailed
                ? state.file
                  ? LOCAL_PREVIEW_FAILED
                  : PREVIEW_FAILED
                : "Loading…"
              : "No clip yet"}
          </div>
        )}
        <div className="flex flex-col items-start gap-3">
          {canUpload && (
            <>
              {/* The native picker, visually hidden but focusable (its focus ring shows on the label,
                  styled as a button); named "Event clip (optional), Choose a clip". */}
              <input
                ref={inputRef}
                id="event-clip"
                type="file"
                accept="video/mp4,video/quicktime"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void draft.pick(file);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                aria-labelledby="event-clip-title event-clip-pick"
                aria-describedby={errors.clip ? "event-clip-hint event-clip-error" : "event-clip-hint"}
                aria-invalid={errors.clip ? true : undefined}
                className="peer sr-only"
              />
              <label
                id="event-clip-pick"
                htmlFor="event-clip"
                className={buttonClass(
                  "outline",
                  "sm",
                  "min-h-11 cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
                )}
              >
                {hasClip ? "Choose another clip" : "Choose a clip"}
              </label>
              <p id="event-clip-hint" className="max-w-sm text-xs text-muted">
                Up to 15 seconds, no sound, MP4 or MOV (H.264), up to {cap} MB. On iPhone, set Camera → Formats → Most
                Compatible.
              </p>
            </>
          )}
          {hasClip && !busy && (
            <Button id="event-clip-remove" variant="outline" size="sm" className="min-h-11" onClick={removeOrDiscard}>
              {state.file ? "Discard new clip" : "Remove clip"}
            </Button>
          )}
        </div>
      </div>

      {hasClip && (
        <div className="flex flex-col gap-1">
          <label htmlFor="event-clip-description" className="eyebrow text-muted">
            Describe the clip (required)
          </label>
          <textarea
            id="event-clip-description"
            rows={3}
            maxLength={MAX_CLIP_DESCRIPTION_LENGTH}
            required
            // Not while the save sends it: an edit then would be lost.
            disabled={busy}
            value={state.description}
            onChange={(e) => draft.setDescription(e.target.value)}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={`event-clip-description-hint${errors.description ? " event-clip-description-error" : ""}`}
            className={fieldClass}
          />
          <div className="flex items-start justify-between gap-3">
            <p id="event-clip-description-hint" className="text-xs leading-4 text-muted">
              For people who can’t see it. Shown under the clip.
            </p>
            <p className="meta shrink-0 text-muted tabular-nums">
              {state.description.length}/{MAX_CLIP_DESCRIPTION_LENGTH}
            </p>
          </div>
          {errors.description && (
            <p id="event-clip-description-error" role="alert" className="text-sm text-danger">
              {errors.description}
            </p>
          )}
        </div>
      )}

      {state.file && (
        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 items-start gap-3 text-sm text-foreground">
            <input
              id="event-clip-rights"
              type="checkbox"
              required
              disabled={busy}
              checked={state.rights}
              onChange={(e) => draft.setRights(e.target.checked)}
              aria-invalid={errors.rightsConfirmed ? true : undefined}
              aria-describedby={errors.rightsConfirmed ? "event-clip-rights-error" : undefined}
              className="mt-0.5 size-4 shrink-0"
            />
            I own this clip or have permission to use it, including from everyone who appears in it.
          </label>
          {errors.rightsConfirmed && (
            <p id="event-clip-rights-error" role="alert" className="text-sm text-danger">
              {errors.rightsConfirmed}
            </p>
          )}
        </div>
      )}

      {/* Always mounted, so each step is announced. */}
      <div className="flex flex-col gap-2">
        {busy && (
          <progress
            aria-labelledby="event-clip-status"
            max={100}
            value={state.phase.kind === "uploading" ? state.phase.percent : undefined}
            className="h-1 w-full appearance-none rounded-badge bg-surface [&::-moz-progress-bar]:bg-foreground [&::-webkit-progress-bar]:bg-surface [&::-webkit-progress-value]:bg-foreground"
          />
        )}
        <p id="event-clip-status" aria-live="polite" className="meta text-muted">
          {status}
        </p>
        {canUndo && (
          <Button
            id="event-clip-undo"
            variant="outline"
            size="sm"
            className="min-h-11 w-fit"
            onClick={() => {
              draft.undoRemove();
              pendingFocus.current = "event-clip-remove";
            }}
          >
            Undo
          </Button>
        )}
        {state.phase.kind === "uploading" && (
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 w-fit"
            onClick={() => {
              draft.cancelUpload();
              pendingFocus.current = "event-clip";
            }}
          >
            Cancel upload
          </Button>
        )}
      </div>

      {errors.clip && (
        <div className="flex flex-col items-start gap-2">
          <p id="event-clip-error" role="alert" tabIndex={-1} className="text-sm text-danger outline-offset-2">
            {errors.clip}
          </p>
          {state.networkFailed && (
            <Button variant="outline" size="sm" className="min-h-11" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
