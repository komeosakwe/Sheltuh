"use client";

import { useCallback, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { SNAP } from "@/lib/seating/editing";
import type { SeatTreatment } from "@/lib/seating/selection";
import { flattenSeats, type FlatSeat, type SeatMapSection, type SeatMapTemplate } from "@/lib/seating/template";
import { EmptyState } from "@/components/ui/Section";
import SeatGlyph, { type PatternIds } from "../SeatGlyph";
import { MapLabels } from "../SeatMap";
import { useMapView } from "../useMapView";
import ZoomControls from "../ZoomControls";

export type SelectMode = "replace" | "toggle" | "add";

type Drag =
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: "move"; startX: number; startY: number; dx: number; dy: number; moved: boolean; seatId: string; additive: boolean }
  | { kind: "focus"; x: number; y: number };

/**
 * The editor's canvas (docs/design/seating.md §5.13): the buyer's renderer on
 * the page background with a 32u grid. Click selects a seat, Shift+click adds or removes
 * it, dragging on empty space draws a marquee, dragging selected seats moves
 * them (snapped to 4u), and the focus point (the orange square) drags too.
 * Every drag has a non-drag alternative in the toolbar and inspector. The
 * wheel pans, Ctrl/⌘ + wheel zooms, and the canvas takes the map keys.
 */
export default function EditorCanvas({
  template,
  selected,
  invalid,
  ghost,
  treatments,
  patterns,
  readOnly,
  onSelect,
  onMove,
  onFocusPoint,
  canvasNode,
}: {
  template: SeatMapTemplate;
  selected: ReadonlySet<string>;
  invalid: ReadonlySet<string>;
  /** The generator's preview section (dashed, unfilled), if any. */
  ghost: SeatMapSection | null;
  treatments: Map<string, SeatTreatment>;
  patterns: PatternIds;
  readOnly: boolean;
  onSelect: (ids: string[], mode: SelectMode) => void;
  onMove: (dx: number, dy: number) => void;
  onFocusPoint: (point: { x: number; y: number }) => void;
  /** The focusable canvas, for the editor to return focus to (after the toolbar's Delete removes the toolbar). */
  canvasNode?: (node: HTMLDivElement | null) => void;
}) {
  const { setContainer, view, seatPx, animateMs, minScale, maxScale, zoomBy, fitAll, toMap, onKeyDown } = useMapView(template);
  const gridId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const seats = useMemo(() => flattenSeats(template), [template]);
  const ghostSeats = useMemo(() => (ghost ? flattenSeats({ ...template, sections: [ghost] }) : []), [ghost, template]);
  const [drag, setDrag] = useState<Drag | null>(null);
  // A stable ref callback: a new one each render would detach and reattach the node (and re-measure).
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      setContainer(node);
      canvasNode?.(node);
    },
    [setContainer, canvasNode],
  );
  const box = useRef<DOMRect | null>(null);

  function local(event: PointerEvent<HTMLDivElement>) {
    const rect = box.current ?? event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    box.current = event.currentTarget.getBoundingClientRect();
    const point = local(event);
    const target = event.target instanceof Element ? event.target : null;
    if (!readOnly && target?.closest("[data-focus-point]")) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({ kind: "focus", ...toMap(point.x, point.y) });
      return;
    }
    const seatId = target?.closest("[data-seat]")?.getAttribute("data-seat") ?? null;
    if (seatId) {
      if (!readOnly && selected.has(seatId) && !event.shiftKey) {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDrag({ kind: "move", startX: point.x, startY: point.y, dx: 0, dy: 0, moved: false, seatId, additive: false });
      } else {
        setDrag({ kind: "move", startX: point.x, startY: point.y, dx: 0, dy: 0, moved: false, seatId, additive: event.shiftKey });
      }
      return;
    }
    if (readOnly) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ kind: "marquee", x0: point.x, y0: point.y, x1: point.x, y1: point.y, additive: event.shiftKey });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const point = local(event);
    if (drag.kind === "marquee") setDrag({ ...drag, x1: point.x, y1: point.y });
    else if (drag.kind === "focus") setDrag({ kind: "focus", ...toMap(point.x, point.y) });
    else if (!readOnly && selected.has(drag.seatId) && !drag.additive) {
      const dx = (point.x - drag.startX) / view.scale;
      const dy = (point.y - drag.startY) / view.scale;
      const moved = drag.moved || Math.hypot(point.x - drag.startX, point.y - drag.startY) > 4;
      setDrag({ ...drag, dx: Math.round(dx / SNAP) * SNAP, dy: Math.round(dy / SNAP) * SNAP, moved });
    }
  }

  function onPointerUp() {
    const current = drag;
    setDrag(null);
    box.current = null;
    if (!current) return;
    if (current.kind === "focus") {
      onFocusPoint({ x: Math.round(current.x), y: Math.round(current.y) });
    } else if (current.kind === "move") {
      if (current.moved && (current.dx !== 0 || current.dy !== 0)) onMove(current.dx, current.dy);
      else if (!current.moved) onSelect([current.seatId], current.additive ? "toggle" : "replace");
    } else {
      const w = Math.abs(current.x1 - current.x0);
      const h = Math.abs(current.y1 - current.y0);
      if (w < 4 && h < 4) {
        if (!current.additive) onSelect([], "replace");
        return;
      }
      const a = toMap(Math.min(current.x0, current.x1), Math.min(current.y0, current.y1));
      const b = toMap(Math.max(current.x0, current.x1), Math.max(current.y0, current.y1));
      const inside = seats.filter((seat) => seat.x >= a.x && seat.x <= b.x && seat.y >= a.y && seat.y <= b.y).map((seat) => seat.id);
      onSelect(inside, current.additive ? "add" : "replace");
    }
  }

  const moving = drag?.kind === "move" && drag.moved ? drag : null;
  const focus = drag?.kind === "focus" ? { x: drag.x, y: drag.y } : template.focus;
  const style = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transformOrigin: "0 0",
    "--seat-map-ms": `${animateMs}ms`,
  } as CSSProperties;
  const marquee = drag?.kind === "marquee" ? drag : null;
  const focusSize = 20 / view.scale;

  const drawn = (seat: FlatSeat) => {
    const offset = moving && selected.has(seat.id) ? moving : null;
    return (
      <SeatGlyph
        key={seat.id}
        id={seat.id}
        x={seat.x + (offset?.dx ?? 0)}
        y={seat.y + (offset?.dy ?? 0)}
        rotation={seat.rotation}
        state="available"
        treatment={treatments.get(seat.ticketTypeId) ?? "outline"}
        kind={seat.kind}
        label={seat.seat}
        seatPx={seatPx}
        scale={view.scale}
        patterns={patterns}
        editor={{ selected: selected.has(seat.id), blocked: seat.blocked, invalid: invalid.has(seat.id) }}
      />
    );
  };

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        tabIndex={0}
        role="group"
        aria-label="Seat map canvas. Arrow keys move the map, + and − zoom, 0 shows it all. Choose seats with the Sections list and the inspector."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        className="relative h-full w-full touch-none overflow-hidden bg-background select-none"
      >
        <svg role="img" aria-label={`Seat map, ${seats.length} seats`} width="100%" height="100%" className="block">
          <defs>
            <pattern id={gridId} width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0H0V32" fill="none" strokeWidth="1" vectorEffect="non-scaling-stroke" className="stroke-surface-border" />
            </pattern>
          </defs>
          <g className={animateMs > 0 ? "seat-map-view" : undefined} style={style}>
            <rect width={template.width} height={template.height} fill={`url(#${gridId})`} aria-hidden="true" />
            <MapLabels template={template} scale={view.scale} seatPx={seatPx} />
            <g>{seats.map(drawn)}</g>
            {ghostSeats.map((seat) => (
              <SeatGlyph
                key={`ghost-${seat.id}`}
                id={seat.id}
                x={seat.x}
                y={seat.y}
                rotation={seat.rotation}
                state="available"
                treatment="outline"
                kind="standard"
                label=""
                seatPx={seatPx}
                scale={view.scale}
                patterns={patterns}
                ghost
              />
            ))}
            <g data-focus-point="" transform={`translate(${focus.x} ${focus.y})`} className={readOnly ? "" : "cursor-move"}>
              <rect x={-focusSize / 2} y={-focusSize / 2} width={focusSize} height={focusSize} rx={4 / view.scale} className="fill-signal" />
              <path
                d={`M${-focusSize / 2} 0H${focusSize / 2}M0 ${-focusSize / 2}V${focusSize / 2}`}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                className="stroke-foreground"
              />
            </g>
          </g>
        </svg>
        {marquee && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute border border-dashed border-foreground"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}
        {seats.length === 0 && !ghost && (
          <div className="pointer-events-none absolute inset-x-8 top-1/3">
            <EmptyState title="No seats yet">Start from a layout (Layouts, above), add a section on the left, or import a seat map.</EmptyState>
          </div>
        )}
      </div>
      <ZoomControls scale={view.scale} minScale={minScale} maxScale={maxScale} onZoom={(f) => zoomBy(f)} onFit={() => fitAll()} />
    </div>
  );
}
