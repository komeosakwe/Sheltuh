// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NEAR_STORAGE_KEY,
  clearStoredNear,
  parseStoredNear,
  parseStoredNearState,
  readStoredNear,
  readStoredNearState,
  subscribeStoredNear,
  writeStoredNear,
} from "@/lib/near-storage";

afterEach(() => {
  vi.restoreAllMocks();
  // Through the module, so a page-only copy left by a refused write goes too.
  clearStoredNear();
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

  it("copes when storage throws: writes say they failed, but the page keeps the choice until it goes", () => {
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
    expect(writeStoredNear("Fitzroy", "VIC")).toBe(false);
    // Not saved, but what Where shows is what this page uses.
    expect(readStoredNear()).toBe("Fitzroy");
    expect(readStoredNearState()).toBe("VIC");
    expect(clearStoredNear()).toBe(false);
    expect(readStoredNear()).toBe("");
  });

  it("a quota error on write: the page uses the new choice, not the older saved one", () => {
    expect(writeStoredNear("Perth", "WA")).toBe(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(writeStoredNear("Fitzroy", "VIC")).toBe(false);
    expect(readStoredNear()).toBe("Fitzroy");
  });

  it("another tab's saved choice replaces this page's unsaved one", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(writeStoredNear("Fitzroy")).toBe(false);
    vi.restoreAllMocks();
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Perth", state: "WA" }));
    const unsubscribe = subscribeStoredNear(() => {});
    window.dispatchEvent(new StorageEvent("storage", { key: NEAR_STORAGE_KEY }));
    expect(readStoredNear()).toBe("Perth");
    unsubscribe();
  });
});

describe("subscribeStoredNear", () => {
  it("is called when the suburb is written or forgotten in this page, and not after unsubscribing", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeStoredNear(onChange);
    writeStoredNear("Fitzroy", "VIC");
    expect(onChange).toHaveBeenCalledTimes(1);
    clearStoredNear();
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    writeStoredNear("Perth", "WA");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("is called for another tab's change (the storage event), for this key only", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeStoredNear(onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    expect(onChange).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: NEAR_STORAGE_KEY }));
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("is still called when the write fails, so the page follows the choice it shows", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeStoredNear(onChange);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(writeStoredNear("Fitzroy")).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(readStoredNear()).toBe("Fitzroy");
    unsubscribe();
  });
});
