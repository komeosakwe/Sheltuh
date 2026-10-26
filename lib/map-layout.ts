/**
 * Marker layout for the scene map: viewport culling, overlap clustering and a
 * cap on how many markers are rendered at once. Pure (pixel maths only, no
 * Leaflet) so it can be unit-tested; SceneMapPanel projects lat/lng to pixels
 * at the current zoom, calls this, and projects cluster centres back.
 */
import { distanceKm } from "./geo";
import type { Coordinates } from "./types";

export interface MapPoint {
  id: string;
  /** Pixel position at the current zoom (Leaflet's `map.project`). */
  x: number;
  y: number;
}

export interface PixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type MapLayoutItem =
  | { kind: "single"; id: string }
  /** `ids[0]` is the representative (the first point in input order, i.e. the soonest event). */
  | { kind: "cluster"; ids: string[]; x: number; y: number };

export interface MapLayout {
  items: MapLayoutItem[];
  /** Points inside the viewport that weren't rendered because of `maxItems`. */
  hiddenCount: number;
}

export interface MapLayoutOptions {
  /** Points closer than this many pixels are merged into one cluster. */
  radius: number;
  /** Only points inside these bounds are laid out (culling). Omit to keep all. */
  viewport?: PixelBounds;
  /** Upper bound on rendered items (singles + clusters). */
  maxItems: number;
  /** Always rendered as its own marker, never clustered or culled (the selected event). */
  pinnedId?: string | null;
}

function inside(point: MapPoint, bounds: PixelBounds): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

/**
 * Greedy distance clustering in input order: each point not yet taken seeds a
 * group of every remaining point within `radius` of it. Input order decides
 * the representative and render priority, so callers pass points soonest
 * first. O(n²) over the visible points, which is fine for the hundreds the
 * map deals with after culling.
 */
export function layoutMapPoints(points: MapPoint[], options: MapLayoutOptions): MapLayout {
  const { radius, viewport, maxItems, pinnedId } = options;
  const items: MapLayoutItem[] = [];
  const pinned = pinnedId ? points.find((point) => point.id === pinnedId) : undefined;
  if (pinned) items.push({ kind: "single", id: pinned.id });

  const candidates = points.filter((point) => point.id !== pinned?.id && (!viewport || inside(point, viewport)));
  const taken = new Array<boolean>(candidates.length).fill(false);
  const radiusSquared = radius * radius;
  let hiddenCount = 0;

  for (let i = 0; i < candidates.length; i += 1) {
    if (taken[i]) continue;
    taken[i] = true;
    const seed = candidates[i];
    const group: MapPoint[] = [seed];
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (taken[j]) continue;
      const dx = candidates[j].x - seed.x;
      const dy = candidates[j].y - seed.y;
      if (dx * dx + dy * dy < radiusSquared) {
        taken[j] = true;
        group.push(candidates[j]);
      }
    }

    if (items.length >= maxItems) {
      hiddenCount += group.length;
      continue;
    }
    if (group.length === 1) {
      items.push({ kind: "single", id: seed.id });
    } else {
      const x = group.reduce((sum, point) => sum + point.x, 0) / group.length;
      const y = group.reduce((sum, point) => sum + point.y, 0) / group.length;
      items.push({ kind: "cluster", ids: group.map((point) => point.id), x, y });
    }
  }

  return { items, hiddenCount };
}

/** Grows `bounds` by `ratio` of its width/height on every side. */
export function padPixelBounds(bounds: PixelBounds, ratio: number): PixelBounds {
  const padX = (bounds.maxX - bounds.minX) * ratio;
  const padY = (bounds.maxY - bounds.minY) * ratio;
  return { minX: bounds.minX - padX, minY: bounds.minY - padY, maxX: bounds.maxX + padX, maxY: bounds.maxY + padY };
}

/**
 * True when zooming in can't separate these positions: they're all the same
 * point (typically events pinned at their suburb's centre because they have
 * no venue coordinates of their own).
 */
export function isSinglePoint(positions: { lat: number; lng: number }[]): boolean {
  if (positions.length < 2) return true;
  const [first] = positions;
  return positions.every(
    (position) => Math.abs(position.lat - first.lat) < 1e-6 && Math.abs(position.lng - first.lng) < 1e-6,
  );
}

/** /map opens on the events within this distance of the visitor's saved suburb, when there are some. */
export const NEAR_FRAME_KM = 50;

/**
 * What the map frames: every marker, except on its first framing with a
 * saved suburb (`near`, browser-only), when it's the markers within
 * NEAR_FRAME_KM of it (every marker if none are). Owner decision D5.
 */
export function framingTargets<T extends Coordinates>(markers: T[], near: Coordinates | null, firstFraming: boolean): T[] {
  if (!firstFraming || !near) return markers;
  const close = markers.filter((marker) => distanceKm(near, marker) <= NEAR_FRAME_KM);
  return close.length > 0 ? close : markers;
}
