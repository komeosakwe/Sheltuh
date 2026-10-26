import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUBURB_COORDINATES } from "@/lib/geo";
import { LOCALITY_DATA } from "@/lib/localities";
import { allLocalities, distanceKm, findLocality, LOCALITY_COUNT } from "@/lib/location";
import { NEAR_MAX_LENGTH } from "@/lib/near-storage";
import { sampleEvents } from "@/lib/sample-events";

const header = readFileSync(path.join(process.cwd(), "lib/localities.ts"), "utf8").slice(0, 3000);

describe("lib/localities.ts (the suburb table for near-you search)", () => {
  it("records its source, licence, edition, generator and row count", () => {
    expect(header).toContain("Australian Bureau of Statistics");
    expect(header).toContain("ASGS Edition 4 (2026)");
    expect(header).toContain("Suburbs and Localities (SAL)");
    expect(header).toContain("CC BY 4.0");
    expect(header).toContain("credited on /about");
    expect(header).toContain("scripts/generate-localities.py");
    expect(existsSync(path.join(process.cwd(), "scripts/generate-localities.py"))).toBe(true);
    const rows = Number(header.match(/Rows: (\d+)/)?.[1]);
    expect(rows).toBe(LOCALITY_COUNT);
    expect(rows).toBeGreaterThan(15_000);
    // The per-state counts add up, and match the data.
    const counts = new Map([...header.matchAll(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT|OT) (\d+)\b/g)].map(([, state, n]) => [state, Number(n)]));
    expect([...counts.values()].reduce((sum, n) => sum + n, 0)).toBe(rows);
    for (const [state, data] of Object.entries(LOCALITY_DATA)) expect(data.split("|").length, state).toBe(counts.get(state));
  });

  it("credits the ABS on /about", () => {
    const about = readFileSync(path.join(process.cwd(), "app/about/page.tsx"), "utf8");
    expect(about).toMatch(/Suburb locations: Australian Bureau of Statistics, ASGS Edition 4 \(2026\),/);
    expect(about).toContain("https://creativecommons.org/licenses/by/4.0/");
  });

  it("leaves out the ABS's rows that aren't places", () => {
    const text = Object.values(LOCALITY_DATA).join("|");
    expect(text).not.toMatch(/No usual address|Migratory|Outside Australia/);
  });

  const places = allLocalities();

  it("puts every centre in Australia, its external territories included", () => {
    for (const place of places) {
      expect(place.lat).toBeGreaterThan(-55);
      expect(place.lat).toBeLessThan(-9);
      expect(place.lng).toBeGreaterThan(96);
      expect(place.lng).toBeLessThan(168.1);
    }
  });

  it("gives every place a name that finds it again, short enough to store as `near`", () => {
    for (const place of places) {
      const found = findLocality(place.name);
      expect(found?.name).toBe(place.name);
      expect(found?.state).toBe(place.state);
      expect(place.name.length).toBeLessThanOrEqual(NEAR_MAX_LENGTH);
    }
    // Only a town and the locality around it share a name (the ABS's "Dunolly" and "Dunolly (Vic)").
    const shared = places.filter((place) => findLocality(place.name) !== place);
    expect(shared.map((place) => `${place.name} ${place.state}`).sort()).toEqual(["Dunolly VIC", "Woodstock VIC"]);
    for (const place of shared) expect(distanceKm(place, findLocality(place.name) ?? place)).toBeLessThan(10);
  });

  it("resolves every sample event's suburb, in Victoria", () => {
    const suburbs = [...new Set(sampleEvents.map((e) => e.suburb))];
    for (const suburb of suburbs) expect(findLocality(suburb)?.state, suburb).toBe("VIC");
  });

  it("resolves every suburb in the /map table (lib/geo.ts) to Melbourne's, within a couple of km", () => {
    for (const [key, centre] of Object.entries(SUBURB_COORDINATES)) {
      const place = findLocality(key);
      expect(place?.state, key).toBe("VIC");
      expect(distanceKm(centre, place ?? centre), key).toBeLessThan(2.5);
    }
  });
});
