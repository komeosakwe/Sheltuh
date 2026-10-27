"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { VenuePinMapLeafletProps } from "@/components/dashboard/VenuePinMapLeaflet";
import { useLocationModule } from "@/components/search/useLocationModule";
import { Button } from "@/components/ui/Button";
import { useIsPhone } from "@/components/ui/useIsPhone";
import { clampToAustralia, panByPixels } from "@/lib/geo";
import { TILE_MAX_ZOOM } from "@/lib/map-tiles";
import { placeName } from "@/lib/place";
import type { Coordinates } from "@/lib/types";

/** The furthest out: a state, for when the suburb was wrong. */
export const PIN_MIN_ZOOM = 5;
/** The furthest in: the basemap's own limit (lib/map-tiles.ts). */
export const PIN_MAX_ZOOM = TILE_MAX_ZOOM;
/** Opened on the organiser's own pin: street level. */
export const PIN_ZOOM_EXACT = PIN_MAX_ZOOM;
/** Opened on a suburb's centre: the neighbourhood, to find the street. */
export const PIN_ZOOM_SUBURB = 14;
/** Street level: from a suburb's centre, zoomed in this far (or moved), the pin can be confirmed. */
export const PIN_ZOOM_STREET = 15;

/** Said when the pin is confirmed at a suburb's centre, unmoved: the centre is rarely the venue. */
export const MOVE_PIN_FIRST = "Move the map so the pin is on the venue first.";

/** An arrow key moves the map this far (Leaflet's own keyboard step); with Shift, three times as far. */
export const PAN_STEP_PX = 80;
const PAN_STEP_LARGE_PX = PAN_STEP_PX * 3;

const INSTRUCTIONS =
  "Move the map until the pin is on the venue’s entrance. Drag it, or select the map and use the arrow keys. Zoom with the + and − buttons or keys.";

interface View {
  centre: Coordinates;
  zoom: number;
}

/** To 6 decimal places (about 10 cm), as the event's pin is stored. */
export function roundPin(pin: Coordinates): Coordinates {
  return { lat: Number(pin.lat.toFixed(6)), lng: Number(pin.lng.toFixed(6)) };
}

function samePoint(a: Coordinates, b: Coordinates): boolean {
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;
}

function clampZoom(zoom: number): number {
  return Math.min(PIN_MAX_ZOOM, Math.max(PIN_MIN_ZOOM, Math.round(zoom)));
}

/** If Leaflet's chunk can't load: the same box, saying so. */
function MapUnavailable() {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center">
      <p className="text-sm text-muted">The map couldn&rsquo;t load. Check your connection and try again.</p>
    </div>
  );
}

function MapLoading() {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center">
      <p className="text-sm text-muted">Loading the map…</p>
    </div>
  );
}

// Leaflet and react-leaflet only in the browser, and only when the picker is on screen.
const VenuePinMapLeaflet = dynamic<VenuePinMapLeafletProps>(
  () => import("@/components/dashboard/VenuePinMapLeaflet").catch(() => MapUnavailable),
  { ssr: false, loading: MapLoading },
);

/**
 * The suburb nearest the pin, from the Australia-wide suburb table (loaded
 * on demand, lib/location-loader.ts): a check that the pin is in the right
 * place, never a correction. `live` announces each change (the map being
 * moved); the phone summary isn't live, as it changes only on Done.
 */
function NearestSuburb({ pin, live }: { pin: Coordinates; live: boolean }) {
  const table = useLocationModule();
  const nearest = useMemo(() => table.module?.nearestLocality(pin) ?? null, [table.module, pin]);
  let text: string;
  if (nearest?.kind === "found") text = `Nearest suburb: ${placeName(nearest.locality.name, nearest.locality.state)}`;
  else if (nearest) text = "The pin isn’t in an Australian suburb. Move it onto the venue.";
  else if (table.failed) text = "The suburb list couldn’t load, so the nearest suburb can’t be shown.";
  else text = "Finding the nearest suburb…";

  return (
    <div className="flex flex-wrap items-center gap-x-3">
      <p data-nearest-suburb="" role={live ? "status" : undefined} className="text-sm leading-5">
        {text}
      </p>
      {table.failed && (
        <button
          type="button"
          onClick={table.retry}
          className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
        >
          Try again
        </button>
      )}
    </div>
  );
}

const ZOOM_BUTTON_CLASS =
  "flex size-11 items-center justify-center rounded-control border border-foreground bg-card text-xl leading-none hover:bg-surface aria-disabled:border-surface-border aria-disabled:text-muted";

/**
 * The map itself: the basemap under a pin fixed at its centre, a keyboard
 * alternative to dragging on the map (arrow keys move it, + and − zoom, as
 * Leaflet's own keys would), and zoom buttons for touch and pointer.
 */
function PinPicker({
  view,
  onMove,
  wheelZoom,
  instructionsId,
  framed,
  className,
}: {
  view: View;
  onMove: (next: View) => void;
  wheelZoom: boolean;
  instructionsId: string;
  /** Inline: a bordered, rounded box. In the dialog: edge to edge. */
  framed: boolean;
  className: string;
}) {
  const atMax = view.zoom >= PIN_MAX_ZOOM;
  const atMin = view.zoom <= PIN_MIN_ZOOM;

  function zoomBy(step: number) {
    const zoom = clampZoom(view.zoom + step);
    if (zoom !== view.zoom) onMove({ centre: view.centre, zoom });
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? PAN_STEP_LARGE_PX : PAN_STEP_PX;
    const pans: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const pan = Object.hasOwn(pans, event.key) ? pans[event.key] : null;
    if (pan) {
      event.preventDefault();
      onMove({ centre: clampToAustralia(panByPixels(view.centre, view.zoom, pan[0], pan[1])), zoom: view.zoom });
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomBy(-1);
    }
  }

  function handleMapMove(centre: Coordinates, zoom: number) {
    const next = { centre: clampToAustralia(centre), zoom: clampZoom(zoom) };
    if (samePoint(next.centre, view.centre) && next.zoom === view.zoom) return;
    onMove(next);
  }

  return (
    <div className={`relative ${className}`}>
      <div
        role="application"
        aria-roledescription="map"
        aria-label="Venue pin"
        aria-describedby={instructionsId}
        tabIndex={0}
        onKeyDown={handleKey}
        data-pin-map=""
        data-lat={view.centre.lat}
        data-lng={view.centre.lng}
        data-zoom={view.zoom}
        data-surface="paper"
        // Edge to edge in the dialog: the focus ring goes inside, or it would be off screen.
        className={`relative isolate h-full w-full overflow-hidden bg-surface ${
          framed ? "rounded-card border border-surface-border" : "-outline-offset-4"
        }`}
      >
        <VenuePinMapLeaflet
          centre={view.centre}
          zoom={view.zoom}
          minZoom={PIN_MIN_ZOOM}
          maxZoom={PIN_MAX_ZOOM}
          onMove={handleMapMove}
          wheelZoom={wheelZoom}
        />
        {/* The pin, fixed: its tip is the map's centre, the spot that's saved. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 z-[1100] -translate-x-1/2 -translate-y-full text-foreground"
        >
          <svg viewBox="0 0 32 40" className="h-10 w-8 drop-shadow">
            <path
              d="M16 39C16 39 3 24.6 3 15a13 13 0 0 1 26 0c0 9.6-13 24-13 24z"
              className="fill-current stroke-card"
              strokeWidth="2"
            />
            <circle cx="16" cy="15" r="5" className="fill-card" />
          </svg>
        </div>
      </div>
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-2">
        <button
          type="button"
          aria-label="Zoom in"
          aria-disabled={atMax}
          onClick={() => zoomBy(1)}
          className={ZOOM_BUTTON_CLASS}
        >
          <span aria-hidden="true">+</span>
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          aria-disabled={atMin}
          onClick={() => zoomBy(-1)}
          className={ZOOM_BUTTON_CLASS}
        >
          <span aria-hidden="true">−</span>
        </button>
      </div>
    </div>
  );
}

export interface VenuePinMapProps {
  /**
   * Where the map opens: the organiser's pin if there is one, otherwise
   * their suburb's centre from the ABS table. Never Google's coordinates
   * (owner decision A-D1). Read once: give the picker a new `key` to start
   * again somewhere else. Outside Australia, it's moved to the nearest edge.
   */
  initialCentre: Coordinates;
  /**
   * True when the pin is the organiser's own (confirmed): opened on it, the
   * map starts at street level, and Done takes it as it is.
   */
  pinned?: boolean;
  /** The suburb the organiser gave, for the heading ("Fitzroy, VIC"). */
  suburbLabel: string;
  /**
   * The pin, inside Australia and to 6 decimal places. Inline (from `sm`),
   * each time the map settles somewhere new. On phones, once, on Done:
   * Done confirms the pin (from a suburb's centre, only once the map has
   * been moved or zoomed in to street level; `pinned`, as it is).
   */
  onChange: (pin: Coordinates) => void;
  /** On phones: the dialog was closed without Done (Cancel or Escape). */
  onCancel?: () => void;
  /** Inline: the map was zoomed (to this level). */
  onZoom?: (zoom: number) => void;
}

/**
 * "Check the pin" (owner decision A-D1, 27 Oct 2026): the organiser puts the
 * venue under a pin fixed at the centre of our own map (Leaflet over the
 * /map basemap), and that position is the event's pin. Google's coordinates
 * are never used.
 *
 * From `sm` it's inline, about 320px tall, and the wheel scrolls the page,
 * not the map (zoom with the buttons, keys, double-click or pinch). On
 * phones it's a button that opens the map full screen in a dialog, so
 * dragging the map never traps the page's scrolling. Cancel leaves the pin
 * as it was; Done saves it.
 *
 * A keyboard alternative to dragging, with its instructions on show: arrow
 * keys move the map (Shift for further), + and − zoom. A live line names the
 * suburb nearest the pin. The map can't be moved outside Australia
 * (lib/geo.ts AUSTRALIA_BOUNDS).
 */
export default function VenuePinMap({
  initialCentre,
  pinned = false,
  suburbLabel,
  onChange,
  onCancel,
  onZoom,
}: VenuePinMapProps) {
  const phone = useIsPhone();
  // Where it opened: without a pin yet, Done needs the map moved from here (or zoomed to street level).
  const [seed] = useState(() => clampToAustralia(initialCentre));
  const [view, setView] = useState<View>(() => ({
    centre: seed,
    zoom: pinned ? PIN_ZOOM_EXACT : PIN_ZOOM_SUBURB,
  }));
  // The phone dialog's map while it's open (null when closed): saved to `view` on Done.
  const [draft, setDraft] = useState<View | null>(null);
  // Done was pressed with the map still at the suburb's centre.
  const [nudge, setNudge] = useState(false);
  const statusId = useId();
  const instructionsId = useId();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const open = phone && draft !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      titleRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      openerRef.current?.focus();
    }
  }, [open]);

  function moveInline(next: View) {
    const moved = !samePoint(next.centre, view.centre);
    setView(next);
    if (moved) onChange(roundPin(next.centre));
    if (next.zoom !== view.zoom) onZoom?.(next.zoom);
  }

  /** The dialog's map is somewhere the organiser put it: moved from where it opened, or zoomed in to the street. */
  function placed(next: View): boolean {
    return pinned || !samePoint(next.centre, seed) || next.zoom >= PIN_ZOOM_STREET;
  }

  function done() {
    if (!draft) return;
    if (!placed(draft)) {
      setNudge(true);
      return;
    }
    setNudge(false);
    setView(draft);
    setDraft(null);
    onChange(roundPin(draft.centre));
  }

  function cancel() {
    setDraft(null);
    setNudge(false);
    onCancel?.();
  }

  const heading = suburbLabel.trim() ? `Check the pin: ${suburbLabel.trim()}` : "Check the pin";

  if (!phone) {
    return (
      <div data-venue-pin="" className="flex flex-col gap-2">
        <p id={instructionsId} className="text-sm leading-5 text-muted">
          {INSTRUCTIONS}
        </p>
        <PinPicker
          view={view}
          onMove={moveInline}
          wheelZoom={false}
          instructionsId={instructionsId}
          framed
          className="h-80"
        />
        <NearestSuburb pin={view.centre} live />
      </div>
    );
  }

  return (
    <div data-venue-pin="" className="flex flex-col gap-2">
      <NearestSuburb pin={view.centre} live={false} />
      <Button
        ref={openerRef}
        variant="outline"
        size="lg"
        aria-haspopup="dialog"
        onClick={() => setDraft(view)}
        className="self-start"
      >
        Check the pin
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={instructionsId}
        onCancel={(event) => {
          // Escape: closed through state, as Cancel, so focus goes back to the button.
          event.preventDefault();
          cancel();
        }}
        onClose={() => {
          // Closed by the browser regardless (Chrome closes on a second Escape even when cancel is
          // prevented): treat it as Cancel, so the state matches and the button opens it again.
          if (draft) cancel();
        }}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-ink/50"
      >
        {draft && (
          <div className="flex h-full flex-col">
            <div className="flex flex-col gap-1 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-3">
              <h2 ref={titleRef} id={titleId} tabIndex={-1} className="font-heading text-xl leading-6 break-words outline-offset-2">
                {heading}
              </h2>
              <p id={instructionsId} className="text-sm leading-5 text-muted">
                {INSTRUCTIONS}
              </p>
            </div>
            <PinPicker
              view={draft}
              onMove={setDraft}
              wheelZoom
              instructionsId={instructionsId}
              framed={false}
              className="min-h-0 flex-1"
            />
            <div className="flex flex-col gap-3 border-t border-surface-border px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <NearestSuburb pin={draft.centre} live />
              <p id={statusId} aria-live="polite" className="text-sm leading-5 text-danger empty:sr-only">
                {nudge && !placed(draft) ? MOVE_PIN_FIRST : ""}
              </p>
              <div className="flex gap-3">
                <Button variant="outline" size="lg" onClick={cancel} className="flex-1">
                  Cancel
                </Button>
                <Button size="lg" onClick={done} aria-describedby={statusId} className="flex-1">
                  Done
                </Button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
