import { describe, expect, it } from "vitest";
import { SAMPLE_SEAT_MAPS } from "@/lib/sample-seat-maps";
import {
  flattenSeats,
  MAX_SEATED_TIERS,
  MAX_SEATS_PER_MAP,
  validateSeatMapTemplate,
  type SeatMapTemplate,
} from "@/lib/seating/template";

function seat(id: string, label: string, x: number, y: number, ticketTypeId = "std", extra: Record<string, unknown> = {}) {
  return { id, label, x, y, ticketTypeId, ...extra };
}

function map(overrides: Record<string, unknown> = {}) {
  return {
    width: 400,
    height: 300,
    focus: { x: 200, y: 20 },
    stage: { label: "Stage", x: 100, y: 0, width: 200, height: 40 },
    sections: [
      {
        id: "stalls",
        label: "Stalls",
        rows: [
          { label: "A", seats: [seat("A1", "1", 100, 100), seat("A2", "2", 128, 100, "prem")] },
          { label: "B", seats: [seat("B1", "1", 100, 132), seat("B2", "2", 128, 132, "std", { kind: "wheelchair" })] },
        ],
      },
    ],
    ...overrides,
  };
}

describe("validateSeatMapTemplate", () => {
  it("accepts a map and normalises it: defaults left out, anchors and row ends filled in", () => {
    const result = validateSeatMapTemplate(
      map({ extra: "dropped", sections: [{ ...map().sections[0], label: "  Stalls ", junk: 1 }] }),
      { ticketTypeIds: ["std", "prem"] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seatCount).toBe(4);
    const t = result.template;
    expect(Object.keys(t).sort()).toEqual(["focus", "height", "sections", "stage", "width"]);
    expect(t.sections[0].label).toBe("Stalls");
    expect(t.sections[0]).not.toHaveProperty("junk");
    // Centred over the seats, one row pitch above the front row.
    expect(t.sections[0].labelAnchor).toEqual({ x: 114, y: 68 });
    expect(t.sections[0].rows[0].ends).toEqual([
      { x: 100, y: 100 },
      { x: 128, y: 100 },
    ]);
    expect(t.sections[0].rows[0].seats[0]).toEqual({ id: "A1", label: "1", x: 100, y: 100, ticketTypeId: "std" });
    expect(t.sections[0].rows[1].seats[1]).toMatchObject({ kind: "wheelchair" });
    // Validating the normalised map again changes nothing.
    const again = validateSeatMapTemplate(t, { ticketTypeIds: ["std", "prem"] });
    expect(again).toEqual(result);
  });

  it("gives every seat its position in map order", () => {
    const result = validateSeatMapTemplate(map());
    if (!result.ok) throw new Error("invalid");
    expect(flattenSeats(result.template).map((s) => [s.position, s.id, s.section, s.row, s.seat, s.kind])).toEqual([
      [0, "A1", "Stalls", "A", "1", "standard"],
      [1, "A2", "Stalls", "A", "2", "standard"],
      [2, "B1", "Stalls", "B", "1", "standard"],
      [3, "B2", "Stalls", "B", "2", "wheelchair"],
    ]);
  });

  it("refuses seats of a ticket type the event doesn't have", () => {
    const result = validateSeatMapTemplate(map(), { ticketTypeIds: ["std"] });
    expect(result).toEqual({ ok: false, errors: { "sections[0].rows[0].seats[1].ticketTypeId": expect.any(String) } });
  });

  it("refuses duplicate ids and labels, bad labels and seats off the map", () => {
    const bad = map({
      sections: [
        {
          id: "s",
          label: "Stalls",
          rows: [
            { label: "A", seats: [seat("A1", "1", 10, 10), seat("A1", "1", 20, 10), seat("A3", "3", 500, 10)] },
            { label: "a", seats: [seat("x", " ", 10, 40)] },
            { label: "C‮", seats: [seat("y", "1", 10, 70)] },
          ],
        },
        { id: "s", label: "stalls", rows: [{ label: "A", seats: [seat("z", "1", 10, 100)] }] },
      ],
    });
    const result = validateSeatMapTemplate(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      "sections[0].rows[0].seats[1].id",
      "sections[0].rows[0].seats[1].label",
      "sections[0].rows[0].seats[2]",
      "sections[0].rows[1].label",
      "sections[0].rows[1].seats[0].label",
      "sections[0].rows[2].label",
      "sections[1].id",
      "sections[1].label",
    ]);
  });

  it("allows one unnamed row per section", () => {
    const ok = validateSeatMapTemplate(map({ sections: [{ id: "box", label: "Box A", rows: [{ label: "", seats: [seat("b1", "1", 10, 10)] }] }] }));
    expect(ok.ok).toBe(true);
    const twice = validateSeatMapTemplate(
      map({ sections: [{ id: "box", label: "Box A", rows: [{ seats: [seat("b1", "1", 10, 10)] }, { label: "", seats: [seat("b2", "1", 10, 40)] }] }] }),
    );
    expect(twice.ok).toBe(false);
  });

  it("needs an unblocked seat in every tier it uses (a tier's capacity is its unblocked seats)", () => {
    const result = validateSeatMapTemplate(
      map({ sections: [{ id: "s", label: "S", rows: [{ label: "A", seats: [seat("a", "1", 10, 10, "std", { blocked: true }), seat("b", "2", 40, 10, "prem")] }] }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.sections).toContain("std");
  });

  it(`uses at most ${MAX_SEATED_TIERS} price tiers`, () => {
    const seats = Array.from({ length: MAX_SEATED_TIERS + 1 }, (_, i) => seat(`s${i}`, String(i + 1), 10 + i * 28, 10, `t${i}`));
    const result = validateSeatMapTemplate(map({ sections: [{ id: "s", label: "S", rows: [{ label: "A", seats }] }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.sections).toMatch(/up to 5 price tiers/);
    const five = validateSeatMapTemplate(map({ sections: [{ id: "s", label: "S", rows: [{ label: "A", seats: seats.slice(0, 5) }] }] }));
    expect(five.ok).toBe(true);
  });

  it(`stops at ${MAX_SEATS_PER_MAP.toLocaleString("en-AU")} seats`, () => {
    const rows = Array.from({ length: 21 }, (_, r) => ({
      label: `R${r}`,
      seats: Array.from({ length: 500 }, (_, i) => seat(`r${r}s${i}`, String(i + 1), i, r)),
    }));
    const result = validateSeatMapTemplate({ width: 10000, height: 10000, focus: { x: 0, y: 0 }, sections: [{ id: "s", label: "S", rows }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.sections).toMatch(/10,000 seats/);
  });

  it("refuses things that aren't maps", () => {
    for (const raw of [null, [], "map", 3]) expect(validateSeatMapTemplate(raw)).toEqual({ ok: false, errors: { template: "Send a seat map." } });
    const noFocus = validateSeatMapTemplate(map({ focus: { x: 1000, y: 0 } }));
    expect(noFocus.ok).toBe(false);
    const nan = validateSeatMapTemplate(map({ width: Number.NaN }));
    expect(nan.ok).toBe(false);
  });

  it("the demo's seated sample is a valid map with the sample's capacities", () => {
    const sample = SAMPLE_SEAT_MAPS["evt-off-kilter"];
    const result = validateSeatMapTemplate(sample.template, { ticketTypeIds: ["off-kilter-full", "off-kilter-concession"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seatCount).toBe(sample.seatCount);
    expect(result.template).toEqual(sample.template satisfies SeatMapTemplate);
    const seats = flattenSeats(result.template);
    expect(seats.filter((s) => s.ticketTypeId === "off-kilter-full")).toHaveLength(45);
    expect(seats.filter((s) => s.ticketTypeId === "off-kilter-concession")).toHaveLength(15);
    expect(seats.filter((s) => s.kind === "wheelchair")).toHaveLength(1);
    expect(sample.unavailable.every((p) => p >= 0 && p < sample.seatCount)).toBe(true);
  });
});
