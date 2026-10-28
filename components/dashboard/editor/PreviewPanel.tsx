"use client";

import { useState, useSyncExternalStore } from "react";
import SeatDialog from "@/components/seating/SeatDialog";
import { Button } from "@/components/ui/Button";
import type { SheltuhEvent } from "@/lib/types";
import PreviewFrame from "./PreviewFrame";
import type { PreviewMissing } from "./preview-event";

/** Tailwind's `xl` (1280px) and up: the preview is a panel beside the form. */
const XL_QUERY = "(min-width: 80rem)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(XL_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const getSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia(XL_QUERY).matches;

/** True from 1280px: where the preview is a panel. It's mounted in one place only, so a hidden copy never runs. */
function useIsXl(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

interface PreviewProps {
  event: SheltuhEvent;
  missing: PreviewMissing;
}

/**
 * The preview beside the form (docs/design/event-editor.md §5.10), from 1280px: a 320px phone in a framed
 * column, sticky under the header, with Hide / Show (one button, so focus stays on it). The choice is per visit. Hidden, only the Show button
 * remains. Below 1280px the same preview is in a sheet (PreviewButton).
 */
export function PreviewPanel({ event, missing }: PreviewProps) {
  const xl = useIsXl();
  const [shownPanel, setShownPanel] = useState(true);
  if (!xl) return null;

  return (
    <aside
      aria-label="Event page preview"
      id="event-preview"
      className={`hidden xl:sticky xl:top-24 xl:block xl:shrink-0 ${shownPanel ? "xl:w-88" : ""}`}
    >
      <div className="flex items-center justify-between gap-3 pb-3">
        {shownPanel && <p className="eyebrow text-muted">Preview</p>}
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          aria-controls={shownPanel ? "event-preview-frame" : undefined}
          onClick={() => setShownPanel(!shownPanel)}
        >
          {shownPanel ? "Hide preview" : "Show preview"}
        </Button>
      </div>
      {shownPanel && (
        <>
          <p className="meta pb-3 text-muted">Phone, 320px wide. Not clickable.</p>
          <div
            id="event-preview-frame"
            // A picture of the event page, not a second copy of it to read: the caption says what it is.
            aria-hidden="true"
            className="flex justify-center overflow-hidden rounded-card border border-foreground bg-surface"
          >
            <PreviewFrame
              event={event}
              missing={missing}
              className="h-[calc(100dvh-17rem)] max-h-[48rem] min-h-[20rem] w-80 bg-background"
            />
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * Below 1280px: a "Preview" button that opens the same preview in a sheet (a bottom sheet on phones, centred from 640px),
 * a phone-width frame at most 384px wide. Its content is mounted only while it's open, so it always shows the current draft.
 */
export function PreviewButton({ event, missing }: PreviewProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 xl:hidden"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Preview
      </Button>
      <SeatDialog open={open} title="Preview" onClose={() => setOpen(false)}>
        <p className="meta text-muted">Not clickable. Closing this brings you back to your form.</p>
        <div aria-hidden="true" className="overflow-hidden rounded-card border border-foreground bg-surface">
          <PreviewFrame
            event={event}
            missing={missing}
            className="mx-auto h-[calc(90dvh-12rem)] min-h-[20rem] w-full max-w-sm bg-background"
          />
        </div>
      </SeatDialog>
    </>
  );
}
