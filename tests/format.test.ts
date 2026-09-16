import { describe, expect, it } from "vitest";
import { formatEventDateKey, formatEventDateShort, formatEventDateTimeRange, formatEventTime } from "../lib/format";

describe("Melbourne date/time formatting (real UTC instants, AEST/AEDT-aware)", () => {
  it("formats an AEST (winter) instant as Melbourne local time", () => {
    // 2026-09-25T10:00:00Z is AEST (+10) -> 8:00pm local on the same UTC date.
    expect(formatEventDateShort("2026-09-25T10:00:00.000Z")).toBe("Fri 25 Sept");
    expect(formatEventTime("2026-09-25T10:00:00.000Z")).toBe("8:00 pm");
  });

  it("formats an AEDT (daylight saving) instant as Melbourne local time", () => {
    // 2026-10-08T08:00:00Z is AEDT (+11) -> 7:00pm local.
    expect(formatEventDateShort("2026-10-08T08:00:00.000Z")).toBe("Thu 8 Oct");
    expect(formatEventTime("2026-10-08T08:00:00.000Z")).toBe("7:00 pm");
  });

  it("renders a same-day range without repeating the date", () => {
    // Paper Moon Ceramics Lab: 10:00am - 1:00pm AEST, same Melbourne day.
    expect(formatEventDateTimeRange("2026-10-03T00:00:00.000Z", "2026-10-03T03:00:00.000Z")).toBe(
      "Sat 3 Oct, 10:00 am – 1:00 pm",
    );
  });

  it("spells out the end date when the Melbourne-local day changes", () => {
    // Neon Static: 8:00pm Fri 25 Sep AEST through to 12:00am Sat 26 Sep.
    expect(formatEventDateTimeRange("2026-09-25T10:00:00.000Z", "2026-09-25T14:00:00.000Z")).toBe(
      "Fri 25 Sept, 8:00 pm – Sat 26 Sept, 12:00 am",
    );
  });

  it("computes the Melbourne calendar day, which can differ from the UTC one", () => {
    // Analog Print Weekend start: 2026-11-20T23:00:00Z is 10:00am AEDT on Nov 21.
    expect(formatEventDateKey("2026-11-20T23:00:00.000Z")).toBe("2026-11-21");
  });
});
