import { describe, expect, it } from "vitest";
import { compareSeats, formatSeatLine, speakSeatLine } from "@/lib/seating/format";

describe("seat wording (docs/design/seating.md §5.15)", () => {
  it("says a seat the same way everywhere", () => {
    expect(formatSeatLine({ section: "Stalls", row: "F", seat: "12" })).toBe("Stalls · Row F · Seat 12");
    expect(speakSeatLine({ section: "Stalls", row: "F", seat: "12" })).toBe("Stalls, Row F, Seat 12");
    expect(formatSeatLine({ section: "Box A", row: "", seat: "3" })).toBe("Box A · Seat 3");
    expect(formatSeatLine({ section: "Stalls", row: "F", seat: "3", kind: "wheelchair" })).toBe("Stalls · Row F · Wheelchair space 3");
    expect(formatSeatLine({ section: "Stalls", row: "F", seat: "4", kind: "companion" })).toBe("Stalls · Row F · Seat 4");
  });

  it("sorts by section, row, then seat, numbers as numbers", () => {
    const seats = [
      { section: "Stalls", row: "B", seat: "10" },
      { section: "Circle", row: "A", seat: "1" },
      { section: "Stalls", row: "B", seat: "2" },
      { section: "Stalls", row: "A", seat: "5" },
    ];
    expect([...seats].sort(compareSeats).map(formatSeatLine)).toEqual([
      "Circle · Row A · Seat 1",
      "Stalls · Row A · Seat 5",
      "Stalls · Row B · Seat 2",
      "Stalls · Row B · Seat 10",
    ]);
  });
});
