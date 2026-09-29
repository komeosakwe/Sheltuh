"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { fetchPrivateEventImage } from "@/lib/api/events";
import type { GetToken } from "@/lib/api/client";
import { ImageError, prepareEventImage } from "@/lib/image";

interface Props {
  getToken: GetToken;
  /** The event's saved photo, if it has one. */
  existingUrl?: string;
  /** A newly chosen (already downsized) image waiting to be saved with the event. */
  pending: Blob | null;
  onPendingChange: (image: Blob | null) => void;
  /** True when the organiser has chosen to remove the saved photo. */
  removed: boolean;
  onRemovedChange: (removed: boolean) => void;
  error?: string;
}

/** Photo picker for the event editor: preview, replace and remove. Upload happens when the event is saved. */
export default function EventImageField({
  getToken,
  existingUrl,
  pending,
  onPendingChange,
  removed,
  onRemovedChange,
  error,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [existingPreview, setExistingPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    const url = URL.createObjectURL(pending);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived object URL, revoked in cleanup
    setPendingPreview(url);
    return () => {
      URL.revokeObjectURL(url);
      setPendingPreview(null);
    };
  }, [pending]);

  useEffect(() => {
    if (!existingUrl) return;
    let cancelled = false;
    let url: string | null = null;
    // A draft's photo is private, so it's fetched with the owner's token.
    fetchPrivateEventImage(existingUrl, getToken)
      .then((objectUrl) => {
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else {
          url = objectUrl;
          setExistingPreview(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setExistingPreview(null);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [existingUrl, getToken]);

  async function handlePick(file: File | undefined) {
    setPickError(null);
    if (!file) return;
    try {
      onPendingChange(await prepareEventImage(file));
      onRemovedChange(false);
    } catch (err) {
      setPickError(err instanceof ImageError ? err.message : "Couldn't read that image.");
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  const shown = pending ? pendingPreview : existingUrl && !removed ? existingPreview : null;
  const hasImage = Boolean(pending) || Boolean(existingUrl && !removed);

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="event-image" className="text-sm font-medium text-foreground">
        Event photo
      </label>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex aspect-square w-40 shrink-0 items-center justify-center overflow-hidden bg-surface text-xs text-muted">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={shown} alt="Event photo preview" className="h-full w-full object-cover" />
          ) : (
            <span className="px-3 text-center">{hasImage ? "Loading…" : "No photo yet"}</span>
          )}
        </div>
        <div className="flex flex-col items-start gap-3">
          <input
            ref={inputRef}
            id="event-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => handlePick(e.target.files?.[0])}
            className="max-w-full text-sm"
          />
          <p className="max-w-sm text-xs text-muted">
            A square or portrait poster or photo works best. JPEG, PNG or WebP, resized automatically. Only
            use images you have the rights to.
          </p>
          {hasImage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (pending) onPendingChange(null);
                else onRemovedChange(true);
              }}
            >
              {pending ? "Discard new photo" : "Remove photo"}
            </Button>
          )}
        </div>
      </div>
      {(pickError || error) && <p className="text-sm text-danger">{pickError ?? error}</p>}
    </div>
  );
}
