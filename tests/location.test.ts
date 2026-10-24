import { describe, expect, it } from "vitest";
import {
  didYouMean,
  distanceKm,
  findLocality,
  nearestLocality,
  nearnessBand,
  normaliseSuburb,
  orderByNearness,
  parseNearParam,
  type Locality,
} from "@/lib/location";

function place(name: string): Locality {
  const found = findLocality(name);
  if (!found) throw new Error(`fixture suburb not in the table: ${name}`);
  return found;
}

describe("normaliseSuburb", () => {
  it.each([
    ["  Fitzroy  ", "fitzroy"],
    ["FITZROY NORTH", "fitzroy north"],
    ["Fitzroy Nth", "fitzroy north"],
    ["St. Kilda", "st kilda"],
    ["Saint Kilda", "st kilda"],
    ["St Kilda, VIC 3182", "st kilda"],
    ["Brunswick  East Victoria", "brunswick east"],
    ["Brunswick-East", "brunswick east"],
    ["Prahrän", "prahran"],
    ["Mt Waverley", "mount waverley"],
    ["Melbourne CBD", "melbourne"],
    ["CBD", "melbourne"],
    ["melbourne city centre", "melbourne"],
    ["", ""],
  ])("%s → %s", (input, expected) => {
    expect(normaliseSuburb(input)).toBe(expected);
  });
});

describe("findLocality", () => {
  it("finds a known suburb however it's written, by its own name", () => {
    expect(findLocality("st kilda vic")?.name).toBe("St Kilda");
    expect(findLocality("Melbourne")?.name).toBe("Melbourne CBD");
    expect(findLocality("Melbourne CBD")?.name).toBe("Melbourne CBD");
  });

  it("returns null for an unknown or empty suburb", () => {
    expect(findLocality("Atlantis")).toBeNull();
    expect(findLocality("   ")).toBeNull();
  });

  // What people type is looked up in tables: never answered from Object.prototype.
  it.each([
    ["constructor", "constructor"],
    ["__proto__", "proto"],
    ["toString", "tostring"],
    ["hasOwnProperty", "hasownproperty"],
    ["Constructor Nth", "constructor north"],
    ["Saint constructor", "st constructor"],
  ])(
    "treats %s as an ordinary unknown word",
    (text, normalised) => {
      expect(normaliseSuburb(text)).toBe(normalised);
      expect(findLocality(text)).toBeNull();
      expect(didYouMean(text)).toBeNull();
      expect(nearnessBand(place("Fitzroy"), text)).toBe("unknown");
    },
  );
});

describe("distanceKm", () => {
  it("is zero to itself, symmetric, and about right across town", () => {
    const fitzroy = place("Fitzroy");
    const footscray = place("Footscray");
    expect(distanceKm(fitzroy, fitzroy)).toBe(0);
    expect(distanceKm(fitzroy, footscray)).toBeCloseTo(distanceKm(footscray, fitzroy), 10);
    // Fitzroy to Footscray is about 7 km as the crow flies.
    expect(distanceKm(fitzroy, footscray)).toBeGreaterThan(6);
    expect(distanceKm(fitzroy, footscray)).toBeLessThan(8);
  });
});

describe("nearestLocality", () => {
  it("names the suburb whose centre is closest, inside Greater Melbourne", () => {
    const northcote = place("Northcote");
    const result = nearestLocality({ lat: northcote.lat + 0.002, lng: northcote.lng - 0.001 });
    expect(result).toEqual({ kind: "found", locality: northcote });
  });

  it("says outside for a position beyond the metro bounds (Sydney)", () => {
    expect(nearestLocality({ lat: -33.8688, lng: 151.2093 })).toEqual({ kind: "outside" });
  });

  it("won't name a far-off suburb: inside Melbourne but no known centre within 5 km (Frankston)", () => {
    expect(nearestLocality({ lat: -38.1446, lng: 145.1236 })).toEqual({ kind: "unmatched" });
  });

  it("returns only the suburb, never the position it was given", () => {
    const result = nearestLocality({ lat: -37.8, lng: 144.98 });
    expect(JSON.stringify(result)).not.toContain("-37.8,");
    if (result.kind === "found") expect(Object.keys(result.locality).sort()).toEqual(["lat", "lng", "name"]);
  });
});

describe("nearnessBand", () => {
  const origin = place("Fitzroy");
  it.each([
    ["Fitzroy", "here"],
    ["fitzroy", "here"],
    ["Collingwood", "near"],
    ["Footscray", "mid"],
    ["Somewhere Unmapped", "unknown"],
    ["", "unknown"],
  ])("%s → %s", (suburb, band) => {
    expect(nearnessBand(origin, suburb)).toBe(band);
  });

  it("puts a suburb more than 15 km away in 'far'", () => {
    // No table suburb is 15 km from Fitzroy, so measure from a nearby one against a made-up far origin.
    const farOrigin: Locality = { name: "Frankston", lat: -38.1446, lng: 145.1236 };
    expect(nearnessBand(farOrigin, "Fitzroy")).toBe("far");
  });
});

describe("orderByNearness", () => {
  const origin = place("Fitzroy");
  const events = [
    { id: "far-late", suburb: "Footscray", startsAt: "2026-11-02T20:00:00" },
    { id: "unknown", suburb: "Atlantis", startsAt: "2026-10-30T20:00:00" },
    { id: "here-late", suburb: "Fitzroy", startsAt: "2026-11-05T20:00:00" },
    { id: "near", suburb: "Collingwood", startsAt: "2026-10-31T20:00:00" },
    { id: "here-soon", suburb: "fitzroy", startsAt: "2026-11-01T20:00:00" },
    { id: "here-tie-b", suburb: "Fitzroy", startsAt: "2026-11-03T20:00:00" },
    { id: "here-tie-a", suburb: "Fitzroy", startsAt: "2026-11-03T20:00:00" },
  ];

  it("groups into bands nearest first, soonest first within each, missing locations last", () => {
    const groups = orderByNearness(events, origin);
    expect(groups.map((g) => [g.band, g.label])).toEqual([
      ["here", "In Fitzroy"],
      ["near", "Within 5 km"],
      ["mid", "5–15 km"],
      ["unknown", "Location not on file"],
    ]);
    expect(groups[0].items.map((e) => e.id)).toEqual(["here-soon", "here-tie-a", "here-tie-b", "here-late"]);
    expect(groups.flatMap((g) => g.items)).toHaveLength(events.length);
  });

  it("keeps equal times in a stable order (by id) whatever order they came in", () => {
    const reversed = orderByNearness([...events].reverse(), origin);
    expect(reversed.flatMap((g) => g.items.map((e) => e.id))).toEqual(
      orderByNearness(events, origin).flatMap((g) => g.items.map((e) => e.id)),
    );
  });

  it("returns no bands for no events", () => {
    expect(orderByNearness([], origin)).toEqual([]);
  });
});

describe("didYouMean", () => {
  it("suggests a known suburb a letter or two away", () => {
    expect(didYouMean("Brunswik")?.name).toBe("Brunswick");
    expect(didYouMean("Colingwood")?.name).toBe("Collingwood");
  });

  it("suggests nothing for a known suburb, nonsense, or empty text", () => {
    expect(didYouMean("Fitzroy")).toBeNull();
    expect(didYouMean("Zzzzzzzz")).toBeNull();
    expect(didYouMean("")).toBeNull();
  });
});

describe("parseNearParam", () => {
  it("takes the first value, trimmed, at most 60 characters", () => {
    expect(parseNearParam(undefined)).toBe("");
    expect(parseNearParam("  Fitzroy ")).toBe("Fitzroy");
    expect(parseNearParam(["Carlton", "Fitzroy"])).toBe("Carlton");
    expect(parseNearParam("x".repeat(80))).toHaveLength(60);
  });
});
