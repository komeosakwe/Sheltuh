import { afterEach, describe, expect, it, vi } from "vitest";

// Live mode: the client only calls the API when Supabase is configured.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { listPublicEvents } = await import("@/lib/api/public-events");

afterEach(() => {
  vi.unstubAllGlobals();
});

async function requestedPath(params: Parameters<typeof listPublicEvents>[0]) {
  const fetch = vi.fn().mockImplementation(
    async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  await listPublicEvents(params);
  return String(fetch.mock.calls[0][0]);
}

describe("listPublicEvents: recent", () => {
  it("sends recent=1 for true and recent=only for 'only'", async () => {
    expect(await requestedPath({ upcoming: true, recent: true })).toMatch(/\/events\?upcoming=1&recent=1$/);
    expect(await requestedPath({ upcoming: true, recent: "only", limit: 6 })).toMatch(/\/events\?upcoming=1&recent=only&limit=6$/);
  });

  it("sends nothing when absent or false (the original request)", async () => {
    expect(await requestedPath({ upcoming: true })).toMatch(/\/events\?upcoming=1$/);
    expect(await requestedPath({ upcoming: true, recent: false })).toMatch(/\/events\?upcoming=1$/);
  });
});
