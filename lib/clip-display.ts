import { clipSeconds, MAX_CLIP_SECONDS } from "@/lib/clip-rules";

/**
 * How a clip's length is shown (docs/design/event-clips.md §5.1): whole
 * seconds, rounded, at least 1 and at most 15 (a clip may run to 15.5 s for
 * encoder rounding, but people are told 15).
 */
export function clipDisplaySeconds(durationMs: number): number {
  return Math.min(MAX_CLIP_SECONDS, clipSeconds(durationMs));
}

/** The chip's visible length: "0:12", "0:05". */
export function clipTimeLabel(durationMs: number): string {
  return `0:${String(clipDisplaySeconds(durationMs)).padStart(2, "0")}`;
}

/**
 * A Play control's accessible name: "Play clip: {title}, 0:12". It contains
 * the control's visible words ("Play clip", "0:12") in order, so people who
 * speak what they see can use it (WCAG 2.5.3, Label in Name).
 */
export function clipPlayName(title: string, durationMs: number): string {
  return `Play clip: ${title}, ${clipTimeLabel(durationMs)}`;
}
