import { describe, expect, it } from "vitest";
import { resolveEventCoordinates } from "../lib/geo";
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
