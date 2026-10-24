import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isInMelbourneMetro, SUBURB_COORDINATES } from "@/lib/geo";
import { MELBOURNE_LOCALITIES } from "@/lib/localities";
import { findLocality, normaliseSuburb } from "@/lib/location";
import { sampleEvents } from "@/lib/sample-events";

describe("lib/localities.ts (the suburb table for near-you search)", () => {
  it("records where it comes from and how many rows it has", () => {
    const header = readFileSync(path.join(process.cwd(), "lib/localities.ts"), "utf8").slice(0, 1500);
    expect(header).toMatch(/Rows: \d+/);
    const rows = Number(header.match(/Rows: (\d+)/)?.[1]);
    expect(rows).toBe(MELBOURNE_LOCALITIES.length);
    // Interim: the lib/geo.ts table, until the CC BY 4.0 table lands (with its licence and /about credit).
    expect(header).toContain("lib/geo.ts");
  });

  it("has unique names once normalised, every one inside Greater Melbourne", () => {
    const keys = MELBOURNE_LOCALITIES.map((l) => normaliseSuburb(l.name));
    expect(new Set(keys).size).toBe(keys.length);
    for (const locality of MELBOURNE_LOCALITIES) expect(isInMelbourneMetro(locality)).toBe(true);
  });

  it("resolves every suburb in the old lib/geo.ts table", () => {
    for (const key of Object.keys(SUBURB_COORDINATES)) expect(findLocality(key)).not.toBeNull();
  });

  it("resolves the sample events' suburbs that the interim table holds; the rest wait for the full table", () => {
    const unresolved = [...new Set(sampleEvents.map((e) => e.suburb).filter((suburb) => !findLocality(suburb)))].sort();
    // The interim table has 20 inner suburbs. When the CC BY table lands, this list should be empty.
    expect(unresolved).toEqual(["Docklands", "Yarraville"]);
  });
});
