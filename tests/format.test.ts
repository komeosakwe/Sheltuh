import { afterEach, describe, expect, it } from "vitest";
import {
  formatEventDateKey,
  formatEventDateShort,
  formatEventDateTimeRange,
  formatEventTime,
  toMelbourneDateTimeInputParts,
} from "../lib/format";

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

describe("toMelbourneDateTimeInputParts — ignores the runtime's own timezone", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("splits an AEST instant into Melbourne-local date/time input values", () => {
    // 2026-09-25T10:00:00Z is 8:00pm AEST (+10) on the same UTC calendar date.
    expect(toMelbourneDateTimeInputParts("2026-09-25T10:00:00.000Z")).toEqual({
      date: "2026-09-25",
      time: "20:00",
    });
  });

  it("splits an AEDT instant into Melbourne-local date/time input values", () => {
    // 2026-10-08T08:00:00Z is 7:00pm AEDT (+11).
    expect(toMelbourneDateTimeInputParts("2026-10-08T08:00:00.000Z")).toEqual({
      date: "2026-10-08",
      time: "19:00",
    });
  });

  it("rolls over to the next Melbourne calendar day near a UTC/local date boundary", () => {
    // 2026-11-20T23:00:00Z is 10:00am AEDT on Nov 21 — a different date than the UTC instant's.
    expect(toMelbourneDateTimeInputParts("2026-11-20T23:00:00.000Z")).toEqual({
      date: "2026-11-21",
      time: "10:00",
    });
  });

  it("produces the same result regardless of the browser/runtime's own timezone", () => {
    // The stored instant is a fixed point in time; only the *display* timezone
    // (always Australia/Melbourne here) may determine the date/time parts —
    // never process.env.TZ / the host's local zone. This is the exact bug:
    // the old isoToDateTimeParts used `new Date().getHours()` etc., which
    // read back in the browser's own zone instead of Melbourne's.
    const instant = "2026-09-25T10:00:00.000Z";
    const expected = { date: "2026-09-25", time: "20:00" };

    for (const tz of ["UTC", "America/New_York", "Pacific/Auckland", "Asia/Kolkata"]) {
      process.env.TZ = tz;
      expect(toMelbourneDateTimeInputParts(instant)).toEqual(expected);
    }
  });

  it("round-trips DST-adjacent dates (AEDT start, 2026-10-04 02:00 -> 03:00 local)", () => {
    // 2026-10-04T02:30:00Z is 1:30pm AEDT on Oct 4 (already past the 2am->3am
    // spring-forward, which happened at 2026-10-04T02:00:00Z in UTC-anchored
    // terms — see infra/lambda/shared/melbourne-time.ts for the inverse).
    expect(toMelbourneDateTimeInputParts("2026-10-04T02:30:00.000Z")).toEqual({
      date: "2026-10-04",
      time: "13:30",
    });
  });

  it("round-trips DST-adjacent dates (AEDT end, just after the fall-back)", () => {
    // 2026-04-04T16:00:00Z is 2:00am AEST on Apr 5, just after clocks fall
    // back from AEDT — still unambiguous as a UTC instant.
    expect(toMelbourneDateTimeInputParts("2026-04-04T16:00:00.000Z")).toEqual({
      date: "2026-04-05",
      time: "02:00",
    });
  });
});
