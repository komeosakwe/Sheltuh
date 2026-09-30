import { describe, expect, it } from "vitest";
import { parseEventFilterParams } from "@/lib/event-filter-params";

describe("parseEventFilterParams (/events?category=&pricing=)", () => {
  it("keeps a known category and pricing option", () => {
    expect(parseEventFilterParams({ category: "art", pricing: "free" })).toEqual({ category: "art", pricing: "free" });
    expect(parseEventFilterParams({ category: "pop-up", pricing: "paid" })).toEqual({ category: "pop-up", pricing: "paid" });
  });

  it("falls back to all for anything unknown or missing", () => {
    expect(parseEventFilterParams({})).toEqual({ category: "all", pricing: "all" });
    expect(parseEventFilterParams({ category: "nightlife", pricing: "cheap" })).toEqual({ category: "all", pricing: "all" });
    expect(parseEventFilterParams({ category: "ART", pricing: "" })).toEqual({ category: "all", pricing: "all" });
    expect(parseEventFilterParams({ category: "all", pricing: "all" })).toEqual({ category: "all", pricing: "all" });
  });

  it("uses only the first value of a repeated param", () => {
    expect(parseEventFilterParams({ category: ["theatre", "art"], pricing: ["bogus", "free"] })).toEqual({
      category: "theatre",
      pricing: "all",
    });
  });
});
