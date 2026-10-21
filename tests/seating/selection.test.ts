import { describe, expect, it } from "vitest";
import { calculateOrderSummary, sumOrderSummaries } from "@/lib/fees";
import { SAMPLE_SEAT_MAPS } from "@/lib/sample-seat-maps";
import {
  findBestSeats,
  generalAdmissionTiers,
  seatedTiers,
  seatOrderSummary,
  sortSeats,
  tierTreatments,
} from "@/lib/seating/selection";
import { flattenSeats } from "@/lib/seating/template";
import type { TicketType } from "@/lib/types";

const tier = (id: string, priceCents: number, feePolicy: TicketType["feePolicy"] = "buyer-pays"): TicketType => ({
  id,
  name: id,
  priceCents,
  feePolicy,
  quantityAvailable: 100,
});

describe("tier patterns (docs/design/seating.md §2.2)", () => {
  it("gives the patterns cheapest (all-inclusive) first, per the table for that many tiers", () => {
    const treatments = (n: number) => [...tierTreatments(Array.from({ length: n }, (_, i) => tier(`t${i}`, (i + 1) * 1000))).values()];
    expect(treatments(1)).toEqual(["outline"]);
    expect(treatments(2)).toEqual(["outline", "solid"]);
    expect(treatments(3)).toEqual(["outline", "hatch", "solid"]);
    expect(treatments(4)).toEqual(["outline", "dots", "cross", "solid"]);
    expect(treatments(5)).toEqual(["outline", "dots", "hatch", "cross", "solid"]);
  });

  it("sorts the map's tiers by what buyers pay, so an absorbed fee can make a dearer face value cheaper", () => {
    const { template } = SAMPLE_SEAT_MAPS["evt-off-kilter"];
    const full = tier("off-kilter-full", 3500);
    const concession = tier("off-kilter-concession", 2500);
    const standing = tier("standing", 1000);
    expect(seatedTiers([full, standing, concession], template).map((t) => t.id)).toEqual(["off-kilter-concession", "off-kilter-full"]);
    expect(generalAdmissionTiers([full, standing, concession], template).map((t) => t.id)).toEqual(["standing"]);
    // A$26 absorbed (buyer pays A$26.00) is cheaper than A$25 + fee (A$26.50).
    expect(seatedTiers([tier("a", 2500), tier("b", 2600, "organiser-absorbs")], {
      ...template,
      sections: [{ ...template.sections[0], rows: [{ ...template.sections[0].rows[0], seats: [
        { ...template.sections[0].rows[0].seats[0], ticketTypeId: "a" },
        { ...template.sections[0].rows[0].seats[1], ticketTypeId: "b" },
      ] }] }],
    }).map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("seat order totals (lib/fees.ts only)", () => {
  it("adds one ticket per seat at its tier's price and fee, plus general admission lines", () => {
    const full = tier("full", 3500);
    const conc = tier("conc", 2500);
    const ga = tier("ga", 2000, "organiser-absorbs");
    const tiers = new Map([full, conc].map((t) => [t.id, t]));
    const total = seatOrderSummary([{ ticketTypeId: "full" }, { ticketTypeId: "full" }, { ticketTypeId: "conc" }], tiers, [
      { ticket: ga, quantity: 2 },
    ]);
    expect(total).toEqual(
      sumOrderSummaries([
        calculateOrderSummary(3500, 2, "buyer-pays"),
        calculateOrderSummary(2500, 1, "buyer-pays"),
        calculateOrderSummary(2000, 2, "organiser-absorbs"),
      ]),
    );
    // A$36.90 × 2 + A$26.50 + A$40.00.
    expect(total.totalCents).toBe(3690 * 2 + 2650 + 4000);
  });
});

describe("Find seats (§5.9)", () => {
  const sample = SAMPLE_SEAT_MAPS["evt-off-kilter"];
  const seats = flattenSeats(sample.template);
  const taken = new Set(sample.unavailable);
  const isUnavailable = (p: number) => taken.has(p);

  it("finds adjacent free seats in one row nearest the focus point, earlier rows winning ties", () => {
    const found = findBestSeats(sample.template, seats, { count: 2, isUnavailable });
    expect(found?.map((s) => s.id)).toEqual(["N-A1", "N-A2"]);
    const three = findBestSeats(sample.template, seats, { count: 3, isUnavailable });
    expect(three?.every((s) => s.row === three[0].row && s.sectionId === three[0].sectionId)).toBe(true);
    expect(three?.some((s) => taken.has(s.position))).toBe(false);
  });

  it("keeps to one price when asked, and never suggests wheelchair or companion seats", () => {
    const conc = findBestSeats(sample.template, seats, { count: 2, ticketTypeId: "off-kilter-concession", isUnavailable });
    expect(conc?.every((s) => s.ticketTypeId === "off-kilter-concession")).toBe(true);
    for (let n = 1; n <= 5; n += 1) {
      const found = findBestSeats(sample.template, seats, { count: n, isUnavailable: () => false }) ?? [];
      expect(found.every((s) => s.kind === "standard")).toBe(true);
    }
  });

  it("says none when no row has that many together", () => {
    expect(findBestSeats(sample.template, seats, { count: 6, isUnavailable })).toBeNull();
    expect(findBestSeats(sample.template, seats, { count: 1, isUnavailable: () => true })).toBeNull();
  });

  it("sorts seats by section, row, then seat", () => {
    const picked = ["W-A2", "E-B1", "E-A10", "E-A2"].map((id) => ({ ...seats[0], id, section: id[0], row: id[2], seat: id.slice(3) }));
    expect(sortSeats(picked).map((s) => s.id)).toEqual(["E-A2", "E-A10", "E-B1", "W-A2"]);
  });
});
