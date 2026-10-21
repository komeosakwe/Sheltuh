"use client";

import { memo, useEffect, useId, useMemo, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { getTicketBuyerTotalCents } from "@/lib/pricing";
import { formatAud } from "@/lib/format";
import { formatSeatLine } from "@/lib/seating/format";
import { seatBounds, type Bounds, type SeatTreatment } from "@/lib/seating/selection";
import { SEAT_SIZE, type FlatSeat, type SeatMapSection, type SeatMapTemplate } from "@/lib/seating/template";
import type { TicketType } from "@/lib/types";
import SeatGlyph, { type EditorSeatMarks, type PatternIds, type SeatState } from "./SeatGlyph";
import SectionChips from "./SectionChips";
import { useMapView, type MapView } from "./useMapView";
import ZoomControls from "./ZoomControls";

/** What the seat page can ask of the map from its own handlers (Find seats, section jumps, the skip link). */
export interface SeatMapControl {
  fitBounds: (bounds: Bounds, ms?: number) => void;
  fitAll: () => void;
}

const FINE_POINTER = "(pointer: fine)";
function subscribePointer(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(FINE_POINTER);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}
const finePointerSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia(FINE_POINTER).matches;

/** Seat size bucket (§5.3 thresholds), so the seat layer only redraws when what's shown changes. */
function sizeBucket(seatPx: number): number {
  if (seatPx < 12) return 0;
  if (seatPx < 24) return 1;
  if (seatPx < 32) return 2;
  if (seatPx < 40) return 3;
  return 4;
}

interface SeatLayerProps {
  seats: FlatSeat[];
  stateOf: (seat: FlatSeat) => SeatState;
  treatments: Map<string, SeatTreatment>;
  patterns: PatternIds;
  bucket: number;
  /** The view scale when seat numbers show (they're sized by it), else 1. */
  textScale: number;
  editorMarks?: (seat: FlatSeat) => EditorSeatMarks | undefined;
}

const BUCKET_PX = [8, 16, 28, 36, 44];

/** Every seat, redrawn only when states, size bucket or (with numbers showing) the scale change. */
const SeatLayer = memo(function SeatLayer({ seats, stateOf, treatments, patterns, bucket, textScale, editorMarks }: SeatLayerProps) {
  return (
    <g>
      {seats.map((seat) => (
        <SeatGlyph
          key={seat.id}
          id={seat.id}
          x={seat.x}
          y={seat.y}
          rotation={seat.rotation}
          state={stateOf(seat)}
          treatment={treatments.get(seat.ticketTypeId) ?? "outline"}
          kind={seat.kind}
          label={seat.seat}
          seatPx={BUCKET_PX[bucket]}
          scale={textScale}
          patterns={patterns}
          editor={editorMarks?.(seat)}
        />
      ))}
    </g>
  );
});

/**
 * How a section's name sits on its anchor: beside the seats when the anchor
 * is clear of them to the right ("start", reading away from them) or left
 * ("end"), else centred (above or below them, or over them).
 */
function sectionLabelAnchor(section: SeatMapSection): "start" | "middle" | "end" {
  let min = Infinity;
  let max = -Infinity;
  for (const row of section.rows) {
    for (const seat of row.seats) {
      min = Math.min(min, seat.x);
      max = Math.max(max, seat.x);
    }
  }
  if (section.labelAnchor.x > max + SEAT_SIZE / 2) return "start";
  if (section.labelAnchor.x < min - SEAT_SIZE / 2) return "end";
  return "middle";
}

/** Stage, section names and row labels (§5.3 Labels), sized to stay 12px on screen. */
export function MapLabels({ template, scale, seatPx }: { template: SeatMapTemplate; scale: number; seatPx: number }) {
  const font = 12 / scale;
  const stage = template.stage;
  return (
    <g aria-hidden="true">
      {stage &&
        (stage.shape === "ellipse" ? (
          <ellipse
            cx={stage.x + stage.width / 2}
            cy={stage.y + stage.height / 2}
            rx={stage.width / 2}
            ry={stage.height / 2}
            className="fill-foreground"
          />
        ) : (
          <rect x={stage.x} y={stage.y} width={stage.width} height={stage.height} rx="8" className="fill-foreground" />
        ))}
      {stage && stage.label && (
        <text
          x={stage.x + stage.width / 2}
          y={stage.y + stage.height / 2}
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={font}
          className="fill-background font-mono font-medium uppercase"
          letterSpacing="0.04em"
        >
          {stage.label}
        </text>
      )}
      {template.sections.map((section) => (
        <text
          key={section.id}
          x={section.labelAnchor.x}
          y={section.labelAnchor.y}
          dominantBaseline="central"
          textAnchor={sectionLabelAnchor(section)}
          fontSize={font}
          className="fill-foreground font-mono font-medium uppercase"
          letterSpacing="0.04em"
        >
          {section.label}
        </text>
      ))}
      {seatPx >= 12 &&
        template.sections.flatMap((section) =>
          section.rows
            .filter((row) => row.label)
            .flatMap((row) => {
              const [a, b] = row.ends;
              const len = Math.hypot(b.x - a.x, b.y - a.y);
              const dx = len > 0 ? (b.x - a.x) / len : 1;
              const dy = len > 0 ? (b.y - a.y) / len : 0;
              const out = SEAT_SIZE / 2 + 8 / scale + font / 2;
              const ends = len > 0 ? [{ x: a.x - dx * out, y: a.y - dy * out }, { x: b.x + dx * out, y: b.y + dy * out }] : [{ x: a.x - out, y: a.y }];
              return ends.map((point, i) => (
                <text
                  key={`${section.id}-${row.label}-${i}`}
                  x={point.x}
                  y={point.y}
                  dominantBaseline="central"
                  textAnchor="middle"
                  fontSize={font}
                  className="fill-muted font-mono uppercase"
                >
                  {row.label}
                </text>
              ));
            }),
        )}
    </g>
  );
}

export interface SeatMapProps {
  template: SeatMapTemplate;
  seats: FlatSeat[];
  venueName: string;
  isUnavailable: (seat: FlatSeat) => boolean;
  selected: ReadonlySet<string>;
  treatments: Map<string, SeatTreatment>;
  tierById: Map<string, TicketType>;
  patterns: PatternIds;
  /** False: look only (sales ended, nothing to choose). */
  interactive: boolean;
  onSeat: (seat: FlatSeat) => void;
  /** A section chip was pressed: the page announces it. */
  onSectionShown: (label: string, available: number) => void;
  controlRef?: RefObject<SeatMapControl | null>;
  /** Extra overlay (e.g. the skip link's target). */
  children?: ReactNode;
}

function ViewGroup({ view, animateMs, children }: { view: MapView; animateMs: number; children: ReactNode }) {
  const style = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transformOrigin: "0 0",
    "--seat-map-ms": `${animateMs}ms`,
  } as CSSProperties;
  return (
    <g className={animateMs > 0 ? "seat-map-view" : undefined} style={style} data-scale={view.scale.toFixed(3)}>
      {children}
    </g>
  );
}

/**
 * The buyer's seat map (docs/design/seating.md §5.3): one SVG, panned and
 * zoomed (useMapView), seats drawn by SeatGlyph, section chips, zoom
 * buttons, a hover tooltip for fine pointers and the overview hint. Seats
 * aren't focusable: the canvas is one focusable, keyboard-pannable image,
 * and the List tab is the accessible way to choose (§7).
 */
export default function SeatMap({
  template,
  seats,
  venueName,
  isUnavailable,
  selected,
  treatments,
  tierById,
  patterns,
  interactive,
  onSeat,
  onSectionShown,
  controlRef,
  children,
}: SeatMapProps) {
  const {
    setContainer,
    view,
    seatPx,
    size,
    animateMs,
    minScale,
    maxScale,
    zoomBy,
    zoomToSeatPx,
    fitBounds,
    fitAll,
    pointerHandlers,
    wasDrag,
    lastPointerType,
    onKeyDown,
  } = useMapView(template);
  const hintId = useId();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const finePointer = useSyncExternalStore(subscribePointer, finePointerSnapshot, () => false);

  // The page's handle on the map (Find seats, section jumps).
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = { fitBounds: (bounds, ms) => fitBounds(bounds, true, ms), fitAll: () => fitAll(true) };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef, fitBounds, fitAll]);

  const byId = useMemo(() => new Map(seats.map((seat) => [seat.id, seat])), [seats]);
  const available = useMemo(() => seats.filter((seat) => !isUnavailable(seat)).length, [seats, isUnavailable]);
  const stateOf = useMemo(
    () => (seat: FlatSeat): SeatState => (selected.has(seat.id) ? "selected" : isUnavailable(seat) ? "unavailable" : "available"),
    [selected, isUnavailable],
  );

  function seatAt(target: EventTarget | null): FlatSeat | undefined {
    const element = target instanceof Element ? target.closest("[data-seat]") : null;
    const id = element?.getAttribute("data-seat");
    return id ? byId.get(id) : undefined;
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (wasDrag()) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const pointer = lastPointerType() || "mouse";
    const seat = seatAt(event.target);
    // Overview: a tap only zooms in (§5.3). Small seats: touch zooms, a mouse chooses.
    if (seatPx < 12 || (seatPx < 24 && pointer !== "mouse")) {
      zoomToSeatPx(32, point);
      return;
    }
    if (seat && interactive) onSeat(seat);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    pointerHandlers().onPointerMove(event);
    if (event.pointerType !== "mouse") return;
    const seat = seatAt(event.target);
    const id = seat?.id ?? null;
    if (id !== hovered) setHovered(id);
  }

  const gestures = pointerHandlers();
  const hoveredSeat = hovered ? byId.get(hovered) : undefined;
  const hoveredTier = hoveredSeat ? tierById.get(hoveredSeat.ticketTypeId) : undefined;
  const tooltip = hoveredSeat
    ? (() => {
        const sx = view.x + hoveredSeat.x * view.scale;
        const sy = view.y + hoveredSeat.y * view.scale;
        const half = (SEAT_SIZE / 2) * view.scale;
        const below = sy - half < 72;
        const price = hoveredTier
          ? `${hoveredTier.priceCents === 0 ? "Free" : `${formatAud(getTicketBuyerTotalCents(hoveredTier))} incl. booking fee`} · ${hoveredTier.name}`
          : "";
        return {
          style: {
            left: Math.min(Math.max(sx, 96), size.width - 96),
            top: below ? sy + half + 8 : sy - half - 8,
            transform: below ? "translateX(-50%)" : "translate(-50%, -100%)",
          } as CSSProperties,
          line: formatSeatLine(hoveredSeat),
          detail: isUnavailable(hoveredSeat) && !selected.has(hoveredSeat.id) ? "Unavailable" : price,
          wheelchair: hoveredSeat.kind === "wheelchair",
        };
      })()
    : null;

  const label = `Seat map of ${venueName}. ${available} ${available === 1 ? "seat" : "seats"} available. To choose seats with a keyboard or screen reader, use the List tab.`;
  const bucket = sizeBucket(seatPx);

  return (
    <div className="relative h-full min-h-60 w-full">
      <div
        ref={setContainer}
        tabIndex={0}
        role="group"
        aria-label="Seat map"
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onPointerDown={gestures.onPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={gestures.onPointerUp}
        onPointerCancel={gestures.onPointerCancel}
        onPointerLeave={() => setHovered(null)}
        onClick={handleClick}
        className="seat-map-canvas relative h-full w-full touch-none overflow-hidden bg-background select-none"
        data-seat-px={Math.round(seatPx)}
      >
        <svg role="img" aria-label={label} width="100%" height="100%" className="block">
          <ViewGroup view={view} animateMs={animateMs}>
            <MapLabels template={template} scale={view.scale} seatPx={seatPx} />
            <SeatLayer
              seats={seats}
              stateOf={stateOf}
              treatments={treatments}
              patterns={patterns}
              bucket={bucket}
              textScale={bucket >= 3 ? view.scale : 1}
            />
          </ViewGroup>
        </svg>
      </div>

      <SectionChips
        template={template}
        seats={seats}
        isUnavailable={isUnavailable}
        onShow={(section, count) => {
          const bounds = seatBounds(seats.filter((seat) => seat.sectionId === section.id));
          if (bounds) fitBounds(bounds);
          onSectionShown(section.label, count);
        }}
      />

      <ZoomControls
        scale={view.scale}
        minScale={minScale}
        maxScale={maxScale}
        onZoom={(factor) => zoomBy(factor)}
        onFit={() => fitAll()}
      />

      {seatPx < 24 && (
        <p className="meta pointer-events-none absolute bottom-3 left-3 bg-background px-2 py-1 text-foreground lg:bottom-4 lg:left-4">
          {finePointer ? "Click a seat to choose it" : "Tap a section to zoom in"}
        </p>
      )}

      <p
        id={hintId}
        className={
          focused
            ? // Under the section chips (h-11, from top-2) when there are any, so it never covers them.
              `meta pointer-events-none absolute left-1/2 -translate-x-1/2 border border-foreground bg-card px-2 py-1 text-foreground ${
                template.sections.length >= 2 ? "top-14" : "top-3"
              }`
            : "sr-only"
        }
      >
        Arrow keys move the map. + and &minus; zoom. 0 shows it all.
      </p>

      {tooltip && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 rounded-control border border-foreground bg-card px-3 py-2 whitespace-nowrap"
          style={tooltip.style}
        >
          <p className="text-sm font-semibold">{tooltip.line}</p>
          <p className="text-sm tabular-nums">{tooltip.detail}</p>
          {tooltip.wheelchair && <p className="text-sm">Wheelchair space</p>}
        </div>
      )}
      {children}
    </div>
  );
}
