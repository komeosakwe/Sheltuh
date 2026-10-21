// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTrackingRef, parseTrackingRef, setTrackingRef, TRACKING_REF_KEY } from "@/lib/tracking-ref";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("tracking-ref", () => {
  it("accepts only well-formed codes (the server's alphabet), normalised", () => {
    expect(parseTrackingRef("  AB3DEF7H ")).toBe("ab3def7h");
    expect(parseTrackingRef("abc0efgh")).toBeNull(); // 0 isn't in the alphabet
    expect(parseTrackingRef("abc")).toBeNull();
    expect(parseTrackingRef("<script>")).toBeNull();
    expect(parseTrackingRef(42)).toBeNull();
  });

  it("remembers one code per event, for this session, under the documented key", () => {
    setTrackingRef("evt-1", "ab3def7h");
    setTrackingRef("evt-2", "zz9yx8wv");
    expect(getTrackingRef("evt-1")).toBe("ab3def7h");
    expect(getTrackingRef("evt-2")).toBe("zz9yx8wv");
    expect(getTrackingRef("evt-3")).toBeUndefined();
    expect(JSON.parse(sessionStorage.getItem(TRACKING_REF_KEY) ?? "{}")).toEqual({ "evt-1": "ab3def7h", "evt-2": "zz9yx8wv" });
  });

  it("a newer code for the same event replaces the old one; a malformed one is ignored", () => {
    setTrackingRef("evt-1", "ab3def7h");
    setTrackingRef("evt-1", "bad!");
    expect(getTrackingRef("evt-1")).toBe("ab3def7h");
    setTrackingRef("evt-1", "cd4efg8h");
    expect(getTrackingRef("evt-1")).toBe("cd4efg8h");
  });

  it("ignores tampered storage", () => {
    sessionStorage.setItem(TRACKING_REF_KEY, JSON.stringify({ "evt-1": "javascript:alert(1)", "evt-2": "ab3def7h" }));
    expect(getTrackingRef("evt-1")).toBeUndefined();
    expect(getTrackingRef("evt-2")).toBe("ab3def7h");
    sessionStorage.setItem(TRACKING_REF_KEY, "not json");
    expect(getTrackingRef("evt-2")).toBeUndefined();
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => setTrackingRef("evt-1", "ab3def7h")).not.toThrow();
    expect(getTrackingRef("evt-1")).toBeUndefined();
  });
});
