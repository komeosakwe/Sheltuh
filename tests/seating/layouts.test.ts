import { describe, expect, it } from "vitest";
import { issuesFor } from "@/lib/seating/editing";
import { buildSeatLayout, getSeatLayout, LAYOUT_SEAT_TARGET, layoutPreview, SEAT_LAYOUTS, type SeatLayoutId } from "@/lib/seating/layouts";
import {
  flattenSeats,
  MAX_MAP_DIMENSION,
  MAX_ROWS_PER_SECTION,
  MAX_SEATS_PER_MAP,
  MAX_SEATS_PER_ROW,
  MAX_SECTIONS,
  SEAT_PITCH,
  SEAT_SIZE,
  validateSeatMapTemplate,
  type SeatMapTemplate,
} from "@/lib/seating/template";

const TIER = "tt-standard";
const targets = [Number.NaN, 1, LAYOUT_SEAT_TARGET.min, 40, LAYOUT_SEAT_TARGET.initial, 500, LAYOUT_SEAT_TARGET.max, 50_000];

function build(id: SeatLayoutId, seats: number, ticketTypeId = TIER): SeatMapTemplate {
  return buildSeatLayout(id, { seats, ticketTypeId });
}

describe("ready-made seat layouts (lib/seating/layouts.ts)", () => {
  it("offers the five layouts the map model can draw, and no tables", () => {
    expect(SEAT_LAYOUTS.map((l) => l.name)).toEqual([
      "Rows facing a stage",
      "Theatre with a centre aisle",
      "Stalls and side sections",
      "Curved rows",
      "Small room",
    ]);
    expect(SEAT_LAYOUTS.some((l) => /table|cabaret/i.test(`${l.name} ${l.description}`))).toBe(false);
    expect(() => getSeatLayout("cabaret" as SeatLayoutId)).toThrow();
  });

  for (const layout of SEAT_LAYOUTS) {
    describe(layout.name, () => {
      it("passes the API's validator at every size, inside every limit, on the chosen tier", () => {
        for (const target of targets) {
          const map = build(layout.id, target);
          const result = validateSeatMapTemplate(map, { ticketTypeIds: [TIER, "other"] });
          expect(result.ok, `${layout.id} @ ${target}: ${JSON.stringify(result.ok ? "" : result.errors)}`).toBe(true);
          expect(issuesFor(map, [TIER])).toEqual([]);
          const seats = flattenSeats(map);
          expect(seats.length).toBeGreaterThanOrEqual(layout.seats.min * 0.9);
          expect(seats.length).toBeLessThanOrEqual(Math.min(MAX_SEATS_PER_MAP, Math.ceil(layout.seats.max * 1.02)));
          expect(map.sections.length).toBeLessThanOrEqual(MAX_SECTIONS);
          for (const section of map.sections) {
            expect(section.rows.length).toBeLessThanOrEqual(Math.min(MAX_ROWS_PER_SECTION, 50));
            for (const row of section.rows) expect(row.seats.length).toBeLessThanOrEqual(Math.min(MAX_SEATS_PER_ROW, 80));
          }
          expect(map.width).toBeLessThanOrEqual(MAX_MAP_DIMENSION);
          expect(map.height).toBeLessThanOrEqual(MAX_MAP_DIMENSION);
          expect(new Set(seats.map((s) => s.ticketTypeId))).toEqual(new Set([TIER]));
          // Ids unique across seats and sections.
          const ids = [...map.sections.map((s) => s.id), ...seats.map((s) => s.id)];
          expect(new Set(ids).size).toBe(ids.length);
        }
      });

      it("scales towards the asked-for number of seats, within its own range", () => {
        let previous = 0;
        for (const target of [layout.seats.min, 40, 100, 150, 300, 600, 1000, 2000]) {
          const count = flattenSeats(build(layout.id, target)).length;
          const expected = Math.min(Math.max(target, layout.seats.min), layout.seats.max);
          expect(Math.abs(count - expected) / expected, `${layout.id} @ ${target}: ${count}`).toBeLessThanOrEqual(0.15);
          expect(count).toBeGreaterThanOrEqual(previous);
          previous = count;
        }
      });

      it("puts two wheelchair spaces, each with a companion seat beside it, in the front row", () => {
        for (const target of [layout.seats.min, LAYOUT_SEAT_TARGET.initial, 1000]) {
          const map = build(layout.id, target);
          const seats = flattenSeats(map);
          const wheelchair = seats.filter((s) => s.kind === "wheelchair");
          const companion = seats.filter((s) => s.kind === "companion");
          expect(wheelchair).toHaveLength(2);
          expect(companion).toHaveLength(2);
          for (const space of wheelchair) {
            expect(space.row).toBe("A");
            const beside = companion.filter((c) => c.sectionId === space.sectionId && c.row === "A" && Math.hypot(c.x - space.x, c.y - space.y) <= SEAT_PITCH * 1.5);
            expect(beside.length).toBeGreaterThanOrEqual(1);
          }
        }
      });

      it("has a stage, with the focus point at its centre, and no seat overlapping it or another seat", () => {
        const map = build(layout.id, 500);
        const stage = map.stage;
        expect(stage).toBeDefined();
        if (!stage) return;
        expect(map.focus).toEqual({ x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 });
        const seats = flattenSeats(map);
        const half = SEAT_SIZE / 2;
        // The stage clears every seat at any size (curved rows wrap round it).
        for (const target of [layout.seats.min, LAYOUT_SEAT_TARGET.initial, layout.seats.max]) {
          const other = build(layout.id, target);
          const s = other.stage;
          if (!s) throw new Error("no stage");
          for (const seat of flattenSeats(other)) {
            const off = seat.x + half <= s.x || seat.x - half >= s.x + s.width || seat.y + half <= s.y || seat.y - half >= s.y + s.height;
            expect(off, `${layout.id} @ ${target}: ${seat.id} on the stage`).toBe(true);
          }
        }
        for (const seat of seats) {
          const clear =
            seat.x + half <= stage.x || seat.x - half >= stage.x + stage.width || seat.y + half <= stage.y || seat.y - half >= stage.y + stage.height;
          expect(clear, `${seat.id} on the stage`).toBe(true);
          expect(seat.x).toBeGreaterThanOrEqual(half);
          expect(seat.y).toBeGreaterThanOrEqual(half);
        }
        for (let i = 0; i < seats.length; i += 1) {
          for (let j = i + 1; j < seats.length; j += 1) {
            expect(Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y)).toBeGreaterThanOrEqual(SEAT_SIZE - 0.01);
          }
        }
      });

      it("keeps seats in a row next to each other (Find seats can pair them), except across an aisle", () => {
        const map = build(layout.id, LAYOUT_SEAT_TARGET.initial);
        const runs = layoutPreview(map).runs;
        const rows = map.sections.reduce((n, s) => n + s.rows.length, 0);
        expect(runs.length).toBe(layout.id === "centre-aisle" ? rows * 2 : rows);
        for (const run of runs) {
          for (let i = 1; i < run.length; i += 1) {
            expect(Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y)).toBeLessThanOrEqual(SEAT_PITCH * 1.5);
          }
        }
      });
    });
  }

  it("small room: 4 rows of 10 for about 40, at most 96", () => {
    const map = build("small-room", 40);
    expect(map.sections[0].rows.map((r) => r.seats.length)).toEqual([10, 10, 10, 10]);
    expect(map.sections[0].rows.map((r) => r.label)).toEqual(["A", "B", "C", "D"]);
    expect(flattenSeats(build("small-room", 2000))).toHaveLength(96);
  });

  it("centre aisle: one section, each row split by an aisle, numbered straight across", () => {
    const map = build("centre-aisle", 40);
    expect(map.sections).toHaveLength(1);
    const row = map.sections[0].rows[0];
    expect(row.seats.map((s) => s.label)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    const gaps = row.seats.slice(1).map((s, i) => s.x - row.seats[i].x);
    expect(gaps.filter((g) => g > SEAT_PITCH * 1.5)).toHaveLength(1);
    // The wheelchair spaces are on the aisle.
    expect(row.seats.filter((s) => s.kind === "wheelchair").map((s) => s.label)).toEqual(["5", "6"]);
  });

  it("stalls and side sections: Left, Stalls and Right, the sides turned towards the stage", () => {
    const map = build("stalls-sides", 300);
    expect(map.sections.map((s) => s.label)).toEqual(["Left", "Stalls", "Right"]);
    const rotations = map.sections.map((s) => new Set(s.rows.flatMap((r) => r.seats.map((seat) => seat.rotation ?? 0))));
    expect([...rotations[0]]).toEqual([20]);
    expect([...rotations[1]]).toEqual([0]);
    expect([...rotations[2]]).toEqual([-20]);
  });

  it("curved rows: longer towards the back, each seat turned to face the stage", () => {
    const map = build("curved", 300);
    const lengths = map.sections[0].rows.map((r) => r.seats.length);
    for (let i = 1; i < lengths.length; i += 1) expect(lengths[i]).toBeGreaterThanOrEqual(lengths[i - 1]);
    expect(lengths[lengths.length - 1]).toBeGreaterThan(lengths[0]);
    const front = map.sections[0].rows[0].seats;
    expect(front[0].rotation).toBeGreaterThan(0);
    expect(front[front.length - 1].rotation).toBeLessThan(0);
  });

  it("uses the tier it's given, and is the same map each time", () => {
    const a = build("stage", 120, "vip");
    expect(flattenSeats(a).every((s) => s.ticketTypeId === "vip")).toBe(true);
    expect(build("stage", 120, "vip")).toEqual(a);
  });
});
