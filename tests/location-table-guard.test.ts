import { afterEach, describe, expect, it, vi } from "vitest";

// A broken table fails loudly when lib/location.ts loads, rather than placing people wrongly.
afterEach(() => {
  vi.doUnmock("@/lib/localities");
  vi.resetModules();
});

describe("lib/location.ts reading lib/localities.ts", () => {
  it.each([
    ["a reach digit past the steps", "Goodplace0000000|Badplace0000000z"],
    ["a coordinate that isn't base 36", "Badplace!!!00000"],
    ["a row with no name", "00000000"],
  ])("throws on %s", async (_what, row) => {
    vi.resetModules();
    vi.doMock("@/lib/localities", () => ({
      LOCALITY_REACH_KM: [1, 2],
      LOCALITY_DATA: { NSW: row, VIC: "Fitzroy00000000", QLD: "A00000000", SA: "B00000000", WA: "C00000000", TAS: "D00000000", NT: "E00000000", ACT: "F00000000", OT: "G00000000" },
    }));
    await expect(import("@/lib/location")).rejects.toThrow(/can't read the row/);
  });

  it("loads a well-formed table", async () => {
    vi.resetModules();
    vi.doMock("@/lib/localities", () => ({
      LOCALITY_REACH_KM: [1, 2],
      LOCALITY_DATA: { NSW: "Goodplace00000001", VIC: "Fitzroy00000000", QLD: "A00000000", SA: "B00000000", WA: "C00000000", TAS: "D00000000", NT: "E00000000", ACT: "F00000000", OT: "G00000000" },
    }));
    const location = await import("@/lib/location");
    expect(location.LOCALITY_COUNT).toBe(9);
  });
});
