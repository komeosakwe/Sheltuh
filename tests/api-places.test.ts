import { afterEach, describe, expect, it, vi } from "vitest";
import { PLACES_SESSION_TOKEN_PATTERN } from "@/lib/server/places";

// Live mode.
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: true,
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
}));

const places = await import("@/lib/api/places");
const { ApiError } = await import("@/lib/api/client");

const getToken = async () => "tok";

function stubFetch(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lib/api/places.ts", () => {
  it("POSTs what's typed and the place id in the body (never the URL), with the session token and the caller's token", async () => {
    const fetch = stubFetch({ suggestions: [] });
    const session = places.newPlacesSessionToken();
    await places.autocompletePlaces("the tote", session, getToken);
    await places.getPlaceDetails("ChIJtoteHotelCollingwood001", session, getToken);
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, JSON.parse(init.body)])).toEqual([
      ["/api/places/autocomplete", "POST", { input: "the tote", sessionToken: session }],
      ["/api/places/details", "POST", { placeId: "ChIJtoteHotelCollingwood001", sessionToken: session }],
    ]);
    for (const [, init] of fetch.mock.calls) expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("a new session token each search, in the form the routes take", () => {
    const a = places.newPlacesSessionToken();
    const b = places.newPlacesSessionToken();
    expect(a).not.toBe(b);
    expect(PLACES_SESSION_TOKEN_PATTERN.test(a)).toBe(true);
  });

  it("isPlacesUnavailableError: the 503 with code places_unavailable only", async () => {
    stubFetch({ error: "Google Maps search isn't available right now.", code: "places_unavailable" }, 503);
    const err = await places.autocompletePlaces("tote", places.newPlacesSessionToken(), getToken).catch((e: unknown) => e);
    expect(places.isPlacesUnavailableError(err)).toBe(true);
    expect(places.isPlacesUnavailableError(new ApiError(503, "Down"))).toBe(false);
    expect(places.isPlacesUnavailableError(new ApiError(429, "Slow down", undefined, { code: "places_unavailable" }))).toBe(false);
    expect(places.isPlacesUnavailableError(new Error("x"))).toBe(false);
  });
});
