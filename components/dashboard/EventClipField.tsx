"use client";

import { useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { getClipPreview } from "@/lib/api/clips";
import type { GetToken } from "@/lib/api/client";
import { clipMegabytes, MAX_CLIP_BYTES, MAX_CLIP_DESCRIPTION_LENGTH } from "@/lib/clip-rules";
import type { EventClipDraft } from "./useEventClip";

const PREVIEW_FAILED = "Couldn’t load the preview";

/** The status line under the progress bar while a save handles the clip (§5.4). */
function statusText(draft: EventClipDraft["state"]): string {
  switch (draft.phase.kind) {
    case "uploading":
      return `Uploading clip… ${draft.phase.percent}%`;
    case "checking":
      return "Checking the clip…";
    case "saved":
      return draft.file ? "Ready to upload when you save." : "Clip saved.";
    case "idle":
      return draft.file ? "Ready to upload when you save." : "";
  }
}

/**
 * The event editor's clip (docs/design/event-clips.md §5.4), right after the
 * photo, in organiser and admin modes: an optional short, silent MP4 or MOV
 * (H.264) with a required description, and for a new clip the rights
 * confirmation. The browser checks the file first (lib/clip-precheck.ts);
 * it's uploaded when the event is saved (`useEventClip`'s `sync`), with
 * progress and Cancel. Every error, the browser's or the server's, is shown
 * here in the server's own words.
 */
export default function EventClipField({
  draft,
  getToken,
  eventId,
  onRetry,
}: {
  draft: EventClipDraft;
  getToken: GetToken;
  /** The saved event (for a saved clip's preview); none before the first save. */
  eventId?: string;
  /** The upload stopped: save again. */
  onRetry: () => void;
}) {
  const { state } = draft;
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [savedPreview, setSavedPreview] = useState<{ key: string; url: string } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

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
  }, [previewKey, eventId, getToken]);

  const previewSrc = state.file ? pendingPreview : savedPreview && savedPreview.key === previewKey ? savedPreview.url : null;
  const busy = state.phase.kind === "uploading" || state.phase.kind === "checking";
  const status = statusText(state);
  const { errors } = state;
  const cap = clipMegabytes(MAX_CLIP_BYTES);

  return (
    <div className="flex flex-col gap-3" data-clip-field="">
      <p id="event-clip-title" className="eyebrow text-muted">
        Event clip (optional)
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {previewSrc ? (
          <div className="w-40 shrink-0 overflow-hidden rounded-control bg-ink">
            <video
              key={previewSrc}
              src={previewSrc}
              controls
              muted
              playsInline
              preload="metadata"
              aria-label="Clip preview"
              className="block max-h-60 w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex aspect-square w-40 shrink-0 items-center justify-center rounded-control bg-surface px-3 text-center text-xs text-muted">
            {hasClip ? (failedKey !== null && failedKey === previewKey ? PREVIEW_FAILED : "Loading…") : "No clip yet"}
          </div>
        )}
        <div className="flex flex-col items-start gap-3">
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
            Compatible, or export as H.264. It plays when someone taps the event’s photo.
          </p>
          {hasClip && !busy && (
            <Button variant="outline" size="sm" className="min-h-11" onClick={state.file ? draft.discard : draft.remove}>
              {state.file ? "Discard new clip" : "Remove clip"}
            </Button>
          )}
        </div>
      </div>

      {hasClip && (
        <div className="flex flex-col gap-1">
          <label htmlFor="event-clip-description" className="eyebrow text-muted">
            Describe the clip
          </label>
          <textarea
            id="event-clip-description"
            rows={3}
            maxLength={MAX_CLIP_DESCRIPTION_LENGTH}
            required
            value={state.description}
            onChange={(e) => draft.setDescription(e.target.value)}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={`event-clip-description-hint${errors.description ? " event-clip-description-error" : ""}`}
            className={fieldClass}
          />
          <div className="flex items-start justify-between gap-3">
            <p id="event-clip-description-hint" className="text-xs leading-4 text-muted">
              What happens in it, for people who can’t see it. Shown under the clip.
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
              type="checkbox"
              required
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
        {state.phase.kind === "uploading" && (
          <Button variant="outline" size="sm" className="min-h-11 w-fit" onClick={draft.cancelUpload}>
            Cancel upload
          </Button>
        )}
      </div>

      {errors.clip && (
        <div className="flex flex-col items-start gap-2">
          <p id="event-clip-error" role="alert" className="text-sm text-danger">
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
