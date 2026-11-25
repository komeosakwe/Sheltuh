import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { createAccountStore, FRESH_MS, resetAccountStores } from "@/lib/auth/account-store";
import { AccountMismatchError, SessionExpiredError } from "@/lib/auth/session-token";
import { isTransientFailure } from "@/lib/auth/transient-failure";

/** The signed-in account's shared records (lib/auth/account-store.ts): one request, one copy, one account. */

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-25T00:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createAccountStore", () => {
  it("shares one request between every reader that loads while it's in flight", async () => {
    const store = createAccountStore<string>();
    const answer = deferred<string>();
    const fetcher = vi.fn(() => answer.promise);
    const loads = [store.load("a", fetcher), store.load("a", fetcher), store.load("a", fetcher)];
    expect(fetcher).toHaveBeenCalledTimes(1);
    answer.resolve("record");
    await Promise.all(loads);
    expect(store.snapshot()).toMatchObject({ account: "a", value: "record" });
  });

  it("keeps the settled answer for a reader that mounts later, and checks it again quietly once it's no longer fresh", async () => {
    const store = createAccountStore<string>();
    const fetcher = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    await store.load("a", fetcher);
    // A moment later (the readers on one page mounting together): no second request.
    await store.load("a", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FRESH_MS);
    const again = store.load("a", fetcher);
    // The known answer stays meanwhile: nothing goes back to loading.
    expect(store.snapshot()?.value).toBe("first");
    await again;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(store.snapshot()?.value).toBe("second");
  });

  it("recheck (a sign-in) asks again however fresh the answer is, but still joins a request in flight", async () => {
    const store = createAccountStore<string>();
    await store.load("a", () => Promise.resolve("before"));
    const answer = deferred<string>();
    const fetcher = vi.fn(() => answer.promise);
    const loads = [store.load("a", fetcher, { recheck: true }), store.load("a", fetcher, { recheck: true }), store.load("a", fetcher)];
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.snapshot()?.value).toBe("before");
    answer.resolve("after");
    await Promise.all(loads);
    expect(store.snapshot()?.value).toBe("after");
  });

  it("tells subscribers about each change, and stops when they unsubscribe", async () => {
    const store = createAccountStore<string>();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    await store.load("a", () => Promise.resolve("record"));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.update(() => "saved");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a forced load asks again, and the answer it overtook is dropped", async () => {
    const store = createAccountStore<string>();
    const stale = deferred<string>();
    void store.load("a", () => stale.promise);
    await store.load("a", () => Promise.resolve("after the join"), { force: true });
    stale.resolve("before the join");
    await stale.promise;
    expect(store.snapshot()?.value).toBe("after the join");
  });

  it("a change saved elsewhere replaces the answer, and one already on its way is dropped (it may predate the change)", async () => {
    const store = createAccountStore<string>();
    await store.load("a", () => Promise.resolve("old logo"));
    vi.advanceTimersByTime(FRESH_MS);
    const inFlight = deferred<string>();
    const revalidation = store.load("a", () => inFlight.promise);
    store.update(({ value }) => (value === "old logo" ? "new logo" : null));
    expect(store.snapshot()?.value).toBe("new logo");
    inFlight.resolve("old logo");
    await revalidation;
    expect(store.snapshot()?.value).toBe("new logo");
    // `null`: no change.
    store.update(() => null);
    expect(store.snapshot()?.value).toBe("new logo");
  });

  it("is one account's only: another account's answer replaces it, and the first account's late answer never lands", async () => {
    const store = createAccountStore<string>();
    await store.load("a", () => Promise.resolve("a's"));
    vi.advanceTimersByTime(FRESH_MS);
    const late = deferred<string>();
    void store.load("a", () => late.promise);
    const bAnswer = deferred<string>();
    const forB = store.load("b", () => bAnswer.promise);
    // Still labelled a's until b's arrives (readers show only their own account's: useOrganiser, useProfile).
    expect(store.snapshot()?.account).toBe("a");
    late.resolve("a's again");
    await late.promise;
    expect(store.snapshot()).toMatchObject({ account: "a", value: "a's" });
    bAnswer.resolve("b's");
    await forB;
    expect(store.snapshot()).toMatchObject({ account: "b", value: "b's" });
  });

  it("a fetcher that rejects isn't left in flight: nothing settles, and the next load asks again", async () => {
    const store = createAccountStore<string>();
    await expect(store.load("a", () => Promise.reject(new Error("no")))).resolves.toBeUndefined();
    expect(store.snapshot()).toBeNull();
    const next = vi.fn(() => Promise.resolve("a's"));
    await store.load("a", next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toMatchObject({ account: "a", value: "a's" });
  });

  it("clear (a Sign out) forgets it and drops anything in flight; resetAccountStores clears every store", async () => {
    const store = createAccountStore<string>();
    const other = createAccountStore<number>();
    await store.load("a", () => Promise.resolve("record"));
    await other.load("a", () => Promise.resolve(1));
    const inFlight = deferred<string>();
    const loading = store.load("a", () => inFlight.promise, { force: true });
    store.clear();
    inFlight.resolve("record");
    await loading;
    expect(store.snapshot()).toBeNull();
    resetAccountStores();
    expect(other.snapshot()).toBeNull();
  });

  it("a fetcher that rejects (the session is someone else's) keeps and clears nothing, and doesn't block the next load", async () => {
    const store = createAccountStore<string>();
    await store.load("a", () => Promise.resolve("a's"));
    const listener = vi.fn();
    store.subscribe(listener);
    // The page still says b, but the session is a's by now: no answer for b.
    await expect(store.load("b", () => Promise.reject(new Error("someone else's session")))).resolves.toBeUndefined();
    expect(store.snapshot()).toMatchObject({ account: "a", value: "a's" });
    expect(listener).not.toHaveBeenCalled();
    // Not left in flight: the next load for b asks again rather than joining the rejected one.
    const again = vi.fn(() => Promise.resolve("b's"));
    await store.load("b", again);
    expect(again).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toMatchObject({ account: "b", value: "b's" });
  });
});

describe("createAccountStore with isFailure (a failed check)", () => {
  type Answer = { record: string | null } | { error: string };
  const failed = (value: Answer) => "error" in value;
  const known = async (store: ReturnType<typeof createAccountStore<Answer>>, value: Answer) => {
    await store.load("a", () => Promise.resolve(value));
    vi.advanceTimersByTime(FRESH_MS);
  };

  it("a quiet check, or a sign-in's recheck, that fails keeps the good answer it was checking", async () => {
    const store = createAccountStore<Answer>({ isFailure: failed });
    await known(store, { record: "mine" });
    const listener = vi.fn();
    store.subscribe(listener);
    await store.load("a", () => Promise.resolve({ error: "Network error" }));
    expect(store.snapshot()?.value).toEqual({ record: "mine" });
    await store.load("a", () => Promise.resolve({ error: "Server error" }), { recheck: true });
    expect(store.snapshot()?.value).toEqual({ record: "mine" });
    expect(listener).not.toHaveBeenCalled();
    // And the next check that works lands.
    await store.load("a", () => Promise.resolve({ record: "changed" }));
    expect(store.snapshot()?.value).toEqual({ record: "changed" });
  });

  it("any answer that isn't a failure lands: a record that's gone, a changed status", async () => {
    const store = createAccountStore<Answer>({ isFailure: failed });
    await known(store, { record: "approved" });
    await store.load("a", () => Promise.resolve({ record: "suspended" }));
    expect(store.snapshot()?.value).toEqual({ record: "suspended" });
    vi.advanceTimersByTime(FRESH_MS);
    await store.load("a", () => Promise.resolve({ record: null }));
    expect(store.snapshot()?.value).toEqual({ record: null });
  });

  it("a failure lands with nothing good to keep (the first load, or a failure already shown), and when the person asked (force)", async () => {
    const store = createAccountStore<Answer>({ isFailure: failed });
    await store.load("a", () => Promise.resolve({ error: "First" }));
    expect(store.snapshot()?.value).toEqual({ error: "First" });
    vi.advanceTimersByTime(FRESH_MS);
    await store.load("a", () => Promise.resolve({ error: "Second" }));
    expect(store.snapshot()?.value).toEqual({ error: "Second" });

    await store.load("a", () => Promise.resolve({ record: "mine" }), { force: true });
    await store.load("a", () => Promise.resolve({ error: "Try again failed" }), { force: true });
    expect(store.snapshot()?.value).toEqual({ error: "Try again failed" });
  });

  it("another account's failure replaces the last account's good answer (it's never kept for them)", async () => {
    const store = createAccountStore<Answer>({ isFailure: failed });
    await known(store, { record: "a's" });
    await store.load("b", () => Promise.resolve({ error: "Network error" }));
    expect(store.snapshot()).toMatchObject({ account: "b", value: { error: "Network error" } });
  });

  it("a Sign out still forgets a good answer", async () => {
    const store = createAccountStore<Answer>({ isFailure: failed });
    await known(store, { record: "mine" });
    store.clear();
    expect(store.snapshot()).toBeNull();
  });
});

describe("isTransientFailure", () => {
  it("passing: offline or a timeout (status 0), a 5xx, a 429, an error that isn't the API's", () => {
    for (const err of [new ApiError(0, "Couldn't reach the server."), new ApiError(500, "x"), new ApiError(503, "x"), new ApiError(429, "x"), new TypeError("x")]) {
      expect(isTransientFailure(err)).toBe(true);
    }
  });

  it("the API's answer: 401, 403, any other 4xx, and a session that's over", () => {
    for (const err of [new ApiError(401, "x"), new ApiError(403, "x"), new ApiError(400, "x"), new ApiError(409, "x"), new SessionExpiredError(), new AccountMismatchError()]) {
      expect(isTransientFailure(err)).toBe(false);
    }
  });
});

