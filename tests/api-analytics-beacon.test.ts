import { afterEach, describe, expect, it, vi } from "vitest";

// Live mode: the beacon only sends when the API is configured.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { recordEventView } = await import("@/lib/api/analytics");

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The server only counts a same-origin `fetch` with a JSON body
 * (lib/server/handlers/event-views.ts, isOwnBeacon): never sendBeacon, whose
 * text/plain body is ignored. This pins the beacon to that shape.
 */
describe("recordEventView (the view beacon)", () => {
  it("is a same-origin JSON fetch that survives the page closing, with no credentials", () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const sendBeacon = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("navigator", { sendBeacon });
    recordEventView("evt-1", { source: "instagram", code: "abcd2345" });
    expect(sendBeacon).not.toHaveBeenCalled();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/events/evt-1/view"); // relative: same origin
    expect(init).toMatchObject({ method: "POST", keepalive: true, credentials: "omit" });
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ source: "instagram", code: "abcd2345" });
  });
});
