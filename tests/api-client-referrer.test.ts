import { afterEach, describe, expect, it, vi } from "vitest";

// Live mode: the client only calls the API when Supabase is configured.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { apiFetch } = await import("@/lib/api/client");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch Referer", () => {
  // /search?near=Fitzroy holds the visitor's suburb: the API is never told the page's address.
  it("sends only the origin as a Referer, on every method", async () => {
    const fetch = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    await apiFetch("/events?upcoming=true");
    await apiFetch("/events/e1/view", { method: "POST", body: { source: "direct" } });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ referrerPolicy: "strict-origin" });
  });
});
