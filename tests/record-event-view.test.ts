import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recordEventView (what the beacon sends)", () => {
  it("is a same-origin application/json fetch with keepalive and no cookies, never sendBeacon", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const sendBeacon = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { sendBeacon });
    const { recordEventView } = await import("@/lib/api/analytics");

    recordEventView("evt 1", { source: "instagram", code: "ab3def7h" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/events/evt%201/view");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(String(init.body))).toEqual({ source: "instagram", code: "ab3def7h" });
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("swallows network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const { recordEventView } = await import("@/lib/api/analytics");
    expect(() => recordEventView("evt-1")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
