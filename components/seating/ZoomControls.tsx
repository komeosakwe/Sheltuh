"use client";

import { ZOOM_STEP } from "./useMapView";

const buttonClass =
  "flex size-11 items-center justify-center rounded-control border border-foreground bg-card text-foreground hover:bg-surface aria-disabled:cursor-not-allowed aria-disabled:border-surface-border aria-disabled:text-muted aria-disabled:hover:bg-card";

/**
 * Zoom in, zoom out and show the whole map (docs/design/seating.md §5.7):
 * 44px buttons named by aria-label (and title for pointer users). At a limit
 * they're aria-disabled, so focus stays on them.
 */
export default function ZoomControls({
  scale,
  minScale,
  maxScale,
  onZoom,
  onFit,
}: {
  scale: number;
  minScale: number;
  maxScale: number;
  onZoom: (factor: number) => void;
  onFit: () => void;
}) {
  const atMax = scale >= maxScale - 1e-6;
  const atMin = scale <= minScale + 1e-6;
  return (
    <div className="absolute right-3 bottom-3 flex flex-col gap-2 lg:right-4 lg:bottom-4">
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        aria-disabled={atMax || undefined}
        onClick={() => !atMax && onZoom(ZOOM_STEP)}
        className={buttonClass}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M8 2v12M2 8h12" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        aria-disabled={atMin || undefined}
        onClick={() => !atMin && onZoom(1 / ZOOM_STEP)}
        className={buttonClass}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M2 8h12" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Show the whole map"
        title="Show the whole map"
        aria-disabled={atMin || undefined}
        onClick={() => !atMin && onFit()}
        className={buttonClass}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
        </svg>
      </button>
    </div>
  );
}
