"use client";

import type { MouseEvent } from "react";
import { clipPlayLabel, clipTimeLabel } from "@/lib/clip-display";
import type { SheltuhEvent } from "@/lib/types";
import { useClipViewer } from "./ClipViewer";

/** The play glyph (never the "▶" character, which iOS draws as an emoji). */
function PlayGlyph({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className={className} fill="currentColor">
      <path d="M3 1.5v9l7.5-4.5z" />
    </svg>
  );
}

/** Opaque on any photo, in both themes (§2): never translucent, never orange. Hover inverts, like .btn-outline. */
const COLOURS = "border-foreground bg-background text-foreground";
const MOTION = "motion-safe:transition motion-safe:duration-150";

/**
 * The Play control for an event's clip (docs/design/event-clips.md §5.1,
 * §5.3): a real button, named "Play clip: {title}, 12 seconds", that opens
 * the page's clip viewer. Nothing loads before it's pressed. `card`: a 36px
 * chip with the length ("0:12") in a 44px target, for the bottom-left of an
 * EventCard's image; `hero`: a 44px chip that also says "Play clip", for the
 * event page's photo. Renders nothing for an event without a clip, or
 * outside a ClipViewerProvider.
 */
export default function ClipPlayButton({
  event,
  size = "card",
  className = "",
}: {
  event: Pick<SheltuhEvent, "id" | "title" | "imageUrl" | "clip">;
  size?: "card" | "hero";
  className?: string;
}) {
  const viewer = useClipViewer();
  const clip = event.clip;
  if (!viewer || !clip) return null;

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (!viewer || !clip) return;
    viewer.open({
      title: event.title,
      clip: { url: clip.url, description: clip.description, width: clip.width, height: clip.height },
      poster: event.imageUrl,
      trigger: e.currentTarget,
    });
  }

  const time = (
    <span className="font-mono text-xs leading-4 font-medium tabular-nums">{clipTimeLabel(clip.durationMs)}</span>
  );

  if (size === "hero") {
    return (
      <button
        type="button"
        data-clip-play={event.id}
        aria-label={clipPlayLabel(event.title, clip.durationMs)}
        aria-haspopup="dialog"
        onClick={handleClick}
        className={`inline-flex h-11 items-center gap-2 rounded-control border px-3.5 ${COLOURS} hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${MOTION} motion-safe:active:scale-95 ${className}`
          .replace(/\s+/g, " ")
          .trim()}
      >
        <PlayGlyph className="size-4" />
        <span className="text-[0.8125rem] leading-4 font-semibold tracking-[0.02em] uppercase">Play clip</span>
        {time}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-clip-play={event.id}
      aria-label={clipPlayLabel(event.title, clip.durationMs)}
      aria-haspopup="dialog"
      onClick={handleClick}
      className={`group/play flex min-h-11 min-w-11 items-center justify-start focus-visible:outline-none ${className}`.trim()}
    >
      <span
        aria-hidden="true"
        className={`flex h-9 items-center gap-1.5 rounded-control border px-2.5 ${COLOURS} group-hover/play:bg-foreground group-hover/play:text-background group-focus-visible/play:ring-2 group-focus-visible/play:ring-ink group-focus-visible/play:ring-offset-2 group-focus-visible/play:ring-offset-paper ${MOTION} motion-safe:group-active/play:scale-95`}
      >
        <PlayGlyph className="size-3" />
        {time}
      </span>
    </button>
  );
}
