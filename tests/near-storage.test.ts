// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NEAR_STORAGE_KEY,
  clearStoredNear,
  parseStoredNear,
  parseStoredNearState,
  readStoredNear,
  readStoredNearState,
  writeStoredNear,
} from "@/lib/near-storage";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("near-storage", () => {
  it("round-trips the suburb, storing only {suburb}", () => {
    expect(writeStoredNear("  Fitzroy ")).toBe(true);
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "Fitzroy" });
    expect(readStoredNear()).toBe("Fitzroy");
    expect(clearStoredNear()).toBe(true);
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
    expect(readStoredNear()).toBe("");
  });

  it("stores the suburb's state with it, for the home to read without the suburb table", () => {
    expect(writeStoredNear(" Richmond NSW ", "NSW")).toBe(true);
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "Richmond NSW", state: "NSW" });
    expect(readStoredNear()).toBe("Richmond NSW");
    expect(readStoredNearState()).toBe("NSW");
    expect(writeStoredNear("Perth", "WA")).toBe(true);
    expect(readStoredNearState()).toBe("WA");
    expect(clearStoredNear()).toBe(true);
    expect(readStoredNearState()).toBeNull();
  });

  it.each([
    [null, null],
    ["not json", null],
    ['{"state": "WA"}', null],
    ['{"suburb": "Perth", "state": "WA"}', "WA"],
    // An entry saved before the state was: the state code the name ends with, if any.
    ['{"suburb": "Richmond NSW"}', "NSW"],
    ['{"suburb": "Richmond (Mackay) QLD"}', "QLD"],
    ['{"suburb": "Perth"}', null],
    // Only a real state code counts.
    ['{"suburb": "Perth", "state": "XX"}', null],
    ['{"suburb": "Perth", "state": 3}', null],
  ])("reads the state of %s as %j", (raw, expected) => {
    expect(parseStoredNearState(raw)).toBe(expected);
  });

  it.each([
    [null, ""],
    ["", ""],
    ["not json", ""],
    ["[]", ""],
    ['{"suburb": 3}', ""],
    ['{"lat": -37.8, "lng": 144.9}', ""],
    ['{"suburb": " Carlton "}', "Carlton"],
    [JSON.stringify({ suburb: "x".repeat(90) }), "x".repeat(60)],
  ])("reads %s as %j", (raw, expected) => {
    expect(parseStoredNear(raw)).toBe(expected);
  });

  it("copes when storage throws: reads are empty, writes say they failed", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredNear()).toBe("");
    expect(readStoredNearState()).toBeNull();
    expect(writeStoredNear("Fitzroy")).toBe(false);
    expect(clearStoredNear()).toBe(false);
  });
});
