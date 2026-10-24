"use client";

import { useId } from "react";
import type { TileStyle, TileStyleId } from "@/lib/map-tiles";

interface MapStylePreviewProps {
  styles: TileStyle[];
  value: TileStyleId;
  onChange: (id: TileStyleId) => void;
  /** Includes the display (flex by default), so a caller can hide it at some widths. */
  className?: string;
}

/**
 * The "Map style (preview)" picker on /map, shown only when a Mapbox token is
 * configured (docs/mapbox-preview.md): a labelled native select, so it's
 * keyboard- and screen-reader-operable as is, 44px tall at every width.
 */
export default function MapStylePreview({ styles, value, onChange, className = "flex" }: MapStylePreviewProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={`flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <label htmlFor={id} className="text-sm leading-5 font-semibold text-foreground">
        Map style (preview)
      </label>
      <select
        id={id}
        value={value}
        aria-describedby={hintId}
        onChange={(event) => {
          const next = styles.find((style) => style.id === event.target.value);
          if (next) onChange(next.id);
        }}
        className="min-h-11 max-w-full min-w-0 px-3 text-base text-foreground focus-visible:outline-offset-0 sm:text-sm"
      >
        {styles.map((style) => (
          <option key={style.id} value={style.id}>
            {style.label}
          </option>
        ))}
      </select>
      <p id={hintId} className="w-full text-xs leading-4 text-muted">
        Comparing map providers. Your choice is remembered on this device.
      </p>
    </div>
  );
}
