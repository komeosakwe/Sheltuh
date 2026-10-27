import { distanceKm } from "@/lib/geo";
import type { Locality, NearestResult } from "@/lib/location";
import type { LocationModule } from "@/lib/location-loader";

/**
 * A few suburbs in place of the suburb table (lib/location.ts, ~15k rows,
 * slow to decode under a loaded test run), for editor tests that aren't about
 * the suburb (code review, 26 Oct 2026). Mock lib/location-loader with it:
 *
 *   vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());
 *
 * The suburb's own behaviour is tested against the real table
 * (tests/VenueSuburbField.test.tsx, tests/location.test.ts).
 */
const PLACES: readonly Locality[] = [
  { name: "Fitzroy", state: "VIC", lat: -37.8, lng: 144.98 },
  { name: "Collingwood", state: "VIC", lat: -37.8, lng: 144.99 },
  { name: "Brunswick", state: "VIC", lat: -37.77, lng: 144.96 },
  { name: "Perth", state: "WA", lat: -31.95, lng: 115.86 },
  { name: "Braddon", state: "ACT", lat: -35.27, lng: 149.13 },
];

const key = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function findLocality(text: string): Locality | null {
  const typed = key(text);
  return PLACES.find((place) => typed === key(place.name) || typed === key(`${place.name} ${place.state}`)) ?? null;
}

/** The stub's nearest suburb: the closest of PLACES within 3 km, else outside (the real one uses each suburb's reach). */
function nearestLocality(position: { lat: number; lng: number }): NearestResult {
  let best: Locality | null = null;
  let bestKm = 3;
  for (const place of PLACES) {
    const km = distanceKm(position, place);
    if (km <= bestKm) {
      best = place;
      bestKm = km;
    }
  }
  return best ? { kind: "found", locality: best } : { kind: "outside" };
}

/** The parts of the suburb table's module the event editor and the venue pin picker use. */
export const locationStub: Pick<
  LocationModule,
  "findLocality" | "didYouMean" | "suggestLocalities" | "isBareCityCentre" | "sameNameElsewhere" | "nearestLocality"
> = {
  nearestLocality,
  findLocality,
  didYouMean: () => null,
  suggestLocalities: (text) => {
    const typed = key(text);
    return typed.length < 2 ? [] : PLACES.filter((place) => key(place.name).startsWith(typed));
  },
  isBareCityCentre: (text) => ["cbd", "city"].includes(key(text)),
  sameNameElsewhere: () => [],
};

/** lib/location-loader's exports, answering with the stub at once (already loaded). */
export function locationLoaderStub() {
  return {
    loadLocation: () => Promise.resolve(locationStub),
    loadedLocation: () => locationStub,
  };
}
