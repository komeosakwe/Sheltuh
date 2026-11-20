import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { getMe } = await import("@/lib/api/me");
const { ApiError } = await import("@/lib/api/client");

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const getToken = async () => "tok";

describe("getMe", () => {
  it("GETs /api/me with the bearer token and returns the summary", async () => {
    const fetch = stub({ upcomingCount: 3 });
    await expect(getMe(getToken)).resolves.toEqual({ upcomingCount: 3 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/me");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("an error status is an ApiError (403: email not verified)", async () => {
    stub({ error: "Verify your email address first." }, 403);
    await expect(getMe(getToken)).rejects.toSatisfy((err) => err instanceof ApiError && err.status === 403);
  });

  it("an aborted signal cancels it", async () => {
    stub({ upcomingCount: 0 });
    const controller = new AbortController();
    controller.abort();
    await expect(getMe(getToken, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
