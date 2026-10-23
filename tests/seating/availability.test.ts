import { describe, expect, it } from "vitest";
import {
  availabilityByteLength,
  decodeAvailability,
  encodeAvailability,
  isSeatUnavailable,
  unavailablePositions,
} from "@/lib/seating/availability";

describe("availability bitmap", () => {
  it("sets one bit per unavailable seat, most significant bit first", () => {
    const encoded = encodeAvailability(10, [0, 7, 8]);
    expect(Buffer.from(encoded, "base64")).toEqual(Buffer.from([0b1000_0001, 0b1000_0000]));
    expect(unavailablePositions(encoded, 10)).toEqual([0, 7, 8]);
  });

  it("round-trips a 10,000-seat map in about 1.7 KB", () => {
    const taken = Array.from({ length: 10_000 }, (_, i) => i).filter((i) => i % 3 === 0 || i === 9_999);
    const encoded = encodeAvailability(10_000, taken);
    expect(encoded.length).toBe(1668);
    expect(availabilityByteLength(10_000)).toBe(1250);
    expect(unavailablePositions(encoded, 10_000)).toEqual(taken);
  });

  it("ignores positions outside the map", () => {
    expect(unavailablePositions(encodeAvailability(3, [-1, 3, 1.5, 2]), 3)).toEqual([2]);
  });

  it("refuses a bitmap that doesn't fit the map (a different version, or damaged)", () => {
    const encoded = encodeAvailability(16, [1]);
    expect(decodeAvailability(encoded, 17)).toBeNull();
    expect(decodeAvailability("not base64!", 16)).toBeNull();
    expect(unavailablePositions("", 0)).toEqual([]);
    const bits = decodeAvailability(encoded, 16)!;
    expect(isSeatUnavailable(bits, 1)).toBe(true);
    expect(isSeatUnavailable(bits, 2)).toBe(false);
    // Out of range counts as unavailable: never offer a seat the bitmap doesn't cover.
    expect(isSeatUnavailable(bits, 16)).toBe(true);
  });
});
