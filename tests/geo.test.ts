import { describe, expect, it } from "vitest";
import { AUSTRALIA_BOUNDS, clampToAustralia, panByPixels, resolveEventCoordinates, resolveMapCoordinates } from "../lib/geo";
import { findLocality } from "../lib/location";
import { sampleEvents } from "../lib/sample-events";
import type { SheltuhEvent } from "../lib/types";

function findEvent(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`Fixture event not found: ${slug}`);
  return event;
}

describe("resolveEventCoordinates", () => {
  it("prefers an event's own geocoded coordinates", () => {
    const event = findEvent("neon-static");
    expect(event.coordinates).toBeDefined();
    expect(resolveEventCoordinates(event)).toEqual(event.coordinates);
  });

  it("falls back to a known suburb centroid when coordinates are missing", () => {
    const event = { ...findEvent("neon-static"), coordinates: undefined, suburb: "Fitzroy" };
    const resolved = resolveEventCoordinates(event);
    expect(resolved).not.toBeNull();
    expect(resolved?.lat).toBeCloseTo(-37.7997, 2);
    expect(resolved?.lng).toBeCloseTo(144.9784, 2);
  });

  it("matches suburb names case-insensitively and ignores surrounding whitespace", () => {
    const event = { ...findEvent("neon-static"), coordinates: undefined, suburb: "  ST KILDA  " };
    expect(resolveEventCoordinates(event)).not.toBeNull();
  });

  it.each(["constructor", "__proto__", "toString"])("never finds a position for the suburb %s on Object.prototype", (suburb) => {
    const event = { ...findEvent("neon-static"), coordinates: undefined, suburb };
    expect(resolveEventCoordinates(event)).toBeNull();
    expect(resolveMapCoordinates(event)).toBeNull();
  });

  it("returns null when neither coordinates nor a known suburb are available", () => {
    const event = { ...findEvent("neon-static"), coordinates: undefined, suburb: "Somewhere Unmapped" };
    expect(resolveEventCoordinates(event)).toBeNull();
  });

  it("every sample event resolves to a position", () => {
    for (const event of sampleEvents) {
      expect(resolveEventCoordinates(event)).not.toBeNull();
    }
  });
});

describe("resolveMapCoordinates", () => {
  it("returns coordinates inside Australia", () => {
    const event = findEvent("neon-static");
    expect(resolveMapCoordinates(event)).toEqual(resolveEventCoordinates(event));
  });

  it.each([
    ["Sydney", { lat: -33.8861, lng: 151.2111 }],
    ["Perth", { lat: -31.9523, lng: 115.8613 }],
    ["Norfolk Island", { lat: -29.0408, lng: 167.9547 }],
    ["Christmas Island", { lat: -10.4475, lng: 105.6904 }],
  ])("pins an event in %s (owner plan S9: the map is Australia-wide)", (_, coordinates) => {
    const event = { ...findEvent("neon-static"), coordinates };
    expect(resolveMapCoordinates(event)).toEqual(coordinates);
  });

  it("returns null for coordinates outside Australia", () => {
    const event = { ...findEvent("neon-static"), coordinates: { lat: -36.85, lng: 174.76 } }; // Auckland
    expect(resolveEventCoordinates(event)).not.toBeNull();
    expect(resolveMapCoordinates(event)).toBeNull();
  });

  it("uses the 20 hand-entered centres for Victorian events only", () => {
    const base = { ...findEvent("neon-static"), coordinates: undefined, suburb: "Richmond" };
    expect(resolveMapCoordinates({ ...base, state: "VIC" })).not.toBeNull();
    expect(resolveMapCoordinates({ ...base, suburb: "Richmond VIC" })).not.toBeNull();
    expect(resolveMapCoordinates({ ...base, state: "NSW" })).toBeNull();
    expect(resolveMapCoordinates({ ...base, suburb: "Richmond NSW" })).toBeNull();
  });

  it("returns null when the event can't be located at all", () => {
    const event = { ...findEvent("neon-static"), coordinates: undefined, suburb: "Nowhereville" };
    expect(resolveMapCoordinates(event)).toBeNull();
  });
});

describe("with the ABS suburb table as the lookup (/map)", () => {
  const at = (suburb: string, coordinates?: { lat: number; lng: number }) => ({
    ...findEvent("neon-static"),
    coordinates,
    suburb,
  });

  it.each(["Footscray", "Box Hill", "Yarraville", "Docklands", "Frankston", "Box Hill VIC", "Box Hill, Victoria"])(
    "places an event in %s, outside the old 20-suburb table too",
    (suburb) => {
      const resolved = resolveMapCoordinates(at(suburb), findLocality);
      expect(resolved).not.toBeNull();
      expect(Object.keys(resolved ?? {}).sort()).toEqual(["lat", "lng"]);
    },
  );

  it("puts Box Hill at the Box Hill centre, Melbourne's Richmond for plain 'Richmond'", () => {
    expect(resolveMapCoordinates(at("Box Hill"), findLocality)).toEqual({ lat: -37.822, lng: 145.126 });
    const richmond = resolveMapCoordinates(at("Richmond"), findLocality);
    expect(richmond?.lat).toBeCloseTo(-37.82, 1);
    // The New South Wales one is pinned too, now the map is Australia-wide.
    expect(resolveEventCoordinates(at("Richmond NSW"), findLocality)?.lat).toBeCloseTo(-33.6, 1);
    expect(resolveMapCoordinates(at("Richmond NSW"), findLocality)?.lat).toBeCloseTo(-33.6, 1);
  });

  it("looks the suburb up with the event's state ('{suburb} {state}')", () => {
    const sydney = resolveMapCoordinates({ ...at("Newtown"), state: "NSW" }, findLocality);
    expect(sydney?.lat).toBeCloseTo(-33.9, 1);
    const perth = resolveMapCoordinates({ ...at("Perth"), state: "WA" }, findLocality);
    expect(perth?.lng).toBeCloseTo(115.86, 1);
    // A Victorian Newtown (Geelong's) when the state says so.
    expect(resolveMapCoordinates({ ...at("Newtown"), state: "VIC" }, findLocality)?.lat).toBeCloseTo(-38.15, 1);
    // Stored with its state already ("Richmond NSW"): not doubled.
    expect(resolveMapCoordinates({ ...at("Richmond NSW"), state: "NSW" }, findLocality)?.lat).toBeCloseTo(-33.6, 1);
    // A suburb that isn't in the state isn't placed elsewhere.
    expect(resolveMapCoordinates({ ...at("Fitzroy"), state: "WA" }, findLocality)).toBeNull();
    expect(resolveMapCoordinates({ ...at("Norfolk Island"), state: "OT" }, findLocality)?.lng).toBeCloseTo(167.95, 1);
  });

  it("still prefers the event's own coordinates", () => {
    const own = { lat: -37.81, lng: 144.96 };
    expect(resolveMapCoordinates(at("Box Hill", own), findLocality)).toEqual(own);
  });

  it.each(["Fitzroyy", "Nowhereville", "", "constructor", "__proto__"])("leaves %j unplaced", (suburb) => {
    expect(resolveMapCoordinates(at(suburb), findLocality)).toBeNull();
  });
});

describe("clampToAustralia (the venue pin picker)", () => {
  it("keeps a position inside, and moves one outside to the nearest edge", () => {
    expect(clampToAustralia({ lat: -37.8, lng: 144.98 })).toEqual({ lat: -37.8, lng: 144.98 });
    expect(clampToAustralia({ lat: -60, lng: 200 })).toEqual({ lat: AUSTRALIA_BOUNDS.south, lng: AUSTRALIA_BOUNDS.east });
    expect(clampToAustralia({ lat: 10, lng: 50 })).toEqual({ lat: AUSTRALIA_BOUNDS.north, lng: AUSTRALIA_BOUNDS.west });
  });
});

describe("panByPixels (Web Mercator, as Leaflet's panBy)", () => {
  it("moves east and south for right and down, and back again", () => {
    const start = { lat: -37.8, lng: 144.98 };
    const east = panByPixels(start, 14, 80, 0);
    expect(east.lat).toBeCloseTo(start.lat, 9);
    // 80px at zoom 14 is 80 / (256 * 2^14) of the world's 360° of longitude.
    expect(east.lng - start.lng).toBeCloseTo((80 / (256 * 2 ** 14)) * 360, 9);
    const south = panByPixels(start, 14, 0, 80);
    expect(south.lat).toBeLessThan(start.lat);
    expect(south.lng).toBeCloseTo(start.lng, 9);
    const back = panByPixels(panByPixels(start, 14, 37, -55), 14, -37, 55);
    expect(back.lat).toBeCloseTo(start.lat, 9);
    expect(back.lng).toBeCloseTo(start.lng, 9);
  });

  it("moves half as far in degrees one zoom level in", () => {
    const start = { lat: -33.87, lng: 151.21 };
    const out = panByPixels(start, 12, 0, -100);
    const inner = panByPixels(start, 13, 0, -100);
    expect(inner.lat - start.lat).toBeCloseTo((out.lat - start.lat) / 2, 5);
  });
});
