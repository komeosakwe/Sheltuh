// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";

const { cancelPendingOrder } = vi.hoisted(() => ({ cancelPendingOrder: vi.fn() }));
vi.mock("@/lib/api/seating", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/seating")>()),
  cancelPendingOrder,
}));

const { forgetPendingCheckout, peekPendingCheckout, releasePendingCheckout, rememberPendingCheckout } = await import(
  "@/lib/seating/pending-checkout"
);

const ORDER = `ord_${"b".repeat(32)}`;
const KEY = "sheltuh:pending-checkout";
const stored = () => JSON.parse(window.sessionStorage.getItem(KEY) ?? "null") as unknown;

beforeEach(() => {
  window.sessionStorage.clear();
  cancelPendingOrder.mockReset();
});

describe("the checkout this tab sent to Stripe (lib/seating/pending-checkout.ts)", () => {
  it("is read without being removed (it's only forgotten once its release has an answer)", () => {
    rememberPendingCheckout(ORDER, "off-kilter", 1_000);
    expect(peekPendingCheckout(2_000)).toEqual({ orderId: ORDER, slug: "off-kilter", at: 1_000 });
    expect(peekPendingCheckout(2_000)).toEqual({ orderId: ORDER, slug: "off-kilter", at: 1_000 });
  });

  it("is dropped once the hold would have lapsed by itself (35 minutes)", async () => {
    rememberPendingCheckout(ORDER, "off-kilter", 0);
    expect(peekPendingCheckout(35 * 60_000 + 1)).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    rememberPendingCheckout(ORDER, "off-kilter", 0);
    await expect(releasePendingCheckout(35 * 60_000 + 1)).resolves.toEqual({ kind: "none" });
    expect(cancelPendingOrder).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("ignores (and drops) anything that isn't an order id, or isn't readable", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ orderId: "../admin", slug: "x", at: 0 }));
    expect(peekPendingCheckout(1)).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    window.sessionStorage.setItem(KEY, "{not json");
    expect(peekPendingCheckout(1)).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("is forgotten for that order only (paid, or released on the cancelled page)", () => {
    rememberPendingCheckout(ORDER, "off-kilter", 0);
    forgetPendingCheckout(`ord_${"c".repeat(32)}`);
    expect(window.sessionStorage.getItem(KEY)).not.toBeNull();
    forgetPendingCheckout(ORDER);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe("releasePendingCheckout", () => {
  it("nothing stored: no request", async () => {
    await expect(releasePendingCheckout(1)).resolves.toEqual({ kind: "none" });
    expect(cancelPendingOrder).not.toHaveBeenCalled();
  });

  it("released: cancels the stored order and forgets it", async () => {
    rememberPendingCheckout(ORDER, "off-kilter", 1_000);
    cancelPendingOrder.mockResolvedValue({ status: "released", eventTitle: "t" });
    await expect(releasePendingCheckout(2_000)).resolves.toEqual({ kind: "done", status: "released" });
    expect(cancelPendingOrder).toHaveBeenCalledWith(ORDER);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it.each(["paid", "processing"] as const)("%s: nothing to release, and it's forgotten", async (status) => {
    rememberPendingCheckout(ORDER, "off-kilter", 1_000);
    cancelPendingOrder.mockResolvedValue({ status, eventTitle: "t" });
    await expect(releasePendingCheckout(2_000)).resolves.toEqual({ kind: "done", status });
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it.each([
    ["a network failure", new ApiError(0, "Couldn't reach the server.")],
    ["a server error", new ApiError(503, "Unavailable.")],
    ["still being set up", new ApiError(409, "Still being set up.")],
    ["rate limited", new ApiError(429, "Slow down.")],
    ["an unexpected error", new TypeError("boom")],
  ])("%s: keeps the entry with its original time, and a later attempt releases it", async (_name, err) => {
    rememberPendingCheckout(ORDER, "off-kilter", 1_000);
    cancelPendingOrder.mockRejectedValueOnce(err).mockResolvedValueOnce({ status: "released", eventTitle: "t" });
    await expect(releasePendingCheckout(2_000)).resolves.toEqual({ kind: "failed" });
    expect(stored()).toEqual({ orderId: ORDER, slug: "off-kilter", at: 1_000 });
    await expect(releasePendingCheckout(3_000)).resolves.toEqual({ kind: "done", status: "released" });
    expect(cancelPendingOrder).toHaveBeenCalledTimes(2);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("a kept entry still lapses: once its hold would have ended, it's dropped rather than retried", async () => {
    rememberPendingCheckout(ORDER, "off-kilter", 0);
    cancelPendingOrder.mockRejectedValueOnce(new ApiError(500, "Server error."));
    await expect(releasePendingCheckout(1_000)).resolves.toEqual({ kind: "failed" });
    await expect(releasePendingCheckout(35 * 60_000 + 1)).resolves.toEqual({ kind: "none" });
    expect(cancelPendingOrder).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("unknown order (404): a final answer, so it's forgotten and nothing is retried", async () => {
    rememberPendingCheckout(ORDER, "off-kilter", 1_000);
    cancelPendingOrder.mockRejectedValue(new ApiError(404, "Not found."));
    await expect(releasePendingCheckout(2_000)).resolves.toEqual({ kind: "none" });
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("calls made while one is in flight share it: one cancel request", async () => {
    rememberPendingCheckout(ORDER, "off-kilter", 1_000);
    let resolve: (value: unknown) => void = () => {};
    cancelPendingOrder.mockReturnValue(new Promise((r) => (resolve = r)));
    const first = releasePendingCheckout(2_000);
    const second = releasePendingCheckout(2_000);
    resolve({ status: "released", eventTitle: "t" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: "done", status: "released" },
      { kind: "done", status: "released" },
    ]);
    expect(cancelPendingOrder).toHaveBeenCalledTimes(1);
    // Once settled, a new call starts afresh (nothing stored now).
    await expect(releasePendingCheckout(3_000)).resolves.toEqual({ kind: "none" });
  });
});
