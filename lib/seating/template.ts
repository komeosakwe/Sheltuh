/**
 * Reserved seating: the seat map's shape and its validator, shared by the
 * browser (the organiser's editor, the buyer's seat page) and the API
 * (lib/server/seat-map-input.ts, which runs the same validator at the
 * boundary). Pure: no I/O, no framework.
 *
 * A map is sections → rows → seats. Each seat points at one of the event's
 * ticket types (its price tier). The order seats appear in (sections, then
 * rows, then seats) is their `position`, 0-based: the bit a seat has in the
 * availability bitmap (lib/seating/availability.ts) and the column
 * `event_seats.position` in the database.
 *
 * Coordinates are SVG user units ("u", docs/design/seating.md §2.1): a seat
 * is drawn as a SEAT_SIZE × SEAT_SIZE square centred on (x, y), turned by
 * `rotation` degrees, inside a `width` × `height` canvas whose origin is the
 * top left. `focus` is the point "best available" seats are chosen towards
 * (stage centre by default, movable by the organiser; never shown to
 * buyers). Each section has a `labelAnchor` (where its name is drawn) and
 * each row its `ends` (the centres of its first and last seats, where the
 * row label is drawn just outside); the validator fills both in when they're
 * left out, so a stored map always has them.
 *
 * See docs/architecture.md, "Reserved seating".
 */

export const SEAT_KINDS = ["standard", "wheelchair", "companion"] as const;
export type SeatKind = (typeof SEAT_KINDS)[number];

/** A seat's side, in map units (docs/design/seating.md §2.1). */
export const SEAT_SIZE = 24;
/** The generators' default seat pitch and row pitch, in map units. */
export const SEAT_PITCH = 28;
export const ROW_PITCH = 32;

/** At most this many seats in one map (the database checks it too). */
export const MAX_SEATS_PER_MAP = 10_000;
/** At most this many seats in one order (decision 4, docs/SEATING_PLAN.md). */
export const MAX_SEATS_PER_ORDER = 10;
export const MAX_SECTIONS = 100;
export const MAX_ROWS_PER_SECTION = 200;
export const MAX_SEATS_PER_ROW = 500;
/**
 * At most this many ticket types (price tiers) on one map, so buyers can tell
 * them apart by pattern without colour (manager decision 3,
 * docs/design/seating.md). The database checks it too.
 */
export const MAX_SEATED_TIERS = 5;
/** The canvas is at most this many map units across and down. */
export const MAX_MAP_DIMENSION = 10_000;

/** Lengths in characters (code points), after trimming. */
export const SECTION_LABEL_MAX = 40;
/** A row label may also be empty ("Box A · Seat 3"). */
export const ROW_LABEL_MAX = 10;
export const SEAT_LABEL_MAX = 10;
export const STAGE_LABEL_MAX = 40;

/** Seat and section ids: client-chosen, stable across edits, unique within the map. */
export const SEAT_MAP_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export interface SeatMapPoint {
  x: number;
  y: number;
}

/** A rectangle (or, with `shape: "ellipse"`, the ellipse inside it) drawn under the seats. `x`, `y`: top left. */
export interface SeatMapStage {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: "rect" | "ellipse";
}

export interface SeatMapSeat {
  id: string;
  label: string;
  x: number;
  y: number;
  ticketTypeId: string;
  /** Degrees clockwise, -180 to 180. Absent means 0. */
  rotation?: number;
  /** Absent means "standard". */
  kind?: SeatKind;
  /** Never sold (an obstructed view, a sound desk). Absent means false. */
  blocked?: boolean;
}

export interface SeatMapRow {
  /** May be empty: the row has no name (boxes, single rows). */
  label: string;
  /** Where the row label goes: [start, end], by default the first and last seats' centres. */
  ends: [SeatMapPoint, SeatMapPoint];
  seats: SeatMapSeat[];
}

export interface SeatMapSection {
  id: string;
  label: string;
  /** Where the section name is drawn: by default centred over its seats. */
  labelAnchor: SeatMapPoint;
  rows: SeatMapRow[];
}

export interface SeatMapTemplate {
  width: number;
  height: number;
  focus: SeatMapPoint;
  stage?: SeatMapStage;
  sections: SeatMapSection[];
}

/** How a seat is named on tickets, emails and the door scanner (lib/seating/format.ts). */
export interface SeatLabel {
  section: string;
  /** Empty when the row has no name. */
  row: string;
  seat: string;
}

/** A sold seat as tickets, the confirmation page, emails and the door carry it. */
export interface TicketSeat extends SeatLabel {
  kind: SeatKind;
}

/** A seat with its position and labels, in map order. */
export interface FlatSeat extends SeatLabel {
  position: number;
  id: string;
  sectionId: string;
  x: number;
  y: number;
  rotation: number;
  ticketTypeId: string;
  kind: SeatKind;
  blocked: boolean;
}

/** Every seat in map order (`position` 0, 1, 2…). */
export function flattenSeats(template: SeatMapTemplate): FlatSeat[] {
  const seats: FlatSeat[] = [];
  for (const section of template.sections) {
    for (const row of section.rows) {
      for (const seat of row.seats) {
        seats.push({
          position: seats.length,
          id: seat.id,
          sectionId: section.id,
          section: section.label,
          row: row.label,
          seat: seat.label,
          x: seat.x,
          y: seat.y,
          rotation: seat.rotation ?? 0,
          ticketTypeId: seat.ticketTypeId,
          kind: seat.kind ?? "standard",
          blocked: seat.blocked === true,
        });
      }
    }
  }
  return seats;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type SeatMapValidation =
  | { ok: true; template: SeatMapTemplate; seatCount: number }
  | { ok: false; errors: Record<string, string> };

export interface SeatMapValidationOptions {
  /**
   * The event's ticket type ids. Every seat must use one, and every ticket
   * type a seat uses needs at least one seat that isn't blocked (its capacity
   * is its unblocked seats). Leave out to skip the id check (e.g. an import
   * before the tiers exist).
   */
  ticketTypeIds?: Iterable<string>;
}

/** At most this many field errors are reported (a 10,000-seat import can't produce 10,000 messages). */
const MAX_ERRORS = 20;

/**
 * Letters, digits, spaces and a little punctuation (`- ' ’ . & / ( ) # +`),
 * starting with a letter or digit, no runs of spaces. Combining marks are
 * allowed after a letter (NFC leaves some, e.g. in Vietnamese). No control,
 * invisible or text-direction characters: labels are printed on tickets and
 * read aloud at the door.
 */
const LABEL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}'’.&/()#+-]*(?: [\p{L}\p{M}\p{N}'’.&/()#+-]+)*$/u;

class Errors {
  readonly map: Record<string, string> = {};
  private count = 0;

  add(path: string, message: string) {
    if (this.count >= MAX_ERRORS || path in this.map) return;
    this.map[path] = message;
    this.count += 1;
  }

  get full() {
    return this.count >= MAX_ERRORS;
  }

  get empty() {
    return this.count === 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** A finite number in [min, max], rounded to 2 decimal places; undefined otherwise. */
function coordinate(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return undefined;
  return round2(value);
}

/** A point {x, y} on a width × height map; undefined if it isn't one. */
function point(value: unknown, width: number, height: number): SeatMapPoint | undefined {
  if (!isRecord(value)) return undefined;
  const x = coordinate(value.x, 0, width);
  const y = coordinate(value.y, 0, height);
  return x === undefined || y === undefined ? undefined : { x, y };
}

/** The label, trimmed and NFC-normalised, if it passes LABEL_PATTERN and fits; undefined otherwise. */
export function cleanSeatMapLabel(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.normalize("NFC").trim();
  const length = Array.from(label).length;
  if (length < 1 || length > max || !LABEL_PATTERN.test(label)) return undefined;
  return label;
}

const labelMessage = (max: number) =>
  `Use 1 to ${max} letters, digits, spaces or - ' . & / ( ) # +, starting with a letter or digit.`;

/**
 * Checks a seat map and returns it normalised (labels trimmed and NFC,
 * coordinates rounded to 2 places, section label anchors and row ends filled
 * in where they were left out, `kind: "standard"`, `blocked: false` and
 * `rotation: 0` left out, unknown keys dropped), or field errors keyed by
 * path (`sections[0].rows[2].seats[3].label`). The API runs exactly this.
 */
export function validateSeatMapTemplate(raw: unknown, options: SeatMapValidationOptions = {}): SeatMapValidation {
  const errors = new Errors();
  if (!isRecord(raw)) return { ok: false, errors: { template: "Send a seat map." } };

  const width = coordinate(raw.width, 1, MAX_MAP_DIMENSION);
  const height = coordinate(raw.height, 1, MAX_MAP_DIMENSION);
  if (width === undefined) errors.add("width", `A number from 1 to ${MAX_MAP_DIMENSION}.`);
  if (height === undefined) errors.add("height", `A number from 1 to ${MAX_MAP_DIMENSION}.`);
  const w = width ?? MAX_MAP_DIMENSION;
  const h = height ?? MAX_MAP_DIMENSION;

  const focus = point(raw.focus, w, h);
  if (!focus) errors.add("focus", "Set the point the best seats face (usually the stage's centre), on the map.");

  let stage: SeatMapStage | undefined;
  if (raw.stage !== undefined && raw.stage !== null) {
    if (!isRecord(raw.stage)) {
      errors.add("stage", "Invalid stage.");
    } else {
      const s = raw.stage;
      const label = s.label === undefined || s.label === "" ? "" : cleanSeatMapLabel(s.label, STAGE_LABEL_MAX);
      const x = coordinate(s.x, 0, w);
      const y = coordinate(s.y, 0, h);
      const sw = coordinate(s.width, 0.5, w);
      const sh = coordinate(s.height, 0.5, h);
      const shape = s.shape === undefined || s.shape === "rect" || s.shape === "ellipse" ? s.shape : null;
      if (label === undefined) errors.add("stage.label", labelMessage(STAGE_LABEL_MAX));
      if (x === undefined || y === undefined || sw === undefined || sh === undefined || x + sw > w || y + sh > h) {
        errors.add("stage", "The stage must be inside the map.");
      }
      if (shape === null) errors.add("stage.shape", 'Use "rect" or "ellipse".');
      if (label !== undefined && x !== undefined && y !== undefined && sw !== undefined && sh !== undefined && shape !== null) {
        stage = { label, x, y, width: sw, height: sh, ...(shape === "ellipse" ? { shape } : {}) };
      }
    }
  }

  const knownTiers = options.ticketTypeIds ? new Set(options.ticketTypeIds) : undefined;
  const sections: SeatMapSection[] = [];
  const sectionIds = new Set<string>();
  const sectionLabels = new Set<string>();
  const seatIds = new Set<string>();
  const unblockedByTier = new Map<string, number>();
  const tiersUsed = new Set<string>();
  let seatCount = 0;

  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    errors.add("sections", "Add at least one section.");
  } else if (raw.sections.length > MAX_SECTIONS) {
    errors.add("sections", `At most ${MAX_SECTIONS} sections.`);
  } else {
    raw.sections.forEach((rawSection, si) => {
      if (errors.full) return;
      const sp = `sections[${si}]`;
      if (!isRecord(rawSection)) {
        errors.add(sp, "Invalid section.");
        return;
      }
      const id = typeof rawSection.id === "string" && SEAT_MAP_ID_PATTERN.test(rawSection.id) ? rawSection.id : undefined;
      if (!id) errors.add(`${sp}.id`, "Invalid section id.");
      else if (sectionIds.has(id)) errors.add(`${sp}.id`, "Each section needs its own id.");
      else sectionIds.add(id);
      const label = cleanSeatMapLabel(rawSection.label, SECTION_LABEL_MAX);
      if (!label) errors.add(`${sp}.label`, labelMessage(SECTION_LABEL_MAX));
      else if (sectionLabels.has(label.toLowerCase())) errors.add(`${sp}.label`, "Each section needs its own name.");
      else sectionLabels.add(label.toLowerCase());
      let labelAnchor: SeatMapPoint | undefined;
      if (rawSection.labelAnchor !== undefined && rawSection.labelAnchor !== null) {
        labelAnchor = point(rawSection.labelAnchor, w, h);
        if (!labelAnchor) errors.add(`${sp}.labelAnchor`, "The section name must be on the map.");
      }

      const rows: SeatMapRow[] = [];
      const rowLabels = new Set<string>();
      if (!Array.isArray(rawSection.rows) || rawSection.rows.length === 0) {
        errors.add(`${sp}.rows`, "Add at least one row.");
      } else if (rawSection.rows.length > MAX_ROWS_PER_SECTION) {
        errors.add(`${sp}.rows`, `At most ${MAX_ROWS_PER_SECTION} rows in a section.`);
      } else {
        rawSection.rows.forEach((rawRow, ri) => {
          if (errors.full) return;
          const rp = `${sp}.rows[${ri}]`;
          if (!isRecord(rawRow)) {
            errors.add(rp, "Invalid row.");
            return;
          }
          const unnamed = rawRow.label === undefined || rawRow.label === null || rawRow.label === "";
          const rowLabel = unnamed ? "" : cleanSeatMapLabel(rawRow.label, ROW_LABEL_MAX);
          if (rowLabel === undefined) errors.add(`${rp}.label`, `Leave it empty, or ${labelMessage(ROW_LABEL_MAX).toLowerCase()}`);
          else if (rowLabels.has(rowLabel.toLowerCase())) {
            errors.add(`${rp}.label`, rowLabel ? "Each row in a section needs its own name." : "Only one row in a section can be unnamed.");
          } else rowLabels.add(rowLabel.toLowerCase());
          let ends: [SeatMapPoint, SeatMapPoint] | undefined;
          if (rawRow.ends !== undefined && rawRow.ends !== null) {
            const start = Array.isArray(rawRow.ends) && rawRow.ends.length === 2 ? point(rawRow.ends[0], w, h) : undefined;
            const end = Array.isArray(rawRow.ends) && rawRow.ends.length === 2 ? point(rawRow.ends[1], w, h) : undefined;
            if (!start || !end) errors.add(`${rp}.ends`, "Two points on the map: where the row label goes at each end.");
            else ends = [start, end];
          }

          const seats: SeatMapSeat[] = [];
          const seatLabels = new Set<string>();
          if (!Array.isArray(rawRow.seats) || rawRow.seats.length === 0) {
            errors.add(`${rp}.seats`, "Add at least one seat.");
          } else if (rawRow.seats.length > MAX_SEATS_PER_ROW) {
            errors.add(`${rp}.seats`, `At most ${MAX_SEATS_PER_ROW} seats in a row.`);
          } else {
            rawRow.seats.forEach((rawSeat, ki) => {
              if (errors.full) return;
              seatCount += 1;
              if (seatCount > MAX_SEATS_PER_MAP) {
                errors.add("sections", `At most ${MAX_SEATS_PER_MAP.toLocaleString("en-AU")} seats in a map.`);
                return;
              }
              const kp = `${rp}.seats[${ki}]`;
              if (!isRecord(rawSeat)) {
                errors.add(kp, "Invalid seat.");
                return;
              }
              const seatId = typeof rawSeat.id === "string" && SEAT_MAP_ID_PATTERN.test(rawSeat.id) ? rawSeat.id : undefined;
              if (!seatId) errors.add(`${kp}.id`, "Invalid seat id.");
              else if (seatIds.has(seatId)) errors.add(`${kp}.id`, "Each seat needs its own id.");
              else seatIds.add(seatId);
              const seatLabel = cleanSeatMapLabel(rawSeat.label, SEAT_LABEL_MAX);
              if (!seatLabel) errors.add(`${kp}.label`, labelMessage(SEAT_LABEL_MAX));
              else if (seatLabels.has(seatLabel.toLowerCase())) errors.add(`${kp}.label`, `Seat ${seatLabel} is used twice in this row.`);
              else seatLabels.add(seatLabel.toLowerCase());
              const x = coordinate(rawSeat.x, 0, w);
              const y = coordinate(rawSeat.y, 0, h);
              if (x === undefined || y === undefined) errors.add(kp, "The seat must be on the map.");
              const rotation =
                rawSeat.rotation === undefined || rawSeat.rotation === null ? 0 : coordinate(rawSeat.rotation, -180, 180);
              if (rotation === undefined) errors.add(`${kp}.rotation`, "Degrees from -180 to 180.");
              const tier = typeof rawSeat.ticketTypeId === "string" ? rawSeat.ticketTypeId : undefined;
              if (!tier || tier.length > 100 || (knownTiers && !knownTiers.has(tier))) {
                errors.add(`${kp}.ticketTypeId`, "Choose one of the event's ticket types.");
              }
              const kind = rawSeat.kind === undefined || rawSeat.kind === null ? "standard" : rawSeat.kind;
              if (!SEAT_KINDS.includes(kind as SeatKind)) errors.add(`${kp}.kind`, "Standard, wheelchair or companion.");
              if (rawSeat.blocked !== undefined && rawSeat.blocked !== null && typeof rawSeat.blocked !== "boolean") {
                errors.add(`${kp}.blocked`, "Must be true or false.");
              }
              const blocked = rawSeat.blocked === true;
              if (tier) {
                tiersUsed.add(tier);
                if (!blocked) unblockedByTier.set(tier, (unblockedByTier.get(tier) ?? 0) + 1);
              }
              if (seatId && seatLabel && x !== undefined && y !== undefined && rotation !== undefined && tier) {
                seats.push({
                  id: seatId,
                  label: seatLabel,
                  x,
                  y,
                  ticketTypeId: tier,
                  ...(rotation !== 0 ? { rotation } : {}),
                  ...(kind !== "standard" ? { kind: kind as SeatKind } : {}),
                  ...(blocked ? { blocked: true } : {}),
                });
              }
            });
          }
          if (rowLabel !== undefined && seats.length > 0) {
            const first = seats[0];
            const last = seats[seats.length - 1];
            rows.push({
              label: rowLabel,
              ends: ends ?? [
                { x: first.x, y: first.y },
                { x: last.x, y: last.y },
              ],
              seats,
            });
          }
        });
      }
      if (id && label) {
        const all = rows.flatMap((r) => r.seats);
        const anchor =
          labelAnchor ??
          (all.length > 0
            ? {
                x: round2(clamp(all.reduce((sum, seat) => sum + seat.x, 0) / all.length, 0, w)),
                y: round2(clamp(Math.min(...all.map((seat) => seat.y)) - ROW_PITCH, 0, h)),
              }
            : { x: 0, y: 0 });
        sections.push({ id, label, labelAnchor: anchor, rows });
      }
    });
  }

  if (tiersUsed.size > MAX_SEATED_TIERS) {
    errors.add("sections", `A seat map can use up to ${MAX_SEATED_TIERS} price tiers. This one uses ${tiersUsed.size}.`);
  }
  // A ticket type's capacity is its seats that aren't blocked: it needs at least one.
  for (const tier of tiersUsed) {
    if (!unblockedByTier.has(tier)) errors.add("sections", `Every ticket type on the map needs at least one seat that isn't blocked ("${tier}").`);
  }

  if (!errors.empty || !focus || width === undefined || height === undefined) {
    return { ok: false, errors: errors.empty ? { template: "Invalid seat map." } : errors.map };
  }
  return { ok: true, template: { width, height, focus, ...(stage ? { stage } : {}), sections }, seatCount };
}
