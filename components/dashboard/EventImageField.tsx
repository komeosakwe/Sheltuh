"use client";

import { useEffect, useRef, useState } from "react";
import EventArt from "@/components/EventArt";
import { Button, buttonClass } from "@/components/ui/Button";
import { fetchPrivateEventImage } from "@/lib/api/events";
import type { GetToken } from "@/lib/api/client";
import { ImageError, prepareEventImage } from "@/lib/image";
import type { EventPoster } from "@/lib/types";

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
  /** The generated artwork the event shows until it has a photo (the same the public card shows). */
  poster: EventPoster;
  /** The event's title, for the artwork's initial. */
  title: string;
  /**
   * The photo as it'd show (an object URL: the new pick, or the saved one fetched with the owner's
   * token), or null when there's none. For the summary and the live preview, which share it.
   */
  onPreviewUrl?: (url: string | null) => void;
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
  poster,
  title,
  onPreviewUrl,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [existingPreview, setExistingPreview] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

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
        if (!cancelled) {
          setExistingPreview(null);
          setFailedUrl(existingUrl);
        }
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

  useEffect(() => {
    onPreviewUrl?.(shown);
  }, [shown, onPreviewUrl]);

  return (
    <div className="flex flex-col gap-3">
      <p id="event-image-title" className="eyebrow text-muted">
        Event photo
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-64">
          {/* The frame the event page crops the photo to (3:2; 4:3 on phones), and the generated artwork
              it shows until there's a photo. A portrait photo is shown whole on black, as on the page. */}
          <div
            role={shown ? "img" : undefined}
            aria-label={shown ? "Event photo preview" : undefined}
            className="relative aspect-[3/2] w-full overflow-hidden rounded-control bg-surface"
          >
            {shown || !hasImage ? (
              <EventArt
                poster={poster}
                imageUrl={shown ?? undefined}
                title={title.trim() || "Untitled event"}
                fit="auto"
                className="size-full"
              />
            ) : (
              <p className="flex size-full items-center justify-center px-3 text-center text-xs text-muted">
                {failedUrl === existingUrl ? "Couldn\u2019t load the preview" : "Loading\u2026"}
              </p>
            )}
          </div>
          {!hasImage && <p className="text-xs leading-4 text-muted">No photo yet. Artwork is generated.</p>}
        </div>
        <div className="flex flex-col items-start gap-3">
          {/* The native picker, visually hidden but focusable (its focus ring shows on the label,
              styled as a button); named "Event photo, Choose a photo". */}
          <input
            ref={inputRef}
            id="event-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => handlePick(e.target.files?.[0])}
            aria-labelledby="event-image-title event-image-pick"
            aria-describedby={pickError || error ? "event-image-hint event-image-error" : "event-image-hint"}
            aria-invalid={pickError || error ? true : undefined}
            className="peer sr-only"
          />
          <label
            id="event-image-pick"
            htmlFor="event-image"
            className={buttonClass(
              "outline",
              "sm",
              "min-h-11 cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-foreground",
            )}
          >
            {hasImage ? "Choose another photo" : "Choose a photo"}
          </label>
          <p id="event-image-hint" className="max-w-sm text-xs text-muted">
            Landscape works best. JPEG, PNG or WebP. Only use images you have the rights to.
          </p>
          {hasImage && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
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
      {(pickError || error) && (
        <p id="event-image-error" className="text-sm text-danger">
          {pickError ?? error}
        </p>
      )}
    </div>
  );
}
