import { describe, expect, it } from "vitest";
import {
  didYouMean,
  distanceKm,
  findLocality,
  nearestLocality,
  nearnessBand,
  nearnessBandLabel,
  normaliseSuburb,
  orderByNearness,
  parseNearParam,
  suggestLocalities,
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
    // A state stays in: findLocality reads it. Postcodes go.
    ["St Kilda, VIC 3182", "st kilda vic"],
    ["Brunswick  East Victoria", "brunswick east victoria"],
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
    expect(findLocality("St Kilda, VIC 3182")?.name).toBe("St Kilda");
    expect(findLocality("Fitzroy, Victoria 3065, Australia")).toMatchObject({ name: "Fitzroy", state: "VIC" });
    expect(findLocality("Melbourne")?.name).toBe("Melbourne");
    expect(findLocality("Melbourne CBD")?.name).toBe("Melbourne");
    expect(findLocality("CBD")?.name).toBe("Melbourne");
  });

  it.each([
    ["Brisbane", "Brisbane City", "QLD"],
    ["Brisbane, QLD", "Brisbane City", "QLD"],
    ["Darwin", "Darwin City", "NT"],
    ["Canberra", "City ACT", "ACT"],
    ["Cairns", "Cairns City", "QLD"],
    ["Gold Coast", "Surfers Paradise", "QLD"],
    ["Ballarat", "Ballarat Central", "VIC"],
    ["Bendigo", "Bendigo", "VIC"],
    ["Geelong", "Geelong", "VIC"],
    ["Hobart", "Hobart", "TAS"],
    ["Perth", "Perth", "WA"],
  ])("knows the city %s as %s", (text, name, state) => {
    expect(findLocality(text)).toMatchObject({ name, state });
    expect(didYouMean(text)).toBeNull();
  });

  it("doesn't take a city name to another state", () => {
    expect(findLocality("Brisbane NSW")).toBeNull();
  });

  it("knows suburbs and towns all over Australia", () => {
    expect(findLocality("Yarraville")).toMatchObject({ name: "Yarraville", state: "VIC" });
    expect(findLocality("Geelong")).toMatchObject({ name: "Geelong", state: "VIC" });
    expect(findLocality("Surry Hills NSW")).toMatchObject({ name: "Surry Hills", state: "NSW" });
    expect(findLocality("Fortitude Valley")).toMatchObject({ state: "QLD" });
    expect(findLocality("Alice Springs")).toMatchObject({ name: "Alice Springs", state: "NT" });
    expect(findLocality("Christmas Island")).toMatchObject({ state: "OT" });
  });

  describe("a name used in more than one state", () => {
    it("is Melbourne's when typed alone, while the app is Melbourne-first", () => {
      expect(findLocality("Richmond")).toMatchObject({ name: "Richmond", state: "VIC" });
      expect(findLocality("richmond vic")).toMatchObject({ name: "Richmond", state: "VIC" });
      expect(findLocality("Richmond, Victoria")).toMatchObject({ name: "Richmond", state: "VIC" });
    });

    it.each(["Richmond NSW", "Richmond, NSW", "richmond (nsw)", "Richmond New South Wales", "Richmond NSW 2753"])(
      "%s is the one in New South Wales, named with its state",
      (text) => {
        expect(findLocality(text)).toMatchObject({ name: "Richmond NSW", state: "NSW" });
      },
    );

    it("with none in Victoria, is the city suburb rather than the country town, else the nearer", () => {
      expect(findLocality("Perth")).toMatchObject({ name: "Perth", state: "WA" });
      expect(findLocality("Perth TAS")).toMatchObject({ name: "Perth TAS", state: "TAS" });
      expect(findLocality("Paddington")).toMatchObject({ name: "Paddington", state: "NSW" });
      expect(findLocality("Paddington, QLD")).toMatchObject({ name: "Paddington QLD", state: "QLD" });
    });

    it("used twice in one state, takes the ABS's qualifier as well", () => {
      const mackay = findLocality("Richmond (Mackay) QLD");
      const shire = findLocality("Richmond (Richmond) QLD");
      expect(mackay?.state).toBe("QLD");
      expect(shire?.state).toBe("QLD");
      expect(mackay).not.toBe(shire);
      // One of them is plain "Richmond QLD"; each name finds its own.
      expect([mackay?.name, shire?.name].sort()).toEqual(["Richmond (Richmond) QLD", "Richmond QLD"]);
      for (const place of [mackay, shire]) expect(findLocality(place?.name ?? "")).toBe(place);
    });

    it("keeps the CBD's nicknames for Melbourne, unless another state is named", () => {
      expect(findLocality("City")).toMatchObject({ name: "Melbourne", state: "VIC" });
      expect(findLocality("City ACT")).toMatchObject({ name: "City ACT", state: "ACT" });
    });

    it("reads a state only at the end, after trying the whole name", () => {
      expect(findLocality("Mount Victoria")).toMatchObject({ name: "Mount Victoria", state: "NSW" });
      expect(findLocality("Port Victoria")).toMatchObject({ name: "Port Victoria", state: "SA" });
    });

    it("finds nothing for a suburb in the wrong state", () => {
      expect(findLocality("Fitzroy North WA")).toBeNull();
    });
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
      // A suggestion, if any, is a real suburb ("proto" is a letter from Roto NSW), never Object's.
      const suggestion = didYouMean(text);
      if (suggestion) expect(findLocality(suggestion.name)).toBe(suggestion);
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
  const found = (lat: number, lng: number) => {
    const result = nearestLocality({ lat, lng });
    return result.kind === "found" ? result.locality : result.kind;
  };

  it.each([
    ["Footscray (the station)", -37.8013, 144.903, "Footscray", "VIC"],
    ["Box Hill (Central)", -37.8193, 145.1218, "Box Hill", "VIC"],
    ["Geelong (the waterfront)", -38.1446, 144.3612, "Geelong", "VIC"],
    ["Frankston (the station)", -38.1425, 145.1257, "Frankston", "VIC"],
    ["central Sydney", -33.8688, 151.2093, "Sydney", "NSW"],
    ["central Perth", -31.9523, 115.8613, "Perth", "WA"],
    ["Hobart", -42.8821, 147.3272, "Hobart", "TAS"],
  ])("a position in %s is %s", (_where, lat, lng, name, state) => {
    expect(found(lat, lng)).toMatchObject({ name, state });
  });

  // The ABS's Melbourne runs south over Kings Domain, so its area centroid was there and the CBD's
  // own streets were nearer Southbank's or Carlton's centre; its centre is the Hoddle grid now.
  it.each([
    ["Bourke St Mall", -37.8136, 144.9653],
    ["Melbourne Central", -37.8102, 144.9628],
    ["the State Library", -37.8098, 144.9652],
    ["Flagstaff station", -37.8119, 144.956],
    ["Queen Victoria Market", -37.8076, 144.9568],
    ["Parliament station", -37.811, 144.9728],
    ["Flinders Street station", -37.8183, 144.9671],
  ])("%s is in Melbourne (the CBD)", (_where, lat, lng) => {
    expect(found(lat, lng)).toMatchObject({ name: "Melbourne", state: "VIC" });
  });

  it("names a suburb with its state when the name alone is another one's", () => {
    // Richmond, New South Wales (Hawkesbury), a little off its centre.
    const richmond = place("Richmond NSW");
    expect(found(richmond.lat + 0.001, richmond.lng - 0.001)).toMatchObject({ name: "Richmond NSW", state: "NSW" });
    // Melbourne's Richmond is just "Richmond".
    expect(found(-37.82, 145.0)).toMatchObject({ name: "Richmond", state: "VIC" });
  });

  it("places a position in the bush, a long way from any town", () => {
    const outback = nearestLocality({ lat: -24.5, lng: 128.5 });
    expect(outback.kind).toBe("found");
  });

  it.each([
    ["well off the New South Wales coast", -34.5, 153.5],
    ["in Bass Strait, between the islands", -39.3, 145.5],
    ["Auckland", -36.8485, 174.7633],
    // The ABS's water localities are left out of the table: they reached far offshore.
    ["Port Moresby (the Coral Sea locality reached it)", -9.4438, 147.1803],
    ["Merauke, Indonesia", -8.4932, 140.4018],
    ["in the Coral Sea, off the reef", -17.5, 151.5],
    ["in the middle of the Gulf of Carpentaria", -14.5, 139.0],
    ["Bali", -8.65, 115.22],
    ["London", 51.5072, -0.1276],
    ["0, 0", 0, 0],
    ["nowhere (not a number)", Number.NaN, 145],
  ])("says outside %s", (_where, lat, lng) => {
    expect(nearestLocality({ lat, lng })).toEqual({ kind: "outside" });
  });

  it("returns only the suburb, never the position it was given", () => {
    const result = nearestLocality({ lat: -37.8012, lng: 144.9813 });
    expect(JSON.stringify(result)).not.toContain("-37.8012");
    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(Object.keys(result.locality).sort()).toEqual(["lat", "lng", "name", "state"]);
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

  it("puts a suburb 15 to 100 km away in 'far'", () => {
    expect(nearnessBand(place("Frankston"), "Fitzroy")).toBe("far");
    expect(nearnessBand(origin, "Geelong")).toBe("far");
  });

  it("puts a suburb more than 100 km away in 'distant' (Over 100 km, owner decision D8)", () => {
    expect(nearnessBand(origin, "Ballarat")).toBe("distant");
    expect(nearnessBand(origin, "Perth WA")).toBe("distant");
    expect(nearnessBand(place("Newtown NSW"), "Fortitude Valley QLD")).toBe("distant");
    expect(nearnessBandLabel("distant", origin)).toBe("Over 100 km");
    expect(nearnessBandLabel("far", origin)).toBe("15–100 km");
  });

  it("tells same-named suburbs apart by their state", () => {
    expect(nearnessBand(place("Richmond"), "Richmond")).toBe("here");
    expect(nearnessBand(place("Richmond NSW"), "Richmond")).toBe("distant");
    expect(nearnessBand(place("Richmond NSW"), "Richmond NSW")).toBe("here");
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
      ["here", "In Fitzroy, VIC"],
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

  it("from a long way off (Perth), every Melbourne event is over 100 km away; unknown ones still last", () => {
    const groups = orderByNearness(events, place("Perth"));
    expect(groups.map((g) => [g.band, g.label, g.items.length])).toEqual([
      ["distant", "Over 100 km", events.length - 1],
      ["unknown", "Location not on file", 1],
    ]);
    // Still soonest first within the band.
    expect(groups[0].items.map((e) => e.id)).toEqual(["near", "here-soon", "far-late", "here-tie-a", "here-tie-b", "here-late"]);
  });

  it("looks each event's suburb up with its state (placeQuery): Richmond NSW isn't Melbourne's Richmond", () => {
    const groups = orderByNearness(
      [
        { id: "vic", suburb: "Richmond", state: "VIC" as const, startsAt: "2026-11-01T20:00:00" },
        { id: "nsw", suburb: "Richmond NSW", state: "NSW" as const, startsAt: "2026-11-01T20:00:00" },
        { id: "nsw-bare", suburb: "Richmond", state: "NSW" as const, startsAt: "2026-11-02T20:00:00" },
        { id: "perth", suburb: "Perth", state: "WA" as const, startsAt: "2026-11-01T20:00:00" },
        { id: "no-state", suburb: "Richmond", startsAt: "2026-11-03T20:00:00" },
      ],
      place("Richmond NSW"),
    );
    expect(groups.map((g) => [g.band, g.items.map((e) => e.id)])).toEqual([
      ["here", ["nsw", "nsw-bare"]],
      ["distant", ["perth", "vic", "no-state"]],
    ]);
  });

  it("places suburbs the old 20-suburb table didn't know", () => {
    const groups = orderByNearness(
      [
        { id: "yarraville", suburb: "Yarraville", startsAt: "2026-11-01T20:00:00" },
        { id: "docklands", suburb: "Docklands", startsAt: "2026-11-01T20:00:00" },
      ],
      place("Footscray"),
    );
    expect(groups.map((g) => [g.band, g.items.map((e) => e.id)])).toEqual([["near", ["docklands", "yarraville"]]]);
  });
});

describe("didYouMean", () => {
  it("suggests a known suburb a letter or two away", () => {
    expect(didYouMean("Brunswik")?.name).toBe("Brunswick");
    expect(didYouMean("Colingwood")?.name).toBe("Collingwood");
  });

  it("suggests in the state given, by that suburb's own name", () => {
    expect(didYouMean("Brunswik WA")?.name).toBe("Brunswick WA");
    expect(didYouMean("Richmund, NSW")?.name).toBe("Richmond NSW");
  });

  it("suggests nothing for a known suburb, nonsense, or empty text", () => {
    expect(didYouMean("Fitzroy")).toBeNull();
    expect(didYouMean("Richmond NSW")).toBeNull();
    expect(didYouMean("Zzzzzzzz")).toBeNull();
    expect(didYouMean("")).toBeNull();
  });
});

describe("suggestLocalities", () => {
  it("lists suburbs starting with what's typed: an exact name first, Victoria's before the rest", () => {
    const fitz = suggestLocalities("fitz").map((p) => p.name);
    expect(fitz.slice(0, 2)).toEqual(["Fitzroy", "Fitzroy North"]);
    expect(fitz.length).toBeLessThanOrEqual(8);
    const richmond = suggestLocalities("Richmond").map((p) => p.name);
    expect(richmond[0]).toBe("Richmond");
    expect(richmond).toContain("Richmond NSW");
  });

  it("narrows by state as it's typed", () => {
    expect(suggestLocalities("richmond n").map((p) => p.name)).toEqual(["Richmond NSW"]);
  });

  it("offers each name once (a town and the locality around it share one)", () => {
    const names = suggestLocalities("dunol").map((p) => p.name);
    expect(names).toContain("Dunolly");
    expect(new Set(names).size).toBe(names.length);
  });

  it("offers a city by the name people use", () => {
    expect(suggestLocalities("canb")[0]?.name).toBe("City ACT");
    expect(suggestLocalities("gold c")[0]?.name).toBe("Surfers Paradise");
  });

  it("waits for two letters, and stops at the limit", () => {
    expect(suggestLocalities("")).toEqual([]);
    expect(suggestLocalities("b")).toEqual([]);
    expect(suggestLocalities("ba", 3)).toHaveLength(3);
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
