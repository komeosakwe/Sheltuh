import { describe, expect, it } from "vitest";
import { resolveEventCoordinates, resolveMapCoordinates } from "../lib/geo";
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
  it("returns coordinates inside Greater Melbourne", () => {
    const event = findEvent("neon-static");
    expect(resolveMapCoordinates(event)).toEqual(resolveEventCoordinates(event));
  });

  it("returns null for coordinates outside Greater Melbourne", () => {
    const event = { ...findEvent("neon-static"), coordinates: { lat: -33.8861, lng: 151.2111 } };
    expect(resolveEventCoordinates(event)).not.toBeNull();
    expect(resolveMapCoordinates(event)).toBeNull();
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
    // The New South Wales one is outside Greater Melbourne, so not pinned on the Melbourne map.
    expect(resolveEventCoordinates(at("Richmond NSW"), findLocality)?.lat).toBeCloseTo(-33.6, 1);
    expect(resolveMapCoordinates(at("Richmond NSW"), findLocality)).toBeNull();
  });

  it("still prefers the event's own coordinates", () => {
    const own = { lat: -37.81, lng: 144.96 };
    expect(resolveMapCoordinates(at("Box Hill", own), findLocality)).toEqual(own);
  });

  it.each(["Fitzroyy", "Nowhereville", "", "constructor", "__proto__"])("leaves %j unplaced", (suburb) => {
    expect(resolveMapCoordinates(at(suburb), findLocality)).toBeNull();
  });
});
