"use client";

import { featuredVideoKey, featuredVideoPageUrl, parseFeaturedVideoUrl, type FeaturedVideo } from "@/lib/api/featured-video";
import VideoFacade from "./VideoFacade";

export const FEATURED_VIDEO_ERROR =
  "Paste a YouTube or Vimeo link, like youtube.com/watch?v=…, youtu.be/…, youtube.com/shorts/… or vimeo.com/123456.";

/** The client's check of a typed link (the API checks it again): null when it's fine or blank. */
export function featuredVideoUrlError(value: string): string | null {
  if (!value.trim()) return null;
  return parseFeaturedVideoUrl(value) ? null : FEATURED_VIDEO_ERROR;
}

/** The field's starting text for a saved video: its page's link. */
export function featuredVideoInitial(video?: FeaturedVideo | null): string {
  return video ? featuredVideoPageUrl(video) : "";
}

/**
 * Whether the typed link means a different video from `saved` (by provider
 * and id, so a re-pasted link to the same video isn't a change). Blank means
 * none.
 */
export function featuredVideoChanged(value: string, saved?: FeaturedVideo | null): boolean {
  const next = value.trim() ? parseFeaturedVideoUrl(value) : null;
  if (value.trim() && !next) return true;
  return (next ? featuredVideoKey(next) : null) !== (saved ? featuredVideoKey(saved) : null);
}

/**
 * The featured-video field of an organiser's profile (dashboard editor and
 * application form): a pasted YouTube or Vimeo link, a hint with the forms
 * accepted, the error (wired to the field), and a preview of the facade the
 * public will see once the link is one we can show.
 */
export default function FeaturedVideoField({
  id,
  value,
  onChange,
  error,
  labelClassName,
  inputClassName,
  publicNote,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  labelClassName: string;
  inputClassName: string;
  /** A note that it's shown publicly, when the form says so for each field. */
  publicNote?: string;
}) {
  const video = value.trim() ? parseFeaturedVideoUrl(value) : null;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelClassName}>
        Featured video (optional)
      </label>
      <input
        id={id}
        type="url"
        inputMode="url"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=…"
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, hintId].filter(Boolean).join(" ")}
        className={inputClassName}
      />
      <p id={hintId} className="text-sm text-muted">
        One YouTube or Vimeo video, as a link to it. It shows on your profile as a still with a play button, and
        the player only loads when someone presses play. Leave it blank for none.{publicNote ? ` ${publicNote}` : ""}
      </p>
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
      {video && (
        <div className="mt-3 flex max-w-md flex-col gap-2">
          <p className="eyebrow text-muted">Preview</p>
          <VideoFacade video={video} title="Your featured video" />
        </div>
      )}
    </div>
  );
}
