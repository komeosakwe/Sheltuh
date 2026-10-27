import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLACE_NOT_FOUND,
  PLACE_NOT_IN_AUSTRALIA,
  PLACES_PLATFORM_DAILY_CAPS,
  PLACES_QUOTA_TIME_ZONE,
  PLACES_RATE_LIMITS,
  PLACES_UNAVAILABLE,
  placesAutocomplete,
  placesDetails,
  type PlacesRateLimit,
} from "@/lib/server/handlers/places";
import { applyAsOrganiser } from "@/lib/server/handlers/organisers";
import {
  createPlaces,
  isAustralianRegion,
  MAX_PLACE_SUGGESTIONS,
  PLACE_ID_PATTERN,
  placeFromGoogle,
  PLACES_FIELD_MASKS,
  PLACES_REGION_CODES,
  PLACES_SESSION_TOKEN_PATTERN,
  PLACES_TIMEOUT_MS,
  PlacesUnavailableError,
  stateFromComponents,
  suggestionsFromGoogle,
} from "@/lib/server/places";
import { AUCKLAND_PLACE_ID, TestApi, TOTE_PLACE_ID } from "./helpers/api";
import { application, approvedOrganiser, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * The venue search's Google Places proxy (lib/server/places.ts,
 * lib/server/handlers/places.ts; docs/architecture.md, "Venue location").
 * Google's coordinates are never asked for, read or returned.
 */

const KEY = "AIzaTestKeyNotReal_0123456789";
const SESSION = "0b6e0c5a-3f0e-4b8e-9d39-6c1d6f1d2a11";

/** A fake fetch answering `respond(url, init)`, recording every call. */
function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Place Details as Google could send it: the fields asked for, plus a position it might send anyway. */
const TOTE_DETAILS = {
  id: TOTE_PLACE_ID,
  formattedAddress: "71 Johnston St, Collingwood VIC 3066",
  location: { latitude: -37.7979123, longitude: 144.9888456 },
  viewport: { low: { latitude: -37.799, longitude: 144.987 }, high: { latitude: -37.796, longitude: 144.990 } },
  plusCode: { globalCode: "4RJ7MXXQ+RG" },
  addressComponents: [
    { longText: "71", shortText: "71", types: ["street_number"] },
    { longText: "Johnston Street", shortText: "Johnston St", types: ["route"] },
    { longText: "Collingwood", shortText: "Collingwood", types: ["locality", "political"] },
    { longText: "Victoria", shortText: "VIC", types: ["administrative_area_level_1", "political"] },
    { longText: "Australia", shortText: "AU", types: ["country", "political"] },
    { longText: "3066", shortText: "3066", types: ["postal_code"] },
  ],
};

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

describe("lib/server/places.ts", () => {
  it("never asks Google for a position: no location, viewport, plus code or geometry in any field mask", () => {
    for (const [name, mask] of Object.entries(PLACES_FIELD_MASKS)) {
      for (const path of mask.split(",")) {
        expect(path, `${name}: ${path}`).not.toMatch(/location|viewport|plusCode|geometry|latitude|longitude/i);
      }
    }
    expect(PLACES_FIELD_MASKS).toEqual({
      autocomplete: "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
      details: "id,formattedAddress,addressComponents",
      verify: "id,addressComponents",
    });
  });

  it("is off without a key", () => {
    expect(createPlaces(undefined)).toBeUndefined();
    expect(createPlaces("")).toBeUndefined();
    expect(createPlaces("   ")).toBeUndefined();
  });

  it("autocomplete: POST with the key and field mask in headers (never the URL), Australia's region codes, en-AU, a 5 s timeout", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        suggestions: [
          { queryPrediction: { text: { text: "the tote" } } },
          {
            placePrediction: {
              placeId: TOTE_PLACE_ID,
              structuredFormat: { mainText: { text: "The Tote Hotel" }, secondaryText: { text: "Johnston Street, Collingwood VIC" } },
              location: { latitude: -37.79, longitude: 144.98 },
            },
          },
          { placePrediction: { placeId: "bad id", structuredFormat: { mainText: { text: "Bad" } } } },
          ...Array.from({ length: 8 }, (_, i) => ({
            placePrediction: { placeId: `ChIJmorePlaces0000000000${i}`, text: { text: `Place\u0007 ${i}` } },
          })),
        ],
      }),
    );
    const places = createPlaces(` ${KEY} `, fetch)!;
    const suggestions = await places.autocomplete("the tote", SESSION);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(url).not.toContain(KEY);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": PLACES_FIELD_MASKS.autocomplete,
      "content-type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      input: "the tote",
      sessionToken: SESSION,
      includedRegionCodes: ["au", "cx", "cc", "nf"],
      languageCode: "en-AU",
      regionCode: "au",
    });
    expect(init.body).not.toContain(KEY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe("error");
    expect(PLACES_TIMEOUT_MS).toBe(5_000);
    // Query predictions and malformed ids skipped; at most 5; control characters out; no position.
    expect(suggestions).toHaveLength(MAX_PLACE_SUGGESTIONS);
    expect(suggestions[0]).toEqual({
      placeId: TOTE_PLACE_ID,
      primaryText: "The Tote Hotel",
      secondaryText: "Johnston Street, Collingwood VIC",
    });
    expect(suggestions[1]).toEqual({ placeId: "ChIJmorePlaces00000000000", primaryText: "Place 0", secondaryText: "" });
    expect(JSON.stringify(suggestions)).not.toMatch(/latitude|longitude|-37\.79/);
  });

  it("details: GET by place id with the session token, address parts only (Google's position dropped)", async () => {
    const { fetch, calls } = fakeFetch(() => json(TOTE_DETAILS));
    const place = await createPlaces(KEY, fetch)!.details(TOTE_PLACE_ID, SESSION);
    expect(calls[0].url).toBe(
      `https://places.googleapis.com/v1/places/${TOTE_PLACE_ID}?languageCode=en-AU&regionCode=au&sessionToken=${SESSION}`,
    );
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers).toEqual({ "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": PLACES_FIELD_MASKS.details });
    expect(place).toEqual({
      placeId: TOTE_PLACE_ID,
      formattedAddress: "71 Johnston St, Collingwood VIC 3066",
      streetAddress: "71 Johnston St",
      locality: "Collingwood",
      postcode: "3066",
      regionCode: "AU",
      state: "VIC",
    });
    expect(JSON.stringify(place)).not.toMatch(/latitude|longitude|viewport|plusCode|-37\.797|144\.988/);
  });

  it("verify: no session, the smaller mask", async () => {
    const { fetch, calls } = fakeFetch(() => json({ id: TOTE_PLACE_ID, addressComponents: TOTE_DETAILS.addressComponents }));
    const place = await createPlaces(KEY, fetch)!.verify(TOTE_PLACE_ID);
    expect(calls[0].url).toBe(`https://places.googleapis.com/v1/places/${TOTE_PLACE_ID}?languageCode=en-AU&regionCode=au`);
    expect(calls[0].init.headers).toMatchObject({ "X-Goog-FieldMask": PLACES_FIELD_MASKS.verify });
    expect(place).toMatchObject({ placeId: TOTE_PLACE_ID, formattedAddress: null, state: "VIC", regionCode: "AU" });
  });

  it("an unknown or malformed place is null; a malformed one never reaches Google", async () => {
    const notFound = fakeFetch(() => json({ error: { code: 404, status: "NOT_FOUND" } }, 404));
    expect(await createPlaces(KEY, notFound.fetch)!.details(TOTE_PLACE_ID, SESSION)).toBeNull();
    const invalid = fakeFetch(() =>
      json({ error: { code: 400, message: "Not a valid Place ID: ChIJtoteHotel", status: "INVALID_ARGUMENT" } }, 400),
    );
    expect(await createPlaces(KEY, invalid.fetch)!.verify(TOTE_PLACE_ID)).toBeNull();
    const notFound400 = fakeFetch(() => json({ error: { code: 400, message: "Requested entity was not found.", status: "NOT_FOUND" } }, 400));
    expect(await createPlaces(KEY, notFound400.fetch)!.verify(TOTE_PLACE_ID)).toBeNull();
    const never = fakeFetch(() => json(TOTE_DETAILS));
    expect(await createPlaces(KEY, never.fetch)!.verify("../places:autocomplete")).toBeNull();
    expect(never.calls).toEqual([]);
  });

  it("a bad key, a disabled API, billing or any other 400 is unavailable (a manual pin), not an unknown place", async () => {
    const cases: [() => Response, string][] = [
      [
        () =>
          json(
            {
              error: {
                code: 400,
                message: "API key not valid. Please pass a valid API key.",
                status: "INVALID_ARGUMENT",
                details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }],
              },
            },
            400,
          ),
        "http_400",
      ],
      // Even a message naming the place id, if Google says the key is the problem.
      [
        () =>
          json(
            { error: { status: "INVALID_ARGUMENT", message: "Place ID lookups need a key", details: [{ reason: "API_KEY_INVALID" }] } },
            400,
          ),
        "http_400",
      ],
      [() => json({ error: { code: 400, message: "Invalid field mask.", status: "INVALID_ARGUMENT" } }, 400), "http_400"],
      [() => new Response("<html>bad request</html>", { status: 400 }), "http_400"],
      [() => json({ error: { code: 403, status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }, 403), "http_403"],
      [() => json({ error: { code: 403, status: "PERMISSION_DENIED", details: [{ reason: "BILLING_DISABLED" }] } }, 403), "http_403"],
    ];
    for (const [respond, reason] of cases) {
      const places = createPlaces(KEY, fakeFetch(respond).fetch)!;
      for (const call of [() => places.details(TOTE_PLACE_ID, SESSION), () => places.verify(TOTE_PLACE_ID)]) {
        const err = await call().catch((e: unknown) => e);
        expect(err, reason).toBeInstanceOf(PlacesUnavailableError);
        expect((err as PlacesUnavailableError).reason).toBe(reason);
      }
    }
  });

  it("Google refusing, failing, timing out or unreachable is PlacesUnavailableError with a fixed reason (never the key)", async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => json({ error: { message: `API key ${KEY} not valid` } }, 403), "http_403"],
      [() => json({ error: { status: "RESOURCE_EXHAUSTED" } }, 429), "http_429"],
      [() => new Response("oops", { status: 500 }), "http_500"],
      [() => new Response("not json", { status: 200 }), "bad_response"],
      [() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")), "timeout"],
      [() => Promise.reject(new TypeError("fetch failed")), "network"],
    ];
    for (const [respond, reason] of cases) {
      const { fetch } = fakeFetch(respond);
      const places = createPlaces(KEY, fetch)!;
      for (const call of [() => places.autocomplete("tote", SESSION), () => places.details(TOTE_PLACE_ID, SESSION)]) {
        const err = await call().catch((e: unknown) => e);
        expect(err, reason).toBeInstanceOf(PlacesUnavailableError);
        expect((err as PlacesUnavailableError).reason).toBe(reason);
        expect((err as Error).message).not.toContain(KEY);
      }
    }
  });

  it("states: each Australian state's code, OT for Jervis Bay and the external territories, null elsewhere", () => {
    const components = (country: string, area?: { longText: string; shortText: string }) => [
      ...(area ? [{ ...area, types: ["administrative_area_level_1", "political"] }] : []),
      { longText: country, shortText: country, types: ["country", "political"] },
    ];
    for (const code of ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]) {
      expect(stateFromComponents(components("AU", { longText: code, shortText: code }))).toEqual({ regionCode: "AU", state: code });
    }
    expect(stateFromComponents(components("AU", { longText: "Jervis Bay Territory", shortText: "JBT" })).state).toBe("OT");
    expect(stateFromComponents(components("AU", { longText: "Jervis Bay Territory", shortText: "Jervis Bay Territory" })).state).toBe("OT");
    for (const territory of ["CX", "CC", "NF"]) {
      expect(stateFromComponents(components(territory))).toEqual({ regionCode: territory, state: "OT" });
    }
    expect(stateFromComponents(components("AU"))).toEqual({ regionCode: "AU", state: null });
    expect(stateFromComponents(components("NZ", { longText: "Auckland", shortText: "AUK" }))).toEqual({ regionCode: "NZ", state: null });
    expect(stateFromComponents(undefined)).toEqual({ regionCode: null, state: null });
    expect(isAustralianRegion("AU")).toBe(true);
    expect(isAustralianRegion("cx")).toBe(true);
    expect(isAustralianRegion("NZ")).toBe(false);
    expect(isAustralianRegion(null)).toBe(false);
    expect([...PLACES_REGION_CODES]).toEqual(["au", "cx", "cc", "nf"]);
  });

  it("parsers: anything malformed is skipped or null, never thrown", () => {
    expect(suggestionsFromGoogle(null)).toEqual([]);
    expect(suggestionsFromGoogle({ suggestions: "x" })).toEqual([]);
    expect(placeFromGoogle("x", TOTE_PLACE_ID)).toBeNull();
    expect(placeFromGoogle({ addressComponents: [null, 3, { types: "route" }] }, TOTE_PLACE_ID)).toEqual({
      placeId: TOTE_PLACE_ID,
      formattedAddress: null,
      streetAddress: null,
      locality: null,
      postcode: null,
      regionCode: null,
      state: null,
    });
  });

  it("the id and session token patterns", () => {
    expect(PLACE_ID_PATTERN.test(TOTE_PLACE_ID)).toBe(true);
    expect(PLACE_ID_PATTERN.test("EicxMyBNYXJrZXQgU3QsIFdpbHRvbiBOU1cgMjU3MSwgQXVzdHJhbGlhIjESLwoUChIJ-w")).toBe(true);
    for (const bad of ["short", "ChIJ has spaces in it!!", "ChIJ/slashes/in/it/000000", "a".repeat(257)]) {
      expect(PLACE_ID_PATTERN.test(bad), bad).toBe(false);
    }
    expect(PLACES_SESSION_TOKEN_PATTERN.test(SESSION)).toBe(true);
    expect(PLACES_SESSION_TOKEN_PATTERN.test(crypto.randomUUID())).toBe(true);
    for (const bad of ["short", "x".repeat(37), "has space in it", "semi;colon00"]) {
      expect(PLACES_SESSION_TOKEN_PATTERN.test(bad), bad).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

describe("POST /api/places/autocomplete and /details", () => {
  let api: TestApi;
  let reset: () => Promise<void>;
  let admin: { token: string; userId: string };
  let organiser: { token: string; userId: string; organiserId: string };

  beforeAll(async () => {
    const testDb = await createTestDb();
    reset = testDb.reset;
    api = new TestApi(testDb.db);
  });

  beforeEach(async () => {
    await reset();
    api = new TestApi(api.db);
    admin = await signUpAdmin(api);
    organiser = await approvedOrganiser(api, admin);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const search = (body: unknown, token: string | undefined = organiser.token) =>
    api.call(placesAutocomplete, { token, body, method: "POST" });
  const details = (body: unknown, token: string | undefined = organiser.token) =>
    api.call(placesDetails, { token, body, method: "POST" });

  it("an approved organiser gets suggestions, private and uncached", async () => {
    const res = await search({ input: "  the\u0000 tote\n hotel ", sessionToken: SESSION });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({
      suggestions: [{ placeId: TOTE_PLACE_ID, primaryText: "The Tote Hotel", secondaryText: "Johnston Street, Collingwood VIC, Australia" }],
    });
    // Cleaned before it's sent on.
    expect(api.places!.inputs).toEqual(["the tote hotel"]);
    expect(api.places!.calls).toEqual([{ method: "autocomplete", sessionToken: SESSION }]);
  });

  it("details: the address parts to prefill, never a position", async () => {
    const res = await details({ placeId: TOTE_PLACE_ID, sessionToken: SESSION });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.body).toEqual({
      placeId: TOTE_PLACE_ID,
      formattedAddress: "71 Johnston St, Collingwood VIC 3066",
      streetAddress: "71 Johnston St",
      locality: "Collingwood",
      state: "VIC",
      postcode: "3066",
      googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=71%20Johnston%20St%2C%20Collingwood%20VIC%203066&query_place_id=${TOTE_PLACE_ID}`,
    });
    expect(api.places!.calls).toEqual([{ method: "details", placeId: TOTE_PLACE_ID, sessionToken: SESSION }]);
  });

  it("admins may search too; signed out is 401; a member, or an organiser not approved, 403", async () => {
    expect((await search({ input: "tote", sessionToken: SESSION }, admin.token)).status).toBe(200);
    expect((await details({ placeId: TOTE_PLACE_ID, sessionToken: SESSION }, admin.token)).status).toBe(200);
    expect((await search({ input: "tote", sessionToken: SESSION }, "")).status).toBe(401);
    expect((await details({ placeId: TOTE_PLACE_ID, sessionToken: SESSION }, "")).status).toBe(401);
    const member = await api.signUp();
    expect((await search({ input: "tote", sessionToken: SESSION }, member.token)).status).toBe(403);
    const pending = await api.signUp();
    await api.call(applyAsOrganiser, { token: pending.token, body: { ...application, displayName: "Pending Co" } });
    expect((await search({ input: "tote", sessionToken: SESSION }, pending.token)).status).toBe(403);
    expect((await details({ placeId: TOTE_PLACE_ID, sessionToken: SESSION }, pending.token)).status).toBe(403);
    // Only the admin's two calls reached Google.
    expect(api.places!.calls).toHaveLength(2);
  });

  it("400 for bad input, before Google or the allowance", async () => {
    const cases: [unknown, string[]][] = [
      [{ input: "t", sessionToken: SESSION }, ["input"]],
      [{ input: " \u0001 t \u0002 ", sessionToken: SESSION }, ["input"]],
      [{ input: "x".repeat(121), sessionToken: SESSION }, ["input"]],
      [{ input: 42, sessionToken: SESSION }, ["input"]],
      [{ input: "tote" }, ["sessionToken"]],
      [{ input: "tote", sessionToken: "bad token" }, ["sessionToken"]],
      [{}, ["input", "sessionToken"]],
    ];
    for (const [body, fields] of cases) {
      const res = await search(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(Object.keys(res.body.fieldErrors).sort()).toEqual(fields);
    }
    for (const body of [{ placeId: "short", sessionToken: SESSION }, { placeId: TOTE_PLACE_ID }, { placeId: 7, sessionToken: SESSION }]) {
      expect((await details(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(api.places!.calls).toEqual([]);
    const [{ count }] = await api.db.query<{ count: number }>(`select count(*)::int as count from private.rate_limits where bucket like 'places_%'`);
    expect(count).toBe(0);
  });

  it("a place Google doesn't know, or outside Australia: 400 fieldErrors.placeId", async () => {
    const unknown = await details({ placeId: "ChIJunknownPlaceId00000001", sessionToken: SESSION });
    expect(unknown.status).toBe(400);
    expect(unknown.body.fieldErrors).toEqual({ placeId: PLACE_NOT_FOUND });
    const abroad = await details({ placeId: AUCKLAND_PLACE_ID, sessionToken: SESSION });
    expect(abroad.status).toBe(400);
    expect(abroad.body.fieldErrors).toEqual({ placeId: PLACE_NOT_IN_AUSTRALIA });
  });

  it("503 places_unavailable without a key (no allowance taken), or when Google fails", async () => {
    api.places = undefined;
    for (const res of [await search({ input: "tote", sessionToken: SESSION }), await details({ placeId: TOTE_PLACE_ID, sessionToken: SESSION })]) {
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: PLACES_UNAVAILABLE, code: "places_unavailable" });
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    const [{ count }] = await api.db.query<{ count: number }>(`select count(*)::int as count from private.rate_limits where bucket like 'places_%'`);
    expect(count).toBe(0);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    api.places = new (await import("./helpers/api")).FakePlaces();
    api.places.failing = true;
    expect((await search({ input: "tote", sessionToken: SESSION })).status).toBe(503);
    expect((await details({ placeId: TOTE_PLACE_ID, sessionToken: SESSION })).status).toBe(503);
  });

  /** Uses up `limit` for `userId`. */
  const exhaust = (userId: string, limit: PlacesRateLimit) =>
    api.db.query(`select private.take_rate_limit($1, $2, $3, $4::interval) from generate_series(1, $3)`, [
      userId,
      limit.bucket,
      limit.hits,
      limit.window,
    ]);

  /** The platform's bucket for `kind` today (Google's day), as takeLimit names it. */
  async function platformBucket(kind: keyof typeof PLACES_PLATFORM_DAILY_CAPS): Promise<string> {
    const [{ bucket }] = await api.db.query<{ bucket: string }>(
      `select $1::text || ':' || to_char(now() at time zone $2, 'YYYY-MM-DD') as bucket`,
      [PLACES_PLATFORM_DAILY_CAPS[kind].bucket, PLACES_QUOTA_TIME_ZONE],
    );
    return bucket;
  }

  async function platformHits(kind: keyof typeof PLACES_PLATFORM_DAILY_CAPS): Promise<number | undefined> {
    const [row] = await api.db.query<{ hits: number }>(`select hits from private.platform_rate_limits where bucket = $1`, [
      await platformBucket(kind),
    ]);
    return row?.hits;
  }

  it("the allowances: an hour's and a day's per account, under the platform's daily caps, which are under Google's quotas", () => {
    expect(PLACES_RATE_LIMITS).toEqual({
      autocomplete: [
        { bucket: "places_autocomplete", hits: 100, window: "1 hour" },
        { bucket: "places_autocomplete_daily", hits: 400, window: "24 hours" },
      ],
      details: [
        { bucket: "places_details", hits: 30, window: "1 hour" },
        { bucket: "places_details_daily", hits: 120, window: "24 hours" },
      ],
    });
    expect(PLACES_PLATFORM_DAILY_CAPS).toEqual({
      autocomplete: { bucket: "places_autocomplete_day", hits: 1800 },
      details: { bucket: "places_details_day", hits: 450 },
    });
    // docs/DEPLOYMENT.md's Google Cloud quotas: Autocomplete 2,000, Place Details 500 a day.
    expect(PLACES_PLATFORM_DAILY_CAPS.autocomplete.hits).toBeLessThan(2000);
    expect(PLACES_PLATFORM_DAILY_CAPS.details.hits).toBeLessThan(500);
    // One account's day is at most a third of the platform's.
    for (const kind of ["autocomplete", "details"] as const) {
      expect(PLACES_RATE_LIMITS[kind][1].hits * 3).toBeLessThanOrEqual(PLACES_PLATFORM_DAILY_CAPS[kind].hits);
    }
  });

  it("each request takes the account's hour and day and the platform's day", async () => {
    expect((await search({ input: "tote", sessionToken: SESSION })).status).toBe(200);
    expect((await details({ placeId: TOTE_PLACE_ID, sessionToken: SESSION })).status).toBe(200);
    const rows = await api.db.query<{ bucket: string; hits: number }>(
      `select bucket, hits from private.rate_limits where user_id = $1 and bucket like 'places_%' order by bucket`,
      [organiser.userId],
    );
    expect(rows).toEqual([
      { bucket: "places_autocomplete", hits: 1 },
      { bucket: "places_autocomplete_daily", hits: 1 },
      { bucket: "places_details", hits: 1 },
      { bucket: "places_details_daily", hits: 1 },
    ]);
    expect(await platformHits("autocomplete")).toBe(1);
    expect(await platformHits("details")).toBe(1);
    expect(await platformBucket("details")).toMatch(/^places_details_day:\d{4}-\d{2}-\d{2}$/);
  });

  it("429 once the account's hourly or daily allowance is used, without asking Google or taking a platform slot", async () => {
    for (const index of [0, 1] as const) {
      await reset();
      api = new TestApi(api.db);
      admin = await signUpAdmin(api);
      organiser = await approvedOrganiser(api, admin);
      for (const kind of ["autocomplete", "details"] as const) await exhaust(organiser.userId, PLACES_RATE_LIMITS[kind][index]);
      const searched = await search({ input: "tote", sessionToken: SESSION });
      expect(searched.status, `allowance ${index}`).toBe(429);
      expect(searched.body.fieldErrors).toBeUndefined();
      expect((await details({ placeId: TOTE_PLACE_ID, sessionToken: SESSION })).status).toBe(429);
      expect(api.places!.calls).toEqual([]);
      expect(await platformHits("autocomplete")).toBeUndefined();
      expect(await platformHits("details")).toBeUndefined();
      // Another account is unaffected.
      expect((await search({ input: "tote", sessionToken: SESSION }, admin.token)).status).toBe(200);
    }
  });

  it("503 places_unavailable once the platform's cap for Google's day is used, logged as `daily_cap`, without asking Google", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const kind of ["autocomplete", "details"] as const) {
      await api.db.query(`insert into private.platform_rate_limits (bucket, window_started_at, hits) values ($1, now(), $2)`, [
        await platformBucket(kind),
        PLACES_PLATFORM_DAILY_CAPS[kind].hits,
      ]);
    }
    for (const res of [await search({ input: "tote", sessionToken: SESSION }), await details({ placeId: TOTE_PLACE_ID, sessionToken: SESSION })]) {
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: PLACES_UNAVAILABLE, code: "places_unavailable" });
    }
    expect(api.places!.calls).toEqual([]);
    expect(warn.mock.calls.map((args) => args.join(" "))).toEqual([
      "Google Places unavailable: daily_cap",
      "Google Places unavailable: daily_cap",
    ]);
    // Yesterday's (Google's) bucket full doesn't matter today.
    await api.db.query(`delete from private.platform_rate_limits`);
    await api.db.query(`insert into private.platform_rate_limits (bucket, window_started_at, hits) values ('places_details_day:2000-01-01', now(), 1000)`);
    expect((await details({ placeId: TOTE_PLACE_ID, sessionToken: SESSION })).status).toBe(200);
  });

  it("logs nothing of what was searched for, the place, or the session: Google's failure by its reason only", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    api.places!.failing = true;
    const secret = "Secret Warehouse 42 Smith";
    await search({ input: secret, sessionToken: SESSION });
    await details({ placeId: TOTE_PLACE_ID, sessionToken: SESSION });
    api.places!.failing = false;
    await search({ input: secret, sessionToken: SESSION });
    await details({ placeId: "ChIJunknownPlaceId00000001", sessionToken: SESSION });
    const logged = spies.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(" ")));
    expect(logged).toEqual(["Google Places unavailable: http_503", "Google Places unavailable: timeout"]);
    for (const line of logged) {
      expect(line).not.toContain("Secret");
      expect(line).not.toContain(SESSION);
      expect(line).not.toContain(TOTE_PLACE_ID);
    }
  });
});
