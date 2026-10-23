import { describe, expect, it } from "vitest";
import {
  addSection,
  alignSeats,
  deleteSeats,
  emptyTemplate,
  issuesFor,
  moveSeats,
  parseImport,
  relabelSeats,
  rowLabel,
  seatLabels,
  templateStats,
  updateSeats,
  type SectionGeneratorOptions,
} from "@/lib/seating/editing";
import { flattenSeats, validateSeatMapTemplate } from "@/lib/seating/template";

const base: Omit<SectionGeneratorOptions, "origin"> = {
  shape: "rect",
  name: "Stalls",
  rows: 3,
  seatsPerRow: 4,
  rowLabels: "alpha",
  rowOrder: "front-to-back",
  seatNumbering: "ltr",
  firstSeat: 1,
  ticketTypeId: "ga",
};

describe("seat-map generators (docs/design/seating.md §5.13)", () => {
  it("labels rows A…Z then AA, or with numbers", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map((i) => rowLabel(i, "alpha"))).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
    expect(rowLabel(4, "numeric")).toBe("5");
  });

  it("numbers seats left to right, right to left, or odd left and even right", () => {
    expect(seatLabels(4, "ltr", 1)).toEqual(["1", "2", "3", "4"]);
    expect(seatLabels(4, "rtl", 10)).toEqual(["13", "12", "11", "10"]);
    expect(seatLabels(6, "odd-even")).toEqual(["5", "3", "1", "2", "4", "6"]);
    expect(seatLabels(5, "odd-even")).toEqual(["5", "3", "1", "2", "4"]);
  });

  it("makes a rectangular section the API accepts, front row nearest the stage", () => {
    const { template } = addSection(emptyTemplate(), { ...base, origin: { x: 300, y: 160 } });
    const result = validateSeatMapTemplate(template, { ticketTypeIds: ["ga"] });
    expect(result.ok).toBe(true);
    const seats = flattenSeats(template);
    expect(seats).toHaveLength(12);
    const rowA = seats.filter((s) => s.row === "A");
    const rowC = seats.filter((s) => s.row === "C");
    expect(rowA[0].y).toBeLessThan(rowC[0].y);
    expect(rowA.map((s) => s.seat)).toEqual(["1", "2", "3", "4"]);
  });

  it("makes a curved section facing the centre, inside the canvas", () => {
    const start = emptyTemplate();
    const { template } = addSection(start, { ...base, shape: "curved", origin: start.focus, arcDegrees: 90, radius: 160 });
    expect(validateSeatMapTemplate(template, { ticketTypeIds: ["ga"] }).ok).toBe(true);
    const seats = flattenSeats(template);
    expect(seats.every((s) => s.x >= 0 && s.y >= 0 && s.x <= template.width && s.y <= template.height)).toBe(true);
    // The ends of a row turn towards the centre; the middle of an even row is off-axis either side.
    const row = seats.filter((s) => s.row === "A");
    expect(row[0].rotation).toBeGreaterThan(0);
    expect(row[row.length - 1].rotation).toBeLessThan(0);
  });

  it("back to front puts row A at the back", () => {
    const { template } = addSection(emptyTemplate(), { ...base, rowOrder: "back-to-front", origin: { x: 300, y: 160 } });
    const seats = flattenSeats(template);
    const a = seats.find((s) => s.row === "A");
    const c = seats.find((s) => s.row === "C");
    expect(a && c && a.y > c.y).toBe(true);
  });

  it("gives every seat and section a unique id across sections with the same name pattern", () => {
    let { template } = addSection(emptyTemplate(), { ...base, origin: { x: 300, y: 160 } });
    ({ template } = addSection(template, { ...base, name: "Stalls 2", origin: { x: 300, y: 300 } }));
    const ids = flattenSeats(template).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateSeatMapTemplate(template, { ticketTypeIds: ["ga"] }).ok).toBe(true);
  });
});

describe("seat edits", () => {
  const { template } = addSection(emptyTemplate(), { ...base, origin: { x: 300, y: 160 } });
  const seats = flattenSeats(template);
  const rowA = new Set(seats.filter((s) => s.row === "A").map((s) => s.id));

  it("sets tier, kind and blocked, storing defaults as absent", () => {
    const one = new Set([seats[0].id]);
    let next = updateSeats(template, one, { kind: "wheelchair", blocked: true, ticketTypeId: "vip" });
    expect(flattenSeats(next)[0]).toMatchObject({ kind: "wheelchair", blocked: true, ticketTypeId: "vip" });
    next = updateSeats(next, one, { kind: "standard", blocked: false });
    const raw = next.sections[0].rows[0].seats[0];
    expect(raw).not.toHaveProperty("kind");
    expect(raw).not.toHaveProperty("blocked");
    expect(templateStats(updateSeats(template, rowA, { blocked: true })).total).toMatchObject({ seats: 12, blocked: 4 });
  });

  it("moves (snapped to 4u), aligns and deletes, dropping empty rows", () => {
    const moved = flattenSeats(moveSeats(template, new Set([seats[0].id]), 5, 3))[0];
    expect(moved.x % 4).toBe(0);
    expect(moved.y % 4).toBe(0);
    const aligned = flattenSeats(alignSeats(template, new Set([seats[0].id, seats[5].id])));
    expect(aligned[0].y).toBe(aligned[5].y);
    const gone = deleteSeats(template, rowA);
    expect(gone.sections[0].rows.map((r) => r.label)).toEqual(["B", "C"]);
  });

  it("relabels one row's seats in order across the map, and refuses seats from two rows", () => {
    const next = relabelSeats(template, rowA, { rowLabel: "AA", firstSeat: 101, direction: "rtl" });
    const row = next?.sections[0].rows[0];
    expect(row?.label).toBe("AA");
    expect(row?.seats.map((s) => s.label)).toEqual(["104", "103", "102", "101"]);
    expect(relabelSeats(template, new Set([seats[0].id, seats[4].id]), { firstSeat: 1, direction: "ltr" })).toBeNull();
  });

  it("lists what the API would refuse, with the seats concerned", () => {
    const dup = updateSeats(template, new Set([seats[1].id]), { label: "1" });
    const issues = issuesFor(dup, ["ga"]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/used twice/);
    expect(issues[0].seatIds).toEqual([seats[1].id]);
    expect(issuesFor(template, ["other"])[0].message).toMatch(/ticket types/);
    expect(issuesFor(template, ["ga"])).toEqual([]);
  });
});

describe("import", () => {
  const { template } = addSection(emptyTemplate(), { ...base, origin: { x: 300, y: 160 } });

  it("accepts an exported map (or a seat-map record) and refuses bad JSON with paths", () => {
    const ok = parseImport(JSON.stringify(template), ["ga"]);
    expect(ok).toMatchObject({ ok: true, seatCount: 12 });
    expect(parseImport(JSON.stringify({ eventId: "e", version: 3, seatCount: 12, template }), ["ga"]).ok).toBe(true);
    expect(parseImport("{nope", ["ga"])).toEqual({ ok: false, errors: ["The file isn’t valid JSON."], more: 0 });
    const bad = parseImport(JSON.stringify(template), ["other"]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.length).toBeLessThanOrEqual(10);
      expect(bad.errors[0]).toMatch(/^sections\[0\]\.rows\[0\]\.seats\[0\]\.ticketTypeId: /);
      expect(bad.more).toBeGreaterThan(0);
    }
  });
});
