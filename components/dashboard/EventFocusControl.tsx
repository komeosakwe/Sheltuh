"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import EventArt from "@/components/EventArt";
import { Button } from "@/components/ui/Button";
import type { EventPoster, ImageFocus } from "@/lib/types";

const STEP = 5;
const CENTRE = 50;

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/**
 * Where the photo's subject is, set on the photo itself: tap or drag the marker, or use the arrow
 * keys (5% a step; Home puts it back in the middle). Cropped renderings of the photo (map pins, cards)
 * keep that point in view; the two previews beside it show the result live. `focus` null is the
 * middle. One slider (its value text gives both axes), as a 2D control has no ARIA role of its own.
 */
export default function EventFocusControl({
  imageUrl,
  focus,
  onChange,
  poster,
  title,
}: {
  /** The photo as it'd show (an object URL). */
  imageUrl: string;
  focus: ImageFocus | null;
  onChange: (focus: ImageFocus | null) => void;
  poster: EventPoster;
  title: string;
}) {
  const x = focus?.x ?? CENTRE;
  const y = focus?.y ?? CENTRE;

  function place(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    onChange({ x: clamp(((e.clientX - rect.left) / rect.width) * 100), y: clamp(((e.clientY - rect.top) / rect.height) * 100) });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-STEP, 0],
      ArrowRight: [STEP, 0],
      ArrowUp: [0, -STEP],
      ArrowDown: [0, STEP],
    };
    if (e.key === "Home") {
      e.preventDefault();
      onChange(null);
    } else if (move[e.key]) {
      e.preventDefault();
      onChange({ x: clamp(x + move[e.key][0]), y: clamp(y + move[e.key][1]) });
    }
  }

  return (
    <div data-focus-control="" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p id="event-focus-label" className="eyebrow text-muted">
          Focus
        </p>
        <p id="event-focus-hint" className="text-xs text-muted">
          Tap the main subject
        </p>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div
          role="slider"
          tabIndex={0}
          aria-labelledby="event-focus-label"
          aria-describedby="event-focus-hint"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={x}
          aria-valuetext={`${x}% across, ${y}% down`}
          data-focus-area=""
          onKeyDown={handleKeyDown}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            e.currentTarget.focus();
            place(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) place(e);
          }}
          className="relative inline-block max-w-full cursor-crosshair touch-none self-start rounded-control focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-foreground"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- an object URL of the chosen photo */}
          <img src={imageUrl} alt="" draggable={false} className="block max-h-64 max-w-full rounded-control select-none" />
          <span
            aria-hidden="true"
            data-focus-marker=""
            style={{ left: `${x}%`, top: `${y}%` }}
            className="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgb(0_0_0/0.7)]"
          />
        </div>
        <div className="flex items-end gap-4">
          <div className="flex flex-col gap-1">
            <EventArt poster={poster} imageUrl={imageUrl} imageFocus={focus} title={title} className="size-12 rounded-dot" />
            <span className="text-xs text-muted">Pin</span>
          </div>
          <div className="flex flex-col gap-1">
            <EventArt poster={poster} imageUrl={imageUrl} imageFocus={focus} title={title} className="aspect-[4/3] w-32 rounded-control" />
            <span className="text-xs text-muted">Card</span>
          </div>
        </div>
      </div>
      {focus && (
        <Button variant="outline" size="sm" className="min-h-11 self-start" onClick={() => onChange(null)}>
          Centre
        </Button>
      )}
    </div>
  );
}
