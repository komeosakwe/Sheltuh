"use client";

import { PauseIcon, PlayIcon } from "./icons";
import { RAIL_BUTTON } from "./RailArrows";

/**
 * A rail's Pause/Play button for its auto-scroll (WCAG 2.2.2: moving
 * content can be stopped), in the section head before the Previous/Next
 * buttons, at every width (on phones it's the head's only rail control).
 * The name says what a press does now and names the section ("Pause
 * auto-scroll: Popular right now"). `motion-reduce:hidden`: under reduced
 * motion nothing moves, so it's hidden even in the server render, before
 * the script knows the preference (`useRailAutoScroll` then drops it).
 */
export default function RailAutoScrollButton({
  playing,
  onToggle,
  controls,
  title,
}: {
  playing: boolean;
  onToggle: () => void;
  /** The rail's id (aria-controls). */
  controls: string;
  /** The section's title, so each section's button has its own name. */
  title: string;
}) {
  return (
    <button
      type="button"
      // AUTO_SCROLL_TOGGLE_ATTR: focus here never pauses the rail, so Play from the keyboard plays.
      data-rail-autoscroll-toggle=""
      aria-label={`${playing ? "Pause" : "Play"} auto-scroll: ${title}`}
      aria-controls={controls}
      onClick={onToggle}
      className={`flex ${RAIL_BUTTON} motion-reduce:hidden`}
    >
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}
