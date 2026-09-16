import { describe, expect, it } from "vitest";
import { HttpError } from "../lambda/shared/http";
import { decodeCursor, encodeCursor, parseLimit } from "../lambda/shared/pagination";

describe("parseLimit", () => {
  it("defaults to 20 when unset", () => {
    expect(parseLimit(undefined)).toBe(20);
  });

  it("caps at 50 even if a larger value is requested", () => {
    expect(parseLimit("500")).toBe(50);
  });

  it("falls back to the default for invalid input", () => {
    expect(parseLimit("not-a-number")).toBe(20);
    expect(parseLimit("-5")).toBe(20);
    expect(parseLimit("0")).toBe(20);
  });

  it("accepts a valid value within range", () => {
    expect(parseLimit("10")).toBe(10);
  });
});

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a DynamoDB key", () => {
    const key = { organiserId: "org-1", eventId: "evt-1" };
    const cursor = encodeCursor(key);
    expect(cursor).toBeTypeOf("string");
    expect(decodeCursor(cursor)).toEqual(key);
  });

  it("returns undefined for an undefined key", () => {
    expect(encodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it("rejects a malformed cursor rather than crashing", () => {
    expect(() => decodeCursor("not-valid-base64url-json")).toThrow(HttpError);
  });
});
