"use client";

import { useId, useState } from "react";
import { useMotionOk } from "@/components/ui/useMotionOk";

/** The words around the badge (owner, 23 Oct 2026). Decorative: the hero's eyebrow already says where. */
export const HERO_BADGE_TEXT = "Melbourne · Naarm · Curated · ";
/** One turn every 30 seconds: slow, so it reads as texture rather than movement to follow. */
export const HERO_BADGE_TURN = "30s";

function BadgeArt({ spinning, paused }: { spinning: boolean; paused: boolean }) {
  const pathId = useId();
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      data-hero-badge-art=""
      // `motion-safe:` keeps it still for reduced motion even before the script knows.
      className={`size-full ${spinning ? "motion-safe:animate-spin group-hover/badge:[animation-play-state:paused]" : ""}`.trim()}
      style={spinning ? { animationDuration: HERO_BADGE_TURN, animationPlayState: paused ? "paused" : undefined } : undefined}
    >
      <defs>
        <path id={pathId} d="M50,50 m-37,0 a37,37 0 1,1 74,0 a37,37 0 1,1 -74,0" />
      </defs>
      <text fontSize="9" fontWeight="700" fill="currentColor">
        {/* Spread to exactly one lap of the circle (2π × 37), whatever the font's widths. */}
        <textPath href={`#${pathId}`} textLength="232" lengthAdjust="spacing">
          {HERO_BADGE_TEXT.toUpperCase()}
        </textPath>
      </text>
      <circle cx="50" cy="50" r="5" fill="currentColor" />
    </svg>
  );
}

/**
 * The desktop hero collage's round badge, "MELBOURNE · NAARM · CURATED"
 * set on a circle around a dot (restored from the original collage at the
 * owner's request, 23 Oct 2026; circles are otherwise off-brand). It turns
 * slowly. Moving content needs a way to stop it (WCAG 2.2.2), so where it
 * moves the badge is a button that pauses and restarts it, and it also holds
 * still under the pointer. For people who prefer reduced motion it never
 * turns and isn't a control (and the server render, before the preference
 * is known, is the still one; CSS keeps it still meanwhile). Black on
 * Signal Orange (6.18:1).
 *
 * `still`: never turns and is never a control, whatever the motion
 * preference: for a badge too small to be a 44px Pause/Play target (the
 * hero's thumbnail below 1024px, `HeroThumb`).
 */
export default function HeroBadge({ className = "", still = false }: { className?: string; still?: boolean }) {
  const motionOk = useMotionOk();
  const [paused, setPaused] = useState(false);
  const shape = `flex items-center justify-center rounded-full bg-signal p-1 text-signal-foreground ${className}`.trim();

  if (still || !motionOk) {
    return (
      <span aria-hidden="true" data-hero-badge="" className={shape}>
        <BadgeArt spinning={false} paused />
      </span>
    );
  }
  return (
    <button
      type="button"
      data-hero-badge=""
      // The name says what a press does now; the words on the badge are decoration.
      aria-label={paused ? "Play the badge animation" : "Pause the badge animation"}
      onClick={() => setPaused((p) => !p)}
      className={`group/badge cursor-pointer ${shape}`}
    >
      <BadgeArt spinning paused={paused} />
    </button>
  );
}
