/**
 * Loads lib/location.ts (and its Australia-wide suburb table) on demand, once
 * per page, so client components that only sometimes need it don't carry it
 * in their bundle: the location picker when it opens, and near-you results
 * when they're shown. A failed load is forgotten, so the next call retries.
 */
export type LocationModule = typeof import("./location");

let pending: Promise<LocationModule> | null = null;
let loaded: LocationModule | null = null;

export function loadLocation(): Promise<LocationModule> {
  pending ??= import("./location").then(
    (module) => (loaded = module),
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

/** The module if it has already loaded (to skip a loading state), otherwise null. */
export function loadedLocation(): LocationModule | null {
  return loaded;
}
