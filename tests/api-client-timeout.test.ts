import { afterEach, describe, expect, it, vi } from "vitest";

// Live mode: the client only calls the API when Supabase is configured.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { apiFetch, ApiError, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } = await import("@/lib/api/client");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A fetch that never answers until its signal aborts, like a stalled server. */
function stalledFetch() {
  return vi.fn().mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
}

describe("apiFetch timeout", () => {
  it("fails a stalled request with a 'took too long' ApiError instead of hanging", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", stalledFetch());
    const result = apiFetch("/events?limit=1").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const err = await result;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, message: "The server took too long to respond. Try again." });
  });

  it("gives uploads the longer limit", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", stalledFetch());
    let settled = false;
    const result = apiFetch("/me/avatar", { method: "PUT", body: new Blob(["x"], { type: "image/png" }) })
      .catch((e: unknown) => e)
      .finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    expect(await result).toMatchObject({ status: 0, message: "The server took too long to respond. Try again." });
  });

  it("still throws the caller's own abort, not an ApiError", async () => {
    vi.stubGlobal("fetch", stalledFetch());
    const controller = new AbortController();
    const result = apiFetch("/events", { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    const err = await result;
    expect(err).not.toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ name: "AbortError" });
  });

  it("a request already aborted by the caller never succeeds", async () => {
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      init.signal?.throwIfAborted();
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(apiFetch("/events", { signal: controller.signal })).rejects.not.toBeInstanceOf(ApiError);
  });

  it("clears the timer once the response arrives", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } })),
    );
    await expect(apiFetch("/events")).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
