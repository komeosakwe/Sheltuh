import { describe, expect, it } from "vitest";
import { melbourneLocalToUtcIso } from "../lambda/shared/melbourne-time";

describe("melbourneLocalToUtcIso — normal (non-transition) conversions", () => {
  it("converts a winter (AEST, +10) local time to UTC", () => {
    expect(melbourneLocalToUtcIso("2026-09-25", "20:00")).toBe("2026-09-25T10:00:00.000Z");
  });

  it("converts a summer (AEDT, +11) local time to UTC", () => {
    expect(melbourneLocalToUtcIso("2026-10-08", "19:00")).toBe("2026-10-08T08:00:00.000Z");
  });

  it("rolls over to the previous UTC calendar day when the offset requires it", () => {
    expect(melbourneLocalToUtcIso("2026-11-21", "10:00")).toBe("2026-11-20T23:00:00.000Z");
  });

  it("round-trips a January (AEDT) and a June (AEST) date", () => {
    expect(melbourneLocalToUtcIso("2026-01-01", "10:00")).toBe("2025-12-31T23:00:00.000Z");
    expect(melbourneLocalToUtcIso("2026-06-15", "14:00")).toBe("2026-06-15T04:00:00.000Z");
  });
});

describe("melbourneLocalToUtcIso — spring-forward transition (2026-10-04, clocks 2:00am -> 3:00am)", () => {
  it("regression: a local time shortly before the transition no longer displays a day early", () => {
    // Previously buggy: 00:30 on transition day was misread using the AFTER
    // (AEDT) offset, silently producing an instant that displayed back in
    // Melbourne as 2026-10-03 23:30 — a full day/hour off from what was
    // entered. It must round-trip to itself.
    const iso = melbourneLocalToUtcIso("2026-10-04", "00:30");
    expect(iso).toBe("2026-10-03T14:30:00.000Z");
  });

  it("a local time just before midnight the night before is unaffected and distinct", () => {
    const iso = melbourneLocalToUtcIso("2026-10-03", "23:30");
    expect(iso).toBe("2026-10-03T13:30:00.000Z");
    // Must not collide with the 00:30 case above — each input has its own instant.
    expect(iso).not.toBe(melbourneLocalToUtcIso("2026-10-04", "00:30"));
  });

  it("rejects a local time that never exists in the spring-forward gap", () => {
    expect(() => melbourneLocalToUtcIso("2026-10-04", "02:30")).toThrow(RangeError);
    expect(() => melbourneLocalToUtcIso("2026-10-04", "02:00")).toThrow(RangeError);
    expect(() => melbourneLocalToUtcIso("2026-10-04", "02:59")).toThrow(RangeError);
  });

  it("accepts the instant exactly at and after the transition", () => {
    expect(melbourneLocalToUtcIso("2026-10-04", "03:00")).toBe("2026-10-03T16:00:00.000Z");
  });
});

describe("melbourneLocalToUtcIso — fall-back transition (2026-04-05, clocks 3:00am -> 2:00am)", () => {
  it("resolves an ambiguous local time (occurs twice) to its first, DST-side occurrence", () => {
    // 2:30am on fall-back morning happens once at AEDT (+11) and again an
    // hour later at AEST (+10). Both are "valid" — pick the earlier instant.
    expect(melbourneLocalToUtcIso("2026-04-05", "02:30")).toBe("2026-04-04T15:30:00.000Z");
  });

  it("does not treat unambiguous times either side of the fold as ambiguous", () => {
    expect(melbourneLocalToUtcIso("2026-04-05", "01:30")).toBe("2026-04-04T14:30:00.000Z");
    expect(melbourneLocalToUtcIso("2026-04-05", "03:30")).toBe("2026-04-04T17:30:00.000Z");
  });
});

describe("melbourneLocalToUtcIso — invalid input", () => {
  it("rejects a calendar date that doesn't exist", () => {
    expect(() => melbourneLocalToUtcIso("2026-02-30", "10:00")).toThrow(RangeError);
    expect(() => melbourneLocalToUtcIso("2026-04-31", "10:00")).toThrow(RangeError);
  });

  it("rejects an out-of-range month or day", () => {
    expect(() => melbourneLocalToUtcIso("2026-13-01", "10:00")).toThrow(RangeError);
    expect(() => melbourneLocalToUtcIso("2026-00-01", "10:00")).toThrow(RangeError);
  });

  it("rejects an out-of-range hour or minute", () => {
    expect(() => melbourneLocalToUtcIso("2026-01-01", "25:00")).toThrow(RangeError);
    expect(() => melbourneLocalToUtcIso("2026-01-01", "10:60")).toThrow(RangeError);
  });

  it("rejects a malformed date/time string", () => {
    expect(() => melbourneLocalToUtcIso("not-a-date", "10:00")).toThrow(RangeError);
    expect(() => melbourneLocalToUtcIso("2026-01-01", "10am")).toThrow(RangeError);
  });
});
