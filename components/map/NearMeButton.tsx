"use client";

import { Button } from "@/components/ui/Button";
import type { MapLocateStatus } from "./useMapLocate";

interface NearMeButtonProps {
  onLocate: () => void;
  locating: boolean;
  /** A brief answer to the last try: a failure shows; a success is only announced. */
  status: MapLocateStatus;
}

/**
 * "Near me" under the map's zoom buttons (top left): centres the map on the visitor's location, for
 * someone who said no at first or has moved. A 44px button; busy (still focusable) while it
 * finds them. The status is always mounted, so its changes are announced.
 */
export default function NearMeButton({ onLocate, locating, status }: NearMeButtonProps) {
  return (
    <div data-near-me="" className="pointer-events-none absolute top-29 left-2.5 z-10 flex max-w-64 flex-col items-start gap-2">
      <p
        role="status"
        className={
          status?.tone === "danger"
            ? "pointer-events-auto rounded-control border border-foreground bg-card px-3 py-2 text-sm leading-5 text-danger"
            : "sr-only"
        }
      >
        {status?.text ?? ""}
        {status?.link && (
          <a href={status.link.href} className="mt-1 flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4">
            {status.link.label}
          </a>
        )}
      </p>
      <Button variant="outline" onClick={onLocate} busy={locating} aria-busy={locating} className="pointer-events-auto min-h-11 gap-2 bg-card">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4 shrink-0"
        >
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
        </svg>
        {locating ? "Locating…" : "Near me"}
      </Button>
    </div>
  );
}
