/**
 * Ready-made seat maps for the editor's "Start from a layout" picker
 * (docs/design/seating.md §5.13). Each layout builds a whole template from
 * two choices, about how many seats and which ticket type they use, scaled
 * within the layout's own limits (and always within the generator's: 50 rows,
 * 80 seats a row). Organisers then change anything with the editor's tools.
 *
 * Only what the map model represents: sections of rows (straight, with an
 * aisle as a gap, angled, or curved), a stage, a focus point at the stage's
 * centre, and seat kinds. Two wheelchair spaces, each with a companion seat
 * beside it, sit at the front. There are no tables: the model has no table
 * shape, so a cabaret layout isn't offered. Pure: no I/O, no framework.
 */
import { fitCanvas, rowLabel, seatLabels, uniqueId } from "./editing";
import {
  ROW_PITCH,
  SEAT_PITCH,
  SEAT_SIZE,
  type SeatMapPoint,
  type SeatMapRow,
  type SeatMapSeat,
  type SeatMapSection,
  type SeatMapStage,
  type SeatMapTemplate,
} from "./template";

export const SEAT_LAYOUT_IDS = ["stage", "centre-aisle", "stalls-sides", "curved", "small-room"] as const;
export type SeatLayoutId = (typeof SEAT_LAYOUT_IDS)[number];

/** "About how many seats": the picker's input range and starting value. */
export const LAYOUT_SEAT_TARGET = { min: 10, max: 2000, initial: 150 } as const;

export interface SeatLayout {
  id: SeatLayoutId;
  name: string;
  /** One line, shown on the card. */
  description: string;
  /** The fewest and most seats this layout makes, whatever is asked for. */
  seats: { min: number; max: number };
  /** The size its card's sketch is drawn at (a schematic: the same whatever is asked for). */
  sketchSeats: number;
}

export const SEAT_LAYOUTS: readonly SeatLayout[] = [
  { id: "stage", name: "Rows facing a stage", description: "One block of straight rows, like a simple theatre.", seats: { min: 10, max: 2000 }, sketchSeats: 120 },
  {
    id: "centre-aisle",
    name: "Theatre with a centre aisle",
    description: "Straight rows split by an aisle down the middle.",
    seats: { min: 12, max: 2000 },
    sketchSeats: 120,
  },
  {
    id: "stalls-sides",
    name: "Stalls and side sections",
    description: "A centre block with angled Left and Right sections.",
    seats: { min: 30, max: 2000 },
    sketchSeats: 200,
  },
  {
    id: "curved",
    name: "Curved rows",
    description: "Rows in a fan around the stage, longer towards the back.",
    seats: { min: 20, max: 1200 },
    sketchSeats: 150,
  },
  {
    id: "small-room",
    name: "Small room",
    description: "A few short rows for a workshop or screening, up to 96 seats.",
    seats: { min: 8, max: 96 },
    sketchSeats: 40,
  },
];

/** The space between blocks (an aisle): two seats wide. */
const AISLE = SEAT_PITCH * 2;
const STAGE_HEIGHT = 64;
/** Curved rows span this many degrees. */
const FAN_DEGREES = 100;
const FAN_RAD = (FAN_DEGREES * Math.PI) / 180;
/** Side sections turn this many degrees towards the stage. */
const SIDE_ANGLE = 20;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const snap = (n: number) => Math.round(n / 4) * 4;

export function getSeatLayout(id: SeatLayoutId): SeatLayout {
  const layout = SEAT_LAYOUTS.find((l) => l.id === id);
  if (!layout) throw new Error(`Unknown seat layout: ${id}`);
  return layout;
}

/** A seat's position before ids and labels: its centre, and the way it faces. */
interface Spot {
  x: number;
  y: number;
  rotation?: number;
}

/** Turns spots (rows front to back, seats left to right) into a section, with unique ids. */
function section(name: string, rows: Spot[][], ticketTypeId: string, used: Set<string>): SeatMapSection {
  const sectionId = uniqueId(`sec-${name}`, used);
  const built: SeatMapRow[] = rows.map((spots, r) => {
    const label = rowLabel(r, "alpha");
    const labels = seatLabels(spots.length, "ltr", 1);
    const seats: SeatMapSeat[] = spots.map((spot, i) => {
      const rotation = spot.rotation === undefined ? 0 : round2(spot.rotation);
      return {
        id: uniqueId(`${sectionId}-${label}-${labels[i]}`, used),
        label: labels[i],
        x: round2(spot.x),
        y: round2(spot.y),
        ticketTypeId,
        ...(rotation !== 0 ? { rotation } : {}),
      };
    });
    const first = seats[0];
    const last = seats[seats.length - 1];
    return { label, ends: [{ x: first.x, y: first.y }, { x: last.x, y: last.y }], seats };
  });
  const all = built.flatMap((row) => row.seats);
  const labelAnchor = {
    x: round2(all.reduce((sum, seat) => sum + seat.x, 0) / all.length),
    y: round2(Math.min(...all.map((seat) => seat.y)) - ROW_PITCH),
  };
  return { id: sectionId, label: name, labelAnchor, rows: built };
}

/** A straight block: `rows` rows of `perRow` seats, front-left seat at (x, y). */
function block(x: number, y: number, rows: number, perRow: number): Spot[][] {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: perRow }, (_, i) => ({ x: x + i * SEAT_PITCH, y: y + r * ROW_PITCH })));
}

/** Turns a block of spots `degrees` clockwise around `pivot`, each seat turned with it. */
function turn(rows: Spot[][], pivot: SeatMapPoint, degrees: number): Spot[][] {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return rows.map((row) =>
    row.map((spot) => {
      const dx = spot.x - pivot.x;
      const dy = spot.y - pivot.y;
      return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos, rotation: (spot.rotation ?? 0) + degrees };
    }),
  );
}

/** Rows and seats per row near `target` seats, about `aspect` times as wide as deep. */
function grid(target: number, aspect: number, maxRows: number, maxPerRow: number, minPerRow = 1): { rows: number; perRow: number } {
  let rows = clamp(Math.round(Math.sqrt(target / aspect)), 1, maxRows);
  const perRow = clamp(Math.round(target / rows), minPerRow, maxPerRow);
  rows = clamp(Math.round(target / perRow), 1, maxRows);
  return { rows, perRow };
}

/** A stage across the top, centred on x = 0, its bottom edge two rows in front of y = 0. */
function stageAbove(seatSpan: number): SeatMapStage {
  const width = snap(clamp(seatSpan * 0.6, 160, 640));
  return { label: "Stage", x: -width / 2, y: -ROW_PITCH * 2 - STAGE_HEIGHT, width, height: STAGE_HEIGHT };
}

/** Marks `wheelchair` as a wheelchair space and `companion` (next to it) as its companion seat. */
function accessible(row: SeatMapRow, pairs: [number, number][]): SeatMapRow {
  const kinds = new Map<number, "wheelchair" | "companion">();
  for (const [wheelchair, companion] of pairs) {
    if (wheelchair < 0 || companion < 0 || wheelchair >= row.seats.length || companion >= row.seats.length || wheelchair === companion) continue;
    if (kinds.has(wheelchair) || kinds.has(companion)) continue;
    kinds.set(wheelchair, "wheelchair");
    kinds.set(companion, "companion");
  }
  return { ...row, seats: row.seats.map((seat, i) => (kinds.has(i) ? { ...seat, kind: kinds.get(i) } : seat)) };
}

/** Both ends of the front row (row A): wheelchair spaces, each with a companion seat inside it. Rows of 4 or more. */
function frontEnds(section: SeatMapSection): SeatMapSection {
  const [front, ...rest] = section.rows;
  const n = front.seats.length;
  if (n < 4) return section;
  return { ...section, rows: [accessible(front, [[0, 1], [n - 1, n - 2]]), ...rest] };
}

function template(stage: SeatMapStage, sections: SeatMapSection[]): SeatMapTemplate {
  const focus = { x: round2(stage.x + stage.width / 2), y: round2(stage.y + stage.height / 2) };
  // fitCanvas moves everything onto the canvas (the drafts are centred on x = 0) and sizes it to fit.
  return fitCanvas({ width: 1, height: 1, focus, stage, sections });
}

function rowsFacingStage(target: number, tier: string, maxRows: number, maxPerRow: number, aspect: number, name: string): SeatMapTemplate {
  const { rows, perRow } = grid(target, aspect, maxRows, maxPerRow, 2);
  const span = (perRow - 1) * SEAT_PITCH;
  const used = new Set<string>();
  const stalls = frontEnds(section(name, block(-span / 2, 0, rows, perRow), tier, used));
  return template(stageAbove(span), [stalls]);
}

function centreAisle(target: number, tier: string): SeatMapTemplate {
  // Each half at least 2 seats, at most 40 (a row of 80, as the generator).
  let rows = clamp(Math.round(Math.sqrt(target / 2)), 1, 50);
  const half = clamp(Math.round(target / rows / 2), 2, 40);
  rows = clamp(Math.round(target / (half * 2)), 1, 50);
  const halfSpan = (half - 1) * SEAT_PITCH;
  const span = halfSpan * 2 + AISLE;
  const left = block(-span / 2, 0, rows, half);
  const right = block(-span / 2 + halfSpan + AISLE, 0, rows, half);
  const spots = left.map((row, r) => [...row, ...right[r]]);
  const used = new Set<string>();
  const stalls = section("Stalls", spots, tier, used);
  // Wheelchair spaces on the aisle, in the front row: either side of it.
  const [front, ...rest] = stalls.rows;
  const withSpaces = half >= 2 ? accessible(front, [[half - 1, half - 2], [half, half + 1]]) : front;
  return template(stageAbove(span), [{ ...stalls, rows: [withSpaces, ...rest] }]);
}

function stallsAndSides(target: number, tier: string): SeatMapTemplate {
  // About 60% of the seats in the centre, 20% each side, the same number of rows.
  let rows = clamp(Math.round(Math.sqrt(target / 3.5)), 2, 40);
  const centre = clamp(Math.round((target * 0.6) / rows), 4, 60);
  const side = clamp(Math.round((target * 0.2) / rows), 2, 30);
  rows = clamp(Math.round(target / (centre + side * 2)), 2, 40);
  const centreSpan = (centre - 1) * SEAT_PITCH;
  const sideSpan = (side - 1) * SEAT_PITCH;
  const used = new Set<string>();
  const middle = frontEnds(section("Stalls", block(-centreSpan / 2, 0, rows, centre), tier, used));
  // Each side block turns about its front corner nearest the stalls, so its far end comes forward.
  const leftInner = { x: -centreSpan / 2 - AISLE, y: 0 };
  const rightInner = { x: centreSpan / 2 + AISLE, y: 0 };
  const left = section("Left", turn(block(leftInner.x - sideSpan, 0, rows, side), leftInner, SIDE_ANGLE), tier, used);
  const right = section("Right", turn(block(rightInner.x, 0, rows, side), rightInner, -SIDE_ANGLE), tier, used);
  return template(stageAbove(centreSpan), [left, middle, right]);
}

/** Seats in a fan row of radius `radius`: about one seat pitch apart along the arc. */
const fanSeats = (radius: number) => Math.floor((radius * FAN_RAD) / SEAT_PITCH) + 1;

function fanTotal(rows: number, front: number): number {
  let total = 0;
  for (let r = 0; r < rows; r += 1) total += Math.min(fanSeats(front + r * ROW_PITCH), 80);
  return total;
}

function curved(target: number, tier: string): SeatMapTemplate {
  // The front row's radius: never inside the stage, and never so large a row passes 80 seats.
  const minFront = ROW_PITCH * 4;
  const maxFront = Math.floor((79 * SEAT_PITCH) / FAN_RAD);
  const largestFront = (rows: number) => Math.max(minFront, maxFront - (rows - 1) * ROW_PITCH);
  let rows = clamp(Math.round(Math.sqrt(target / 4)), 2, 40);
  while (rows > 1 && fanTotal(rows, minFront) > target) rows -= 1;
  while (rows < 40 && fanTotal(rows, largestFront(rows)) < target) rows += 1;
  // The radius whose total is nearest the target (totals grow with the radius).
  let lo = minFront;
  let hi = largestFront(rows);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fanTotal(rows, mid) < target) lo = mid;
    else hi = mid;
  }
  const front = Math.abs(fanTotal(rows, lo) - target) <= Math.abs(fanTotal(rows, hi) - target) ? lo : hi;
  // The arc's centre is (0, 0); seats fan out below it, facing it.
  const spots: Spot[][] = Array.from({ length: rows }, (_, r) => {
    const radius = front + r * ROW_PITCH;
    const n = Math.min(fanSeats(radius), 80);
    return Array.from({ length: n }, (_, i) => {
      const degrees = 90 + FAN_DEGREES / 2 - (n === 1 ? FAN_DEGREES / 2 : (i * FAN_DEGREES) / (n - 1));
      const rad = (degrees * Math.PI) / 180;
      return { x: radius * Math.cos(rad), y: radius * Math.sin(rad), rotation: degrees - 90 };
    });
  });
  const used = new Set<string>();
  const fan = frontEnds(section("Stalls", spots, tier, used));
  // The name goes under the back row's middle: above the seats is where the stage is.
  const back = Math.max(...fan.rows.flatMap((row) => row.seats.map((seat) => seat.y)));
  const stalls = { ...fan, labelAnchor: { x: 0, y: round2(back + ROW_PITCH) } };
  // The stage sits inside the fan, its bottom edge two rows in front of row A's middle seat, as narrow as it
  // must be to clear the seats curving up beside it (the seats still face the arc's centre, just behind it).
  const span = 2 * front * Math.sin(FAN_RAD / 2);
  const bottom = front - ROW_PITCH * 2;
  const room = Math.sqrt(Math.max(0, front * front - (bottom + SEAT_SIZE) ** 2)) - SEAT_SIZE;
  const width = Math.max(64, Math.floor(Math.min(clamp(span * 0.6, 160, 640), room * 2) / 4) * 4);
  return template({ label: "Stage", x: -width / 2, y: bottom - STAGE_HEIGHT, width, height: STAGE_HEIGHT }, [stalls]);
}

/**
 * The layout as a whole seat map: about `seats` seats (kept within the
 * layout's own range), every one on `ticketTypeId`. Ids are fresh, so the
 * result replaces a map rather than joining one.
 */
export function buildSeatLayout(id: SeatLayoutId, options: { seats: number; ticketTypeId: string }): SeatMapTemplate {
  const layout = getSeatLayout(id);
  const asked = Number.isFinite(options.seats) ? Math.round(options.seats) : LAYOUT_SEAT_TARGET.initial;
  const target = clamp(asked, layout.seats.min, layout.seats.max);
  const tier = options.ticketTypeId;
  switch (id) {
    case "stage":
      return rowsFacingStage(target, tier, 50, 80, 2, "Stalls");
    case "centre-aisle":
      return centreAisle(target, tier);
    case "stalls-sides":
      return stallsAndSides(target, tier);
    case "curved":
      return curved(target, tier);
    case "small-room":
      return rowsFacingStage(target, tier, 8, 12, 2.5, "Seats");
  }
}

/**
 * A layout's preview, for its card: each row as runs of seat centres,
 * broken where there's an aisle (a gap wider than one and a half seats),
 * plus the stage and the map's size. The card draws them as thick lines.
 */
export function layoutPreview(map: SeatMapTemplate): { width: number; height: number; stage?: SeatMapStage; runs: SeatMapPoint[][] } {
  const runs: SeatMapPoint[][] = [];
  for (const sec of map.sections) {
    for (const row of sec.rows) {
      let run: SeatMapPoint[] = [];
      row.seats.forEach((seat, i) => {
        const previous = row.seats[i - 1];
        if (previous && Math.hypot(seat.x - previous.x, seat.y - previous.y) > SEAT_PITCH * 1.5) {
          runs.push(run);
          run = [];
        }
        run.push({ x: seat.x, y: seat.y });
      });
      if (run.length) runs.push(run);
    }
  }
  return { width: map.width, height: map.height, ...(map.stage ? { stage: map.stage } : {}), runs };
}
