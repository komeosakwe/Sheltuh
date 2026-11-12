"use client";

import { useRef, useState, type FocusEvent } from "react";
import {
  LOCATION_CARD_CLASS,
  LocationCardAction,
  LocationCardClose,
  LocationCardIcon,
  LocationCardText,
} from "./LocationCard";
import type { MapLocateStatus } from "./useMapLocate";

interface NearMeButtonProps {
  onLocate: () => void;
  locating: boolean;
  /** A brief answer to the last try: a failure shows as the location card; a success is only announced. */
  status: MapLocateStatus;
  /** The card's ✕. */
  onDismiss: () => void;
  /** Focus is in the card (true) or has left it (false): it doesn't go by itself meanwhile. */
  onHold: (hold: boolean) => void;
  /** The card now says something new (the steps after "Open in Safari"): its time starts again. */
  onExtend: () => void;
  /** Where it sits: phones, the map's lower-left corner; from lg, under the zoom buttons. */
  className?: string;
}

/**
 * "Near me" and its location card (the proposal's Nearby), over the map: centres the map on the
 * visitor's location, for someone who said no at first or has moved. A 40px control in a 44px target; busy
 * (still focusable) while it finds them. Above it, when that fails, a card asks to share the location and
 * says how (lib/in-app-browser.ts locationPrompt). The card's words are a status that's always
 * mounted, so each change is announced; the card never takes focus, its ✕ closes it (focus goes back
 * to Near me), and it stays while focus is in it.
 */
export default function NearMeButton({
  onLocate,
  locating,
  status,
  onDismiss,
  onHold,
  onExtend,
  className = "",
}: NearMeButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The steps shown after "Open in Safari", for this message only (a new one starts afresh).
  const [steps, setSteps] = useState<{ id: number; steps: "copied" | "steps" } | null>(null);
  const shown = status?.tone === "danger" ? status : null;
  const shownSteps = shown && steps?.id === shown.id ? steps.steps : null;

  function dismiss() {
    onDismiss();
    buttonRef.current?.focus();
  }

  function leave(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) onHold(false);
  }

  return (
    <div
      data-near-me=""
      className={`pointer-events-none absolute right-2.5 left-2.5 z-10 flex flex-col items-start ${className}`}
    >
      <div
        data-location-card={shown ? "" : undefined}
        className={shown ? LOCATION_CARD_CLASS : "sr-only"}
        onFocus={() => onHold(true)}
        onBlur={leave}
      >
        {shown && <LocationCardIcon />}
        <p role="status">
          {shown ? <LocationCardText text={shown.text} prompt={shown.prompt} steps={shownSteps} /> : (status?.text ?? "")}
        </p>
        {shown && (
          <LocationCardAction
            prompt={shown.prompt}
            onSteps={(next) => {
              setSteps({ id: shown.id, steps: next });
              onExtend();
            }}
          />
        )}
        {shown && <LocationCardClose onDismiss={dismiss} />}
      </div>
      {/* The proposal's 40px control (radius 8, the 1.5px stroke, no shadow) inside a 44px target (the
          2px above and below are the button's own, transparent). Busy (still focusable,
          aria-disabled, presses ignored) while it looks. */}
      <button
        ref={buttonRef}
        type="button"
        onClick={locating ? undefined : onLocate}
        aria-disabled={locating || undefined}
        aria-busy={locating}
        className="group pointer-events-auto flex min-h-11 items-center"
      >
        <span className="inline-flex h-10 items-center gap-2 rounded-control border-control border-foreground bg-background px-3 text-sm leading-5 font-semibold text-foreground group-hover:bg-hover group-aria-disabled:text-muted">
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
            <circle cx="12" cy="12" r="5" />
            <path d="M12 2.5v4.5M12 17v4.5M2.5 12H7M17 12h4.5" />
          </svg>
          {locating ? "Locating…" : "Near me"}
        </span>
      </button>
    </div>
  );
}
