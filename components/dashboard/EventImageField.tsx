"use client";

import { useEffect, useRef, useState } from "react";
import EventArt from "@/components/EventArt";
import EventFocusControl from "@/components/dashboard/EventFocusControl";
import { Button, buttonClass } from "@/components/ui/Button";
import { fetchPrivateEventImage } from "@/lib/api/events";
import type { GetToken } from "@/lib/api/client";
import { ImageError, prepareEventImage } from "@/lib/image";
import type { BannerFit, EventPoster, ImageFocus } from "@/lib/types";

/** A photo whose preparation ended once publishing had started (`locked`): not taken. */
export const PHOTO_NOT_ADDED_WHILE_PUBLISHING =
  "That photo wasn\u2019t added: the event is being published. Choose it again if publishing doesn\u2019t go through.";

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
  /** Where the photo's subject is (null: the middle). Saved with the photo. */
  focus: ImageFocus | null;
  onFocusChange: (focus: ImageFocus | null) => void;
  /** How the home page's featured banner shows the photo: cropped to fill (`crop`) or whole. Saved with the photo. */
  bannerFit: BannerFit;
  onBannerFitChange: (fit: BannerFit) => void;
  /**
   * While the event is being published: the photo, its focus and its fit can't change (publishing sends the ones
   * it started with, and a published event's photo can't be saved by the organiser afterwards). Choosing and
   * removing are off, and a photo still being prepared when it started isn't taken. Off again if it fails.
   */
  locked?: boolean;
  /**
   * Said where it's seen while publishing (the editor's status line, outside the step panels: this field's own
   * step is hidden then): a photo wasn't taken because publishing had started.
   */
  onLockedPick?: (message: string) => void;
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
  focus,
  onFocusChange,
  bannerFit,
  onBannerFitChange,
  locked = false,
  onLockedPick,
  error,
  poster,
  title,
  onPreviewUrl,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  // `locked` as now, for a photo whose preparation (downsizing) ends after publishing started.
  const lockedNow = useRef(locked);
  useEffect(() => {
    lockedNow.current = locked;
  }, [locked]);
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
      const prepared = await prepareEventImage(file);
      if (lockedNow.current) {
        // Publishing started meanwhile: it goes with the photo it started with; this one isn't taken. Said here (for
        // when this step is shown again) and where it's seen now (onLockedPick).
        setPickError(PHOTO_NOT_ADDED_WHILE_PUBLISHING);
        onLockedPick?.(PHOTO_NOT_ADDED_WHILE_PUBLISHING);
      } else {
        onPendingChange(prepared);
        onRemovedChange(false);
        // The focus belongs to the photo it was set on.
        onFocusChange(null);
      }
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
                imageFocus={focus}
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
            disabled={locked}
            aria-labelledby="event-image-title event-image-pick"
            aria-describedby={pickError || error ? "event-image-hint event-image-error" : "event-image-hint"}
            aria-invalid={pickError || error ? true : undefined}
            className="peer sr-only"
          />
          <label
            id="event-image-pick"
            htmlFor="event-image"
            aria-disabled={locked || undefined}
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
              busy={locked}
              onClick={() => {
                // When this button goes (no photo left), focus moves to Choose a photo rather than the page.
                const goes = !pending || !(existingUrl && !removed);
                if (pending) onPendingChange(null);
                else onRemovedChange(true);
                if (goes) inputRef.current?.focus();
              }}
            >
              {pending ? "Discard new photo" : "Remove photo"}
            </Button>
          )}
        </div>
      </div>
      {shown && (
        <EventFocusControl
          imageUrl={shown}
          focus={focus}
          onChange={onFocusChange}
          disabled={locked}
          poster={poster}
          title={title.trim() || "Untitled event"}
        />
      )}
      {hasImage && (
        <div data-banner-fit="" className="flex flex-col gap-3 border-t border-surface-border pt-4">
          <p className="eyebrow text-muted">Home banner</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex flex-col gap-1">
              <label className="flex min-h-11 items-start gap-3 text-sm text-foreground">
                <input
                  id="event-banner-fit"
                  type="checkbox"
                  checked={bannerFit === "whole"}
                  disabled={locked}
                  onChange={(e) => onBannerFitChange(e.target.checked ? "whole" : "crop")}
                  aria-describedby="event-banner-fit-hint"
                  className="mt-0.5 size-4 shrink-0"
                />
                Show the whole photo in the home banner
              </label>
              <p id="event-banner-fit-hint" className="max-w-sm text-xs text-muted">
                If your event is featured at the top of the home page, show the whole photo instead of cropping it. Unticked, it&rsquo;s cropped around your focus point.
              </p>
            </div>
            {/* The banner as it shows from 1024px (5:2) and on a phone (4:5): whole on the photo's blurred backdrop
                (at the top on a phone), or cropped as the banner crops it (FeaturedCarousel's focal defaults when
                there's no focus). Over each, the home's scrim (banner-scrim) where the words sit. */}
            {shown && (
              <div data-banner-previews="" className="flex w-full items-end gap-3 sm:w-auto">
                <BannerPreview
                  label="Banner"
                  data={{ "data-banner-preview": "" }}
                  className="min-w-0 flex-1 sm:w-64 sm:flex-none"
                  frameClassName="aspect-[5/2]"
                  scrimClassName="h-2/3"
                  imgClassName={bannerFit === "whole" || focus ? undefined : "object-[50%_35%]"}
                  poster={poster}
                  shown={shown}
                  focus={focus}
                  bannerFit={bannerFit}
                  title={title}
                />
                <BannerPreview
                  label="Phone"
                  data={{ "data-banner-phone-preview": "" }}
                  className="w-20 shrink-0"
                  frameClassName="aspect-[4/5]"
                  scrimClassName="h-3/4"
                  imgClassName={bannerFit === "whole" ? "object-top" : focus ? undefined : "object-[50%_50%]"}
                  poster={poster}
                  shown={shown}
                  focus={focus}
                  bannerFit={bannerFit}
                  title={title}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {(pickError || error) && (
        <p id="event-image-error" className="text-sm text-danger">
          {pickError ?? error}
        </p>
      )}
    </div>
  );
}

/**
 * One of the editor's previews of the home banner: the photo in the banner's frame, as the banner shows it (whole
 * or cropped), with the home's scrim (banner-scrim, its fade scaled to the preview) over the share of it the words
 * take there: about two thirds of the 5:2 banner, three quarters of a phone's 4:5 slide.
 */
function BannerPreview({
  label,
  data,
  className,
  frameClassName,
  scrimClassName,
  imgClassName,
  poster,
  shown,
  focus,
  bannerFit,
  title,
}: {
  label: string;
  data: Record<`data-${string}`, string>;
  className: string;
  frameClassName: string;
  scrimClassName: string;
  imgClassName: string | undefined;
  poster: EventPoster;
  shown: string;
  focus: ImageFocus | null;
  bannerFit: BannerFit;
  title: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div data-surface="ink" {...data} className="relative overflow-hidden rounded-control">
        <EventArt
          poster={poster}
          imageUrl={shown}
          imageFocus={focus}
          imgClassName={imgClassName}
          title={title.trim() || "Untitled event"}
          fit={bannerFit === "whole" ? "contain" : "poster"}
          className={`${frameClassName} w-full`}
        />
        <div aria-hidden="true" data-preview-scrim="" className={`banner-scrim banner-scrim-scaled absolute inset-x-0 bottom-0 ${scrimClassName}`} />
      </div>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}
