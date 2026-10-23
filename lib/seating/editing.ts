/**
 * The organiser's seat-map editor, pure parts (docs/design/seating.md §5.13):
 * section generators (rectangular and curved), per-seat edits, relabelling,
 * stats and issues. Every function returns a new template; none mutates.
 * The API validates with lib/seating/template.ts, which the editor also runs
 * (issuesFor) before saving.
 */
import {
  MAX_MAP_DIMENSION,
  ROW_PITCH,
  SEAT_MAP_ID_PATTERN,
  SEAT_PITCH,
  SEAT_SIZE,
  validateSeatMapTemplate,
  type SeatKind,
  type SeatMapRow,
  type SeatMapSeat,
  type SeatMapSection,
  type SeatMapTemplate,
} from "./template";

/** Moves snap to this many map units (§5.13). */
export const SNAP = 4;
/** Room left around the seats when the canvas grows to fit them. */
const MARGIN = SEAT_SIZE * 2;

export type RowLabelScheme = "alpha" | "numeric";
export type RowOrder = "front-to-back" | "back-to-front";
export type SeatNumbering = "ltr" | "rtl" | "odd-even";

export interface SectionGeneratorOptions {
  shape: "rect" | "curved";
  name: string;
  /** 1–50. */
  rows: number;
  /** 1–80. */
  seatsPerRow: number;
  rowLabels: RowLabelScheme;
  rowOrder: RowOrder;
  seatNumbering: SeatNumbering;
  firstSeat: number;
  ticketTypeId: string;
  /** Rectangular: the front-left seat's centre. Curved: the arc's centre (usually the stage's). */
  origin: { x: number; y: number };
  /** Curved only: degrees of arc, 10–180. */
  arcDegrees?: number;
  /** Curved only: the front row's radius, in map units. */
  radius?: number;
}

export const GENERATOR_LIMITS = { rows: [1, 50], seatsPerRow: [1, 80], arcDegrees: [10, 180] } as const;

/** A blank map: a stage across the top, the focus point at its centre. */
export function emptyTemplate(): SeatMapTemplate {
  return {
    width: 800,
    height: 600,
    focus: { x: 400, y: 60 },
    stage: { label: "Stage", x: 250, y: 20, width: 300, height: 80 },
    sections: [],
  };
}

/** "A", "B" … "Z", "AA", "AB" … (alpha), or "1", "2" … (numeric), for the 0-based row index. */
export function rowLabel(index: number, scheme: RowLabelScheme): string {
  if (scheme === "numeric") return String(index + 1);
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/**
 * Seat labels for one row, left to right as seen on the map. `odd-even`:
 * odd numbers on the left counting out from the centre, even on the right
 * (5 3 1 2 4 6), starting from `first` (rounded to odd).
 */
export function seatLabels(count: number, numbering: SeatNumbering, first = 1): string[] {
  const start = Math.max(0, Math.floor(first));
  if (numbering === "ltr") return Array.from({ length: count }, (_, i) => String(start + i));
  if (numbering === "rtl") return Array.from({ length: count }, (_, i) => String(start + count - 1 - i));
  const odd = start % 2 === 1 ? start : start + 1;
  const left = Math.ceil(count / 2);
  const right = count - left;
  const lefts = Array.from({ length: left }, (_, i) => String(odd + 2 * (left - 1 - i)));
  const rights = Array.from({ length: right }, (_, i) => String(odd + 1 + 2 * i));
  return [...lefts, ...rights];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const snap = (n: number) => Math.round(n / SNAP) * SNAP;

function slug(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "s"
  );
}

/** Every section and seat id in the map. */
export function usedIds(template: SeatMapTemplate): Set<string> {
  const ids = new Set<string>();
  for (const section of template.sections) {
    ids.add(section.id);
    for (const row of section.rows) for (const seat of row.seats) ids.add(seat.id);
  }
  return ids;
}

/** An id from `base` that matches SEAT_MAP_ID_PATTERN and isn't in `used` (which it's added to). */
export function uniqueId(base: string, used: Set<string>): string {
  const clean = base.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 34) || "id";
  let id = clean;
  for (let n = 2; used.has(id) || !SEAT_MAP_ID_PATTERN.test(id); n += 1) id = `${clean}-${n}`;
  used.add(id);
  return id;
}

/** A row's label ends from its first and last seats. */
function withEnds(label: string, seats: SeatMapSeat[]): SeatMapRow {
  const first = seats[0];
  const last = seats[seats.length - 1];
  return { label, ends: [{ x: first.x, y: first.y }, { x: last.x, y: last.y }], seats };
}

/** The section's name anchor: centred over its seats, a row pitch above the top one. */
function anchorFor(rows: SeatMapRow[]): { x: number; y: number } {
  const all = rows.flatMap((row) => row.seats);
  if (all.length === 0) return { x: 0, y: 0 };
  return {
    x: round2(all.reduce((sum, seat) => sum + seat.x, 0) / all.length),
    y: round2(Math.max(0, Math.min(...all.map((seat) => seat.y)) - ROW_PITCH)),
  };
}

/** Generates a section (§5.13 "Add a section"). Ids are unique against `used` (which they're added to). */
export function generateSection(options: SectionGeneratorOptions, used: Set<string>): SeatMapSection {
  const rows = Math.min(Math.max(Math.round(options.rows), 1), GENERATOR_LIMITS.rows[1]);
  const perRow = Math.min(Math.max(Math.round(options.seatsPerRow), 1), GENERATOR_LIMITS.seatsPerRow[1]);
  const sectionId = uniqueId(`sec-${slug(options.name)}`, used);
  const labels = seatLabels(perRow, options.seatNumbering, options.firstSeat);
  const arc = Math.min(Math.max(options.arcDegrees ?? 60, GENERATOR_LIMITS.arcDegrees[0]), GENERATOR_LIMITS.arcDegrees[1]);
  const radius = Math.max(options.radius ?? 160, SEAT_PITCH);
  const built: SeatMapRow[] = [];
  for (let r = 0; r < rows; r += 1) {
    const label = rowLabel(options.rowOrder === "front-to-back" ? r : rows - 1 - r, options.rowLabels);
    const seats: SeatMapSeat[] = labels.map((seatLabel, i) => {
      let x: number;
      let y: number;
      let rotation = 0;
      if (options.shape === "curved") {
        const rr = radius + r * ROW_PITCH;
        // Left (seen on the map) to right: from the larger angle down, facing the centre.
        const degrees = 90 + arc / 2 - (perRow === 1 ? arc / 2 : (i * arc) / (perRow - 1));
        const rad = (degrees * Math.PI) / 180;
        x = options.origin.x + rr * Math.cos(rad);
        y = options.origin.y + rr * Math.sin(rad);
        rotation = round2(degrees - 90);
      } else {
        x = options.origin.x + i * SEAT_PITCH;
        y = options.origin.y + r * ROW_PITCH;
      }
      return {
        id: uniqueId(`${sectionId}-${label}-${seatLabel}`, used),
        label: seatLabel,
        x: round2(x),
        y: round2(y),
        ticketTypeId: options.ticketTypeId,
        ...(rotation !== 0 ? { rotation } : {}),
      };
    });
    built.push(withEnds(label, seats));
  }
  // Front-to-back means row A nearest the stage: rows are listed in label order either way.
  const ordered = options.rowOrder === "front-to-back" ? built : [...built].reverse();
  return { id: sectionId, label: options.name.trim() || "Section", labelAnchor: anchorFor(ordered), rows: ordered };
}

/** Where a new section goes by default: centred under everything already on the map. */
export function nextOrigin(template: SeatMapTemplate, options: Pick<SectionGeneratorOptions, "shape" | "seatsPerRow">): { x: number; y: number } {
  if (options.shape === "curved") return { ...template.focus };
  const seats = template.sections.flatMap((s) => s.rows.flatMap((r) => r.seats));
  const below = Math.max(
    template.stage ? template.stage.y + template.stage.height + ROW_PITCH * 2 : MARGIN,
    ...seats.map((seat) => seat.y + ROW_PITCH * 3),
  );
  const width = (options.seatsPerRow - 1) * SEAT_PITCH;
  return { x: snap(Math.max(MARGIN, template.focus.x - width / 2)), y: snap(below) };
}

/** Moves every seat (and label) of a section by (dx, dy). */
function shiftSection(section: SeatMapSection, dx: number, dy: number): SeatMapSection {
  if (dx === 0 && dy === 0) return section;
  const rows = section.rows.map((row) =>
    withEnds(
      row.label,
      row.seats.map((seat) => ({ ...seat, x: round2(seat.x + dx), y: round2(seat.y + dy) })),
    ),
  );
  return { ...section, rows, labelAnchor: { x: round2(section.labelAnchor.x + dx), y: round2(section.labelAnchor.y + dy) } };
}

/**
 * Keeps everything on the canvas: moves the whole map right or down if
 * anything is off the top or left, and grows (never shrinks) the canvas to
 * fit, up to MAX_MAP_DIMENSION.
 */
export function fitCanvas(template: SeatMapTemplate): SeatMapTemplate {
  const seats = template.sections.flatMap((s) => s.rows.flatMap((r) => r.seats));
  const xs = [...seats.map((s) => s.x), ...template.sections.map((s) => s.labelAnchor.x)];
  const ys = [...seats.map((s) => s.y), ...template.sections.map((s) => s.labelAnchor.y)];
  if (template.stage) {
    xs.push(template.stage.x, template.stage.x + template.stage.width);
    ys.push(template.stage.y, template.stage.y + template.stage.height);
  }
  xs.push(template.focus.x);
  ys.push(template.focus.y);
  const dx = Math.max(0, snap(MARGIN - Math.min(...xs)));
  const dy = Math.max(0, snap(MARGIN - Math.min(...ys)));
  const sections = template.sections.map((section) => shiftSection(section, dx, dy));
  const stage = template.stage ? { ...template.stage, x: template.stage.x + dx, y: template.stage.y + dy } : undefined;
  const width = Math.min(MAX_MAP_DIMENSION, Math.max(template.width + dx, snap(Math.max(...xs) + dx + MARGIN)));
  const height = Math.min(MAX_MAP_DIMENSION, Math.max(template.height + dy, snap(Math.max(...ys) + dy + MARGIN)));
  return {
    width,
    height,
    focus: { x: template.focus.x + dx, y: template.focus.y + dy },
    ...(stage ? { stage } : {}),
    sections,
  };
}

export function addSection(template: SeatMapTemplate, options: SectionGeneratorOptions): { template: SeatMapTemplate; sectionId: string } {
  const section = generateSection(options, usedIds(template));
  return { template: fitCanvas({ ...template, sections: [...template.sections, section] }), sectionId: section.id };
}

/** Applies `edit` to every seat in `ids`, dropping seats it returns null for, then empty rows and sections. */
function mapSeats(
  template: SeatMapTemplate,
  ids: ReadonlySet<string>,
  edit: (seat: SeatMapSeat) => SeatMapSeat | null,
): SeatMapTemplate {
  const sections = template.sections
    .map((section) => {
      const rows = section.rows
        .map((row) => {
          const seats = row.seats.map((seat) => (ids.has(seat.id) ? edit(seat) : seat)).filter((s): s is SeatMapSeat => s !== null);
          return seats.length ? withEnds(row.label, seats) : null;
        })
        .filter((row): row is SeatMapRow => row !== null);
      return rows.length ? { ...section, rows } : null;
    })
    .filter((section): section is SeatMapSection => section !== null);
  return { ...template, sections };
}

export interface SeatPatch {
  ticketTypeId?: string;
  kind?: SeatKind;
  blocked?: boolean;
  rotation?: number;
  x?: number;
  y?: number;
  label?: string;
}

/** Sets fields on the selected seats ("standard", unblocked and 0 rotation are stored as absent). */
export function updateSeats(template: SeatMapTemplate, ids: ReadonlySet<string>, patch: SeatPatch): SeatMapTemplate {
  return mapSeats(template, ids, (seat) => {
    const next: SeatMapSeat = { ...seat };
    if (patch.ticketTypeId !== undefined) next.ticketTypeId = patch.ticketTypeId;
    if (patch.label !== undefined) next.label = patch.label;
    if (patch.x !== undefined) next.x = round2(patch.x);
    if (patch.y !== undefined) next.y = round2(patch.y);
    if (patch.kind !== undefined) {
      if (patch.kind === "standard") delete next.kind;
      else next.kind = patch.kind;
    }
    if (patch.blocked !== undefined) {
      if (patch.blocked) next.blocked = true;
      else delete next.blocked;
    }
    if (patch.rotation !== undefined) {
      const r = round2(((((patch.rotation + 180) % 360) + 360) % 360) - 180);
      if (r === 0) delete next.rotation;
      else next.rotation = r;
    }
    return next;
  });
}

/** Moves the selected seats by (dx, dy), snapped, kept on the canvas. */
export function moveSeats(template: SeatMapTemplate, ids: ReadonlySet<string>, dx: number, dy: number): SeatMapTemplate {
  return fitCanvas(
    mapSeats(template, ids, (seat) => ({
      ...seat,
      x: Math.min(Math.max(snap(seat.x + dx), 0), MAX_MAP_DIMENSION),
      y: Math.min(Math.max(snap(seat.y + dy), 0), MAX_MAP_DIMENSION),
    })),
  );
}

export function deleteSeats(template: SeatMapTemplate, ids: ReadonlySet<string>): SeatMapTemplate {
  return mapSeats(template, ids, () => null);
}

/** "Align row": the selected seats onto one line, their average height. */
export function alignSeats(template: SeatMapTemplate, ids: ReadonlySet<string>): SeatMapTemplate {
  const ys = template.sections.flatMap((s) => s.rows.flatMap((r) => r.seats.filter((seat) => ids.has(seat.id)).map((seat) => seat.y)));
  if (ys.length === 0) return template;
  const y = snap(ys.reduce((a, b) => a + b, 0) / ys.length);
  return mapSeats(template, ids, (seat) => ({ ...seat, y }));
}

export interface RelabelOptions {
  /** Renames the row the seats are in (empty: leave it). */
  rowLabel?: string;
  firstSeat: number;
  direction: SeatNumbering;
}

/**
 * Relabels the selected seats of one row in their order across the map,
 * and optionally renames the row. Null (nothing changed) when the seats
 * aren't all in one row.
 */
export function relabelSeats(template: SeatMapTemplate, ids: ReadonlySet<string>, options: RelabelOptions): SeatMapTemplate | null {
  let target: { s: number; r: number } | null = null;
  template.sections.forEach((section, s) =>
    section.rows.forEach((row, r) => {
      if (row.seats.some((seat) => ids.has(seat.id))) target = target ? { s: -1, r: -1 } : { s, r };
    }),
  );
  const found = target as { s: number; r: number } | null;
  if (!found || found.s < 0) return null;
  const row = template.sections[found.s].rows[found.r];
  const chosen = row.seats.filter((seat) => ids.has(seat.id)).sort((a, b) => a.x - b.x || a.y - b.y);
  const labels = seatLabels(chosen.length, options.direction, options.firstSeat);
  const labelOf = new Map(chosen.map((seat, i) => [seat.id, labels[i]]));
  const sections = template.sections.map((section, s) =>
    s !== found.s
      ? section
      : {
          ...section,
          rows: section.rows.map((r, ri) =>
            ri !== found.r
              ? r
              : withEnds(
                  options.rowLabel?.trim() ? options.rowLabel.trim() : r.label,
                  r.seats.map((seat) => (labelOf.has(seat.id) ? { ...seat, label: labelOf.get(seat.id) as string } : seat)),
                ),
          ),
        },
  );
  return { ...template, sections };
}

export function renameSection(template: SeatMapTemplate, sectionId: string, label: string): SeatMapTemplate {
  return { ...template, sections: template.sections.map((s) => (s.id === sectionId ? { ...s, label: label.trim() } : s)) };
}

export function removeSection(template: SeatMapTemplate, sectionId: string): SeatMapTemplate {
  return { ...template, sections: template.sections.filter((s) => s.id !== sectionId) };
}

/** Seat ids of a section (its "Select"). */
export function sectionSeatIds(template: SeatMapTemplate, sectionId: string): string[] {
  return template.sections.find((s) => s.id === sectionId)?.rows.flatMap((r) => r.seats.map((seat) => seat.id)) ?? [];
}

export interface TierStats {
  seats: number;
  wheelchair: number;
  companion: number;
  blocked: number;
}

/** Seats per tier with their kinds and blocked counts, plus the totals. */
export function templateStats(template: SeatMapTemplate): { total: TierStats; byTier: Map<string, TierStats> } {
  const empty = (): TierStats => ({ seats: 0, wheelchair: 0, companion: 0, blocked: 0 });
  const total = empty();
  const byTier = new Map<string, TierStats>();
  for (const section of template.sections) {
    for (const row of section.rows) {
      for (const seat of row.seats) {
        const tier = byTier.get(seat.ticketTypeId) ?? empty();
        for (const stats of [tier, total]) {
          stats.seats += 1;
          if (seat.kind === "wheelchair") stats.wheelchair += 1;
          if (seat.kind === "companion") stats.companion += 1;
          if (seat.blocked) stats.blocked += 1;
        }
        byTier.set(seat.ticketTypeId, tier);
      }
    }
  }
  return { total, byTier };
}

export interface MapIssue {
  path: string;
  message: string;
  /** Seats the issue is about (its "select" action); empty for map-wide ones. */
  seatIds: string[];
}

/**
 * What the API would refuse (validateSeatMapTemplate, with the event's
 * ticket types), each with the seats it's about, so the editor can mark
 * them and select them.
 */
export function issuesFor(template: SeatMapTemplate, ticketTypeIds: Iterable<string>): MapIssue[] {
  if (template.sections.length === 0) return [];
  const result = validateSeatMapTemplate(template, { ticketTypeIds });
  if (result.ok) return [];
  return Object.entries(result.errors).map(([path, message]) => {
    const match = /^sections\[(\d+)\](?:\.rows\[(\d+)\](?:\.seats\[(\d+)\])?)?/.exec(path);
    let seatIds: string[] = [];
    if (match) {
      const section = template.sections[Number(match[1])];
      const row = match[2] !== undefined ? section?.rows[Number(match[2])] : undefined;
      if (match[3] !== undefined) {
        const seat = row?.seats[Number(match[3])];
        seatIds = seat ? [seat.id] : [];
      } else if (row) {
        seatIds = row.seats.map((seat) => seat.id);
      } else if (section && match[2] === undefined && path !== "sections") {
        seatIds = section.rows.flatMap((r) => r.seats.map((seat) => seat.id));
      }
    }
    return { path, message, seatIds };
  });
}

/** Parses an imported file's text: the validated template, or up to 10 error lines and how many more there were. */
export function parseImport(
  text: string,
  ticketTypeIds?: Iterable<string>,
): { ok: true; template: SeatMapTemplate; seatCount: number } | { ok: false; errors: string[]; more: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["The file isn’t valid JSON."], more: 0 };
  }
  // An export from GET …/seat-map (a SeatMapRecord) carries the map in `template`.
  const candidate =
    typeof raw === "object" && raw !== null && "template" in raw && typeof (raw as { template: unknown }).template === "object"
      ? (raw as { template: unknown }).template
      : raw;
  const result = validateSeatMapTemplate(candidate, ticketTypeIds ? { ticketTypeIds } : {});
  if (result.ok) return { ok: true, template: result.template, seatCount: result.seatCount };
  const lines = Object.entries(result.errors).map(([path, message]) => `${path}: ${message}`);
  return { ok: false, errors: lines.slice(0, 10), more: Math.max(0, lines.length - 10) };
}
