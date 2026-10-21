import { describe, expect, it, vi } from "vitest";
import { FavouritesStore, type FavouritesBackend, type FavouritesSettled } from "@/components/favourites/favourites-store";
import { MAX_FAVOURITES } from "@/lib/api/types";

const ev = (id: string) => ({ id, title: `Event ${id}`, slug: id });

/** A backend whose requests stay open until the test settles them. */
function manualBackend() {
  const calls: { method: "put" | "del"; id: string; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const backend: FavouritesBackend = {
    put: (id) => new Promise<void>((resolve, reject) => calls.push({ method: "put", id, resolve, reject })),
    del: (id) => new Promise<void>((resolve, reject) => calls.push({ method: "del", id, resolve, reject })),
  };
  return { backend, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function readyStore(ids: string[] = []) {
  const { backend, calls } = manualBackend();
  const settled: FavouritesSettled[] = [];
  const store = new FavouritesStore(backend, (s) => settled.push(s));
  await store.load(async () => ids);
  return { store, calls, settled };
}

describe("FavouritesStore", () => {
  it("isn't ready until the ids load, and refuses taps until then", async () => {
    const { backend } = manualBackend();
    const store = new FavouritesStore(backend);
    expect(store.request(ev("a"), true)).toBe("not-ready");
    let resolve!: (ids: string[]) => void;
    const loading = store.load(() => new Promise<string[]>((r) => (resolve = r)));
    expect(store.getSnapshot().status).toBe("loading");
    resolve(["a"]);
    await loading;
    expect(store.getSnapshot()).toMatchObject({ status: "ready", count: 1 });
    expect(store.isSaved("a")).toBe(true);
  });

  it("a failed load is an error state", async () => {
    const { backend } = manualBackend();
    const store = new FavouritesStore(backend);
    await store.load(async () => {
      throw new Error("down");
    });
    expect(store.getSnapshot().status).toBe("error");
  });

  it("flips optimistically, then confirms", async () => {
    const { store, calls, settled } = await readyStore();
    expect(store.request(ev("a"), true)).toBe("sent");
    expect(store.isSaved("a")).toBe(true);
    expect(calls).toHaveLength(1);
    calls[0].resolve();
    await flush();
    expect(store.isSaved("a")).toBe(true);
    expect(settled).toEqual([{ kind: "saved", event: ev("a") }]);
  });

  it("rolls back and reports a failure", async () => {
    const { store, calls, settled } = await readyStore(["a"]);
    store.request(ev("a"), false);
    expect(store.isSaved("a")).toBe(false);
    const error = new Error("network");
    calls[0].reject(error);
    await flush();
    expect(store.isSaved("a")).toBe(true);
    expect(settled).toEqual([{ kind: "failed", event: ev("a"), intent: false, error }]);
  });

  it("serialises per event and the latest intent wins", async () => {
    const { store, calls, settled } = await readyStore();
    store.request(ev("a"), true);
    store.request(ev("a"), false); // while the PUT is in flight
    store.request(ev("a"), true);
    store.request(ev("a"), false);
    expect(calls).toHaveLength(1); // only one request at a time
    expect(store.isSaved("a")).toBe(false);
    calls[0].resolve();
    await flush();
    // The PUT landed, so the latest intent (not saved) is sent next.
    expect(calls.map((c) => c.method)).toEqual(["put", "del"]);
    calls[1].resolve();
    await flush();
    expect(store.isSaved("a")).toBe(false);
    expect(settled).toEqual([{ kind: "removed", event: ev("a") }]);
  });

  it("drops a change of mind that matches what's already confirmed", async () => {
    const { store, calls } = await readyStore();
    store.request(ev("a"), true);
    store.request(ev("a"), false);
    calls[0].reject(new Error("network"));
    await flush();
    // The person no longer wants it saved, and it isn't: no error, no retry.
    expect(calls).toHaveLength(1);
    expect(store.isSaved("a")).toBe(false);
  });

  it("doesn't report a failure the person has already undone", async () => {
    const { store, calls, settled } = await readyStore();
    store.request(ev("a"), true);
    store.request(ev("a"), false);
    calls[0].reject(new Error("network"));
    await flush();
    expect(settled).toEqual([]);
  });

  it(`refuses a save at ${MAX_FAVOURITES} without flipping`, async () => {
    const ids = Array.from({ length: MAX_FAVOURITES }, (_, i) => `e${i}`);
    const { store, calls } = await readyStore(ids);
    expect(store.request(ev("new"), true)).toBe("cap");
    expect(store.isSaved("new")).toBe(false);
    expect(calls).toHaveLength(0);
    // Removing is always allowed.
    expect(store.request(ev("e1"), false)).toBe("sent");
  });

  it("keeps the newest save first", async () => {
    const { store, calls } = await readyStore(["old"]);
    store.request(ev("new"), true);
    expect(store.getSnapshot().ids).toEqual(["new", "old"]);
    calls[0].resolve();
    await flush();
    expect(store.getSnapshot().ids).toEqual(["new", "old"]);
  });

  it("stops reporting once inactive (the account changed)", async () => {
    const { store, calls, settled } = await readyStore();
    store.request(ev("a"), true);
    store.setActive(false);
    calls[0].reject(new Error("network"));
    await flush();
    expect(settled).toEqual([]);
  });

  it("notifies subscribers on every change", async () => {
    const { store, calls } = await readyStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.request(ev("a"), true);
    expect(listener).toHaveBeenCalled();
    calls[0].resolve();
    await flush();
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
