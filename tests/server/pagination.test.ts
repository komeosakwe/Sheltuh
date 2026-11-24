import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/server/http";
import { decodeCursor, encodeCursor, MAX_CURSOR_OFFSET } from "@/lib/server/pagination";

/** Cursors (lib/server/pagination.ts): opaque row offsets, shared by every list route. */

const forged = (o: unknown) => Buffer.from(JSON.stringify({ o }), "utf-8").toString("base64url");

function status(raw: string): number | undefined {
  try {
    decodeCursor(raw);
    return undefined;
  } catch (err) {
    return err instanceof HttpError ? err.statusCode : -1;
  }
}

describe("decodeCursor", () => {
  it("reads back what encodeCursor wrote, up to the largest offset", () => {
    expect(decodeCursor(null)).toBe(0);
    expect(decodeCursor("")).toBe(0);
    for (const offset of [0, 20, 1000, MAX_CURSOR_OFFSET]) expect(decodeCursor(encodeCursor(offset))).toBe(offset);
  });

  it("is a 400 for an offset out of range, a non-integer or a malformed cursor", () => {
    for (const o of [MAX_CURSOR_OFFSET + 1, 1e300, Number.MAX_SAFE_INTEGER, -1, 1.5, "20", null]) {
      expect([o, status(forged(o))]).toEqual([o, 400]);
    }
    expect(status("not-a-cursor")).toBe(400);
  });
});
