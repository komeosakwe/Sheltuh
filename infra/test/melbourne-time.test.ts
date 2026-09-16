import { describe, expect, it } from "vitest";
import { melbourneLocalToUtcIso } from "../lambda/shared/melbourne-time";

describe("melbourneLocalToUtcIso", () => {
  it("converts an AEST (winter) local time to UTC (+10)", () => {
    expect(melbourneLocalToUtcIso("2026-09-25", "20:00")).toBe("2026-09-25T10:00:00.000Z");
  });

  it("converts an AEDT (daylight saving) local time to UTC (+11)", () => {
    expect(melbourneLocalToUtcIso("2026-10-08", "19:00")).toBe("2026-10-08T08:00:00.000Z");
  });

  it("rolls over to the previous UTC calendar day when the offset requires it", () => {
    // 10:00am AEDT on Nov 21 is 11:00pm UTC on Nov 20.
    expect(melbourneLocalToUtcIso("2026-11-21", "10:00")).toBe("2026-11-20T23:00:00.000Z");
  });

  it("throws on an invalid date/time", () => {
    expect(() => melbourneLocalToUtcIso("not-a-date", "10:00")).toThrow(RangeError);
  });
});
