import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountStore, FRESH_MS, resetAccountStores } from "@/lib/auth/account-store";

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

  it("is one account's only: another account's load clears it at once, and the first account's late answer never lands", async () => {
    const store = createAccountStore<string>();
    await store.load("a", () => Promise.resolve("a's"));
    vi.advanceTimersByTime(FRESH_MS);
    const late = deferred<string>();
    void store.load("a", () => late.promise);
    const bAnswer = deferred<string>();
    const forB = store.load("b", () => bAnswer.promise);
    expect(store.snapshot()).toBeNull();
    late.resolve("a's again");
    await late.promise;
    expect(store.snapshot()).toBeNull();
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
});
