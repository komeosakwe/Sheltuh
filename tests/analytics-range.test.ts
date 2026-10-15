import { describe, expect, it } from "vitest";
import { parseRange, rangeLabel, rangeSearch, resolveRange, toQuery } from "@/lib/analytics-range";

const TODAY = "2026-10-15";
const overview = { allowAllTime: false, defaultPreset: "30d" as const };
const event = { allowAllTime: true, defaultPreset: "all" as const };
const params = (qs: string) => new URLSearchParams(qs);

describe("parseRange", () => {
  it("defaults per page", () => {
    expect(parseRange(params(""), overview, TODAY)).toEqual({ preset: "30d", compare: false });
    expect(parseRange(params(""), event, TODAY)).toEqual({ preset: "all", compare: false });
  });

  it("reads presets and compare", () => {
    expect(parseRange(params("range=7d&compare=1"), overview, TODAY)).toEqual({ preset: "7d", compare: true });
  });

  it("falls back on anything invalid", () => {
    expect(parseRange(params("range=forever"), overview, TODAY).preset).toBe("30d");
    // All time isn't offered on the overview.
    expect(parseRange(params("range=all"), overview, TODAY).preset).toBe("30d");
    // Custom needs real dates, in order, not in the future.
    expect(parseRange(params("range=custom&from=2026-10-10&to=2026-10-01"), overview, TODAY).preset).toBe("30d");
    expect(parseRange(params("range=custom&from=2026-10-01&to=2026-10-20"), overview, TODAY).preset).toBe("30d");
    expect(parseRange(params("range=custom&from=nope&to=2026-10-01"), overview, TODAY).preset).toBe("30d");
  });

  it("never compares All time", () => {
    expect(parseRange(params("range=all&compare=1"), event, TODAY)).toEqual({ preset: "all", compare: false });
  });

  it("accepts a valid custom range", () => {
    expect(parseRange(params("range=custom&from=2026-09-01&to=2026-09-30&compare=1"), overview, TODAY)).toEqual({
      preset: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
      compare: true,
    });
  });
});

describe("range ↔ URL and query", () => {
  it("round-trips through the URL", () => {
    const range = { preset: "custom" as const, from: "2026-09-01", to: "2026-09-30", compare: true };
    expect(rangeSearch(range)).toBe("range=custom&from=2026-09-01&to=2026-09-30&compare=1");
    expect(parseRange(params(rangeSearch(range)), overview, TODAY)).toEqual(range);
  });

  it("resolves presets to inclusive Melbourne dates ending today", () => {
    expect(resolveRange({ preset: "7d", compare: false }, TODAY)).toEqual({ from: "2026-10-09", to: TODAY });
    expect(resolveRange({ preset: "30d", compare: false }, TODAY)).toEqual({ from: "2026-09-16", to: TODAY });
    expect(resolveRange({ preset: "12m", compare: false }, TODAY)).toEqual({ from: "2025-10-16", to: TODAY });
  });

  it("asks for no dates for All time (the API's default is the event's life)", () => {
    expect(toQuery({ preset: "all", compare: false }, TODAY)).toEqual({});
  });

  it("asks for the previous period when comparing", () => {
    expect(toQuery({ preset: "7d", compare: true }, TODAY)).toEqual({ from: "2026-10-09", to: TODAY, compare: "prevPeriod" });
  });

  it("labels presets and custom ranges", () => {
    expect(rangeLabel({ preset: "90d", compare: false })).toBe("Last 90 days");
    expect(rangeLabel({ preset: "custom", from: "2026-10-01", to: "2026-10-14", compare: false })).toBe("1–14 Oct 2026");
  });
});
