import { afterEach, describe, expect, it, vi } from "vitest";

// Live mode: the client only calls the API when Supabase is configured.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { adminListEmailJobs } = await import("@/lib/api/admin");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("adminListEmailJobs", () => {
  it("sends `reference` whenever one is given (an empty one too, for the API's 400), and leaves it out otherwise", async () => {
    const fetch = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const getToken = async () => "token";
    const query = (call: number) => new URL(fetch.mock.calls[call][0] as string, "http://x").searchParams;

    await adminListEmailJobs("failed", getToken);
    expect(query(0).has("reference")).toBe(false);
    await adminListEmailJobs("failed", getToken, undefined, "#7C1F2E0A");
    expect(query(1).get("reference")).toBe("#7C1F2E0A");
    await adminListEmailJobs("failed", getToken, undefined, "");
    expect(query(2).get("reference")).toBe("");
  });
});
