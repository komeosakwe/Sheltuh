"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Bounds } from "@/lib/seating/selection";
import { SEAT_SIZE } from "@/lib/seating/template";

/** Screen = map × scale + (x, y), in CSS px. */
export interface MapView {
  scale: number;
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

/** Padding around the whole map when it's fitted (docs/design/seating.md §2.1). */
const FIT_PADDING = 16;
/** The largest a seat is drawn, in CSS px (§2.1). */
export const MAX_SEAT_PX = 48;
/** Zoom buttons and +/− step (§5.7). */
export const ZOOM_STEP = 1.5;
/** Arrow keys pan this far (§5.3). */
const KEY_PAN = 64;
/** A pointer that moves further than this between down and up was a drag, not a tap. */
const DRAG_SLOP = 6;
/** When the canvas hasn't been measured (no layout, e.g. tests), assume this size. */
const FALLBACK_SIZE: CanvasSize = { width: 640, height: 480 };

export interface MapViewApi {
  setContainer: (node: HTMLDivElement | null) => void;
  size: CanvasSize;
  view: MapView;
  /** Rendered seat size in CSS px (`s`, §2.1): every size threshold is on it. */
  seatPx: number;
  minScale: number;
  maxScale: number;
  /** A programmatic change is animating (CSS transition on the view group; none under reduced motion). */
  animateMs: number;
  zoomBy: (factor: number, around?: { x: number; y: number }, animate?: boolean) => void;
  zoomToSeatPx: (px: number, around: { x: number; y: number }) => void;
  fitAll: (animate?: boolean) => void;
  fitBounds: (bounds: Bounds, animate?: boolean, ms?: number) => void;
  panBy: (dx: number, dy: number) => void;
  /** Screen point (relative to the canvas) → map point. */
  toMap: (sx: number, sy: number) => { x: number; y: number };
  /** Gestures: one-pointer drag pans and two-pointer pinch zooms. `canPan(e)` false leaves a pointer to the caller. */
  pointerHandlers: (canPan?: (event: PointerEvent<HTMLDivElement>) => boolean) => {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  };
  /** The last pointer sequence moved the map (its click must not choose a seat). */
  wasDrag: () => boolean;
  /** The pointer type of the last press ("mouse", "touch" or "pen"; "" before any). */
  lastPointerType: () => string;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

function clampScale(scale: number, min: number, max: number) {
  return Math.min(Math.max(scale, min), max);
}

/**
 * Pan and zoom for an SVG seat map (docs/design/seating.md §5.3): fit on
 * load and resize, zoom buttons (×1.5 about the centre), Ctrl/⌘ + wheel or
 * trackpad pinch at the pointer, plain wheel pans vertically, one-finger
 * drag pans and two-finger pinch zooms (no inertia), and the canvas's keys
 * (arrows pan 64px, + and − zoom, 0 fits). Programmatic moves animate
 * through a CSS transition that only exists without reduced motion
 * (globals.css `.seat-map-view`), so reduced motion is an instant jump.
 */
export function useMapView(map: { width: number; height: number }): MapViewApi {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<CanvasSize | null>(null);
  const size = measured && measured.width > 0 && measured.height > 0 ? measured : FALLBACK_SIZE;
  const fitScale = Math.min(
    (size.width - FIT_PADDING * 2) / Math.max(map.width, 1),
    (size.height - FIT_PADDING * 2) / Math.max(map.height, 1),
  );
  const minScale = Math.max(fitScale, 0.01);
  const maxScale = Math.max(MAX_SEAT_PX / SEAT_SIZE, minScale);

  const centred = useCallback(
    (scale: number): MapView => ({
      scale,
      x: (size.width - map.width * scale) / 2,
      y: (size.height - map.height * scale) / 2,
    }),
    [size.width, size.height, map.width, map.height],
  );

  // Until the person moves the map, it follows the canvas size (fitted).
  const [state, setState] = useState<{ view: MapView | null; fitted: boolean; animateMs: number }>({
    view: null,
    fitted: true,
    animateMs: 0,
  });
  const view = state.fitted || !state.view ? centred(minScale) : state.view;

  /** Keeps the map on screen: centred on an axis where it fits, else never further than the padding past an edge. */
  const clampView = useCallback(
    (next: MapView): MapView => {
      const scale = clampScale(next.scale, minScale, maxScale);
      const w = map.width * scale;
      const h = map.height * scale;
      const x = w <= size.width ? (size.width - w) / 2 : Math.min(FIT_PADDING, Math.max(size.width - w - FIT_PADDING, next.x));
      const y = h <= size.height ? (size.height - h) / 2 : Math.min(FIT_PADDING, Math.max(size.height - h - FIT_PADDING, next.y));
      return { scale, x, y };
    },
    [minScale, maxScale, map.width, map.height, size.width, size.height],
  );

  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });

  const animTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commit = useCallback(
    (next: MapView, animateMs = 0) => {
      const clamped = clampView(next);
      // Straight away too, so a burst of wheel or pinch events builds on each other before the next render.
      viewRef.current = clamped;
      setState({ view: clamped, fitted: false, animateMs });
      if (animTimer.current) clearTimeout(animTimer.current);
      if (animateMs > 0) {
        animTimer.current = setTimeout(() => setState((s) => ({ ...s, animateMs: 0 })), animateMs + 50);
      }
    },
    [clampView],
  );
  useEffect(() => () => clearTimeout(animTimer.current), []);

  // Measure the canvas.
  useEffect(() => {
    if (!node) return;
    const read = () => setMeasured({ width: node.clientWidth, height: node.clientHeight });
    if (typeof ResizeObserver === "undefined") {
      queueMicrotask(read);
      return;
    }
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  const zoomBy = useCallback(
    (factor: number, around?: { x: number; y: number }, animate = true) => {
      const current = viewRef.current;
      const point = around ?? { x: size.width / 2, y: size.height / 2 };
      const scale = clampScale(current.scale * factor, minScale, maxScale);
      const k = scale / current.scale;
      commit({ scale, x: point.x - (point.x - current.x) * k, y: point.y - (point.y - current.y) * k }, animate ? 200 : 0);
    },
    [commit, minScale, maxScale, size.width, size.height],
  );

  const zoomToSeatPx = useCallback(
    (px: number, around: { x: number; y: number }) => {
      const current = viewRef.current;
      const scale = clampScale(px / SEAT_SIZE, minScale, maxScale);
      // The tapped map point moves to the canvas centre.
      const mx = (around.x - current.x) / current.scale;
      const my = (around.y - current.y) / current.scale;
      commit({ scale, x: size.width / 2 - mx * scale, y: size.height / 2 - my * scale }, 200);
    },
    [commit, minScale, maxScale, size.width, size.height],
  );

  const fitAll = useCallback(
    (animate = true) => {
      setState({ view: null, fitted: true, animateMs: animate ? 200 : 0 });
      if (animTimer.current) clearTimeout(animTimer.current);
      if (animate) animTimer.current = setTimeout(() => setState((s) => ({ ...s, animateMs: 0 })), 250);
    },
    [],
  );

  const fitBounds = useCallback(
    (bounds: Bounds, animate = true, ms = 200) => {
      const pad = SEAT_SIZE * 2;
      const w = Math.max(bounds.maxX - bounds.minX + pad * 2, 1);
      const h = Math.max(bounds.maxY - bounds.minY + pad * 2, 1);
      const scale = clampScale(Math.min(size.width / w, size.height / h), minScale, maxScale);
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      commit({ scale, x: size.width / 2 - cx * scale, y: size.height / 2 - cy * scale }, animate ? ms : 0);
    },
    [commit, minScale, maxScale, size.width, size.height],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const current = viewRef.current;
      commit({ ...current, x: current.x + dx, y: current.y + dy });
    },
    [commit],
  );

  const toMap = useCallback((sx: number, sy: number) => {
    const current = viewRef.current;
    return { x: (sx - current.x) / current.scale, y: (sy - current.y) / current.scale };
  }, []);

  // Wheel: Ctrl/⌘ (and trackpad pinch, which arrives as ctrl + wheel) zooms at the pointer; a plain wheel pans.
  // Not passive, so the page doesn't scroll or zoom underneath.
  useEffect(() => {
    if (!node) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        zoomBy(Math.exp(-event.deltaY * 0.01), { x: event.clientX - rect.left, y: event.clientY - rect.top }, false);
      } else {
        panBy(-event.deltaX, -event.deltaY);
      }
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [node, zoomBy, panBy]);

  // Gestures.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; pinch: number | null; pointerType: string }>({
    startX: 0,
    startY: 0,
    moved: false,
    pinch: null,
    pointerType: "",
  });

  const pointerHandlers = useCallback(
    (canPan: (event: PointerEvent<HTMLDivElement>) => boolean = () => true) => ({
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        gesture.current.pointerType = event.pointerType;
        if (event.button !== 0 && event.pointerType === "mouse") return;
        if (!canPan(event)) return;
        const rect = event.currentTarget.getBoundingClientRect();
        pointers.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
        if (pointers.current.size === 1) {
          gesture.current = { ...gesture.current, startX: event.clientX, startY: event.clientY, moved: false, pinch: null };
        }
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
          gesture.current.moved = true;
        }
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const previous = pointers.current.get(event.pointerId);
        if (!previous) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        if (pointers.current.size === 1) {
          if (!gesture.current.moved && Math.hypot(event.clientX - gesture.current.startX, event.clientY - gesture.current.startY) < DRAG_SLOP) {
            return;
          }
          if (!gesture.current.moved) {
            gesture.current.moved = true;
            // Keep receiving moves outside the canvas while dragging (not on the first press: taps must reach the seat).
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }
          pointers.current.set(event.pointerId, point);
          panBy(point.x - previous.x, point.y - previous.y);
          return;
        }
        pointers.current.set(event.pointerId, point);
        const [a, b] = [...pointers.current.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (gesture.current.pinch && distance > 0) {
          zoomBy(distance / gesture.current.pinch, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, false);
        }
        gesture.current.pinch = distance;
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) gesture.current.pinch = null;
      },
      onPointerCancel(event: PointerEvent<HTMLDivElement>) {
        pointers.current.delete(event.pointerId);
        gesture.current.pinch = null;
      },
    }),
    [panBy, zoomBy],
  );

  const wasDrag = useCallback(() => gesture.current.moved, []);
  const lastPointerType = useCallback(() => gesture.current.pointerType, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      const pans: Record<string, [number, number]> = {
        ArrowLeft: [KEY_PAN, 0],
        ArrowRight: [-KEY_PAN, 0],
        ArrowUp: [0, KEY_PAN],
        ArrowDown: [0, -KEY_PAN],
      };
      if (event.key in pans) {
        event.preventDefault();
        panBy(...pans[event.key]);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomBy(1 / ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        fitAll();
      }
    },
    [panBy, zoomBy, fitAll],
  );

  return {
    setContainer: setNode,
    size,
    view,
    seatPx: SEAT_SIZE * view.scale,
    minScale,
    maxScale,
    animateMs: state.animateMs,
    zoomBy,
    zoomToSeatPx,
    fitAll,
    fitBounds,
    panBy,
    toMap,
    pointerHandlers,
    wasDrag,
    lastPointerType,
    onKeyDown,
  };
}
