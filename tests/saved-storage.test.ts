// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSavedIds, readSavedIds, SAVED_STORAGE_KEY, writeSavedIds } from "@/lib/saved-storage";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("saved-storage (demo mode)", () => {
  it("round-trips the ids under the documented key", () => {
    expect(writeSavedIds(["a", "b"])).toBe(true);
    expect(localStorage.getItem(SAVED_STORAGE_KEY)).toBe('{"ids":["a","b"]}');
    expect(readSavedIds()).toEqual(["a", "b"]);
  });

  it("treats anything malformed as an empty list, and drops duplicates and non-strings", () => {
    expect(parseSavedIds(null)).toEqual([]);
    expect(parseSavedIds("nope")).toEqual([]);
    expect(parseSavedIds('{"ids":"a"}')).toEqual([]);
    expect(parseSavedIds('{"ids":["a",1,"a","",null,"b"]}')).toEqual(["a", "b"]);
  });

  it("reports blocked storage instead of throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(readSavedIds()).toBeNull();
    expect(writeSavedIds(["a"])).toBe(false);
  });
});
