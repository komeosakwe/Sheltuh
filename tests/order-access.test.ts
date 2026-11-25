// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetOrderAccess,
  forgetOrderAccessIfFinal,
  keepCheckoutAccess,
  ORDER_ACCESS_LIMIT,
  ORDER_ACCESS_MAX_AGE_MS,
  orderAccessFor,
  rememberOrderAccess,
} from "@/lib/order-access";
import { orderAccessKey, orderFingerprint, sha256Hex } from "@/lib/order-fingerprint";
import { createHash } from "node:crypto";

// Live mode, for the API wrappers at the end.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const KEY = "sheltuh:order-access:v1";
const ORDER = "ord_0123456789abcdef0123456789abcdef";
const TOKEN = "0f".repeat(32);

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("order access tokens on this device (lib/order-access.ts)", () => {
  it("keeps a token under a full SHA-256 of the order, never the order id itself", () => {
    rememberOrderAccess(ORDER, TOKEN);
    expect(orderAccessFor(ORDER)).toBe(TOKEN);
    const stored = localStorage.getItem(KEY) ?? "";
    expect(stored).not.toContain(ORDER);
    expect(stored).not.toContain(ORDER.slice(4));
    expect(JSON.parse(stored)).toEqual([{ f: orderAccessKey(ORDER), t: TOKEN, at: expect.any(Number) }]);
    expect(orderAccessKey(ORDER)).toMatch(/^[0-9a-f]{64}$/);
    expect(orderAccessFor("ord_ffffffffffffffffffffffffffffffff")).toBeUndefined();
  });

  it("ignores a token that isn't 64 hex characters, and a garbled store", () => {
    rememberOrderAccess(ORDER, "not-a-token");
    rememberOrderAccess(ORDER, "AB".repeat(32));
    expect(localStorage.getItem(KEY)).toBeNull();
    localStorage.setItem(KEY, "{oops");
    expect(orderAccessFor(ORDER)).toBeUndefined();
    localStorage.setItem(KEY, JSON.stringify([{ f: orderAccessKey(ORDER), t: "short", at: Date.now() }, 7, null]));
    expect(orderAccessFor(ORDER)).toBeUndefined();
  });

  it("two orders whose short (analytics) fingerprints collide keep their own tokens", () => {
    // Both 5f82ebd6 under 32-bit FNV-1a (orderFingerprint): one used to replace the other's token.
    const first = "ord_000000000000000000000000000418cc";
    const second = "ord_000000000000000000000000000bec18";
    expect(orderFingerprint(first)).toBe(orderFingerprint(second));
    rememberOrderAccess(first, "1a".repeat(32));
    rememberOrderAccess(second, "2b".repeat(32));
    expect(orderAccessFor(first)).toBe("1a".repeat(32));
    expect(orderAccessFor(second)).toBe("2b".repeat(32));
  });

  it("orderAccessKey's SHA-256 is SHA-256", () => {
    for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(200), "ünï 😀", ORDER]) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    }
    expect(orderAccessKey(ORDER)).toBe(sha256Hex(`sheltuh/order-access-key/v1:${ORDER}`));
  });

  it("a save merges with what another tab saved since this tab last read", () => {
    rememberOrderAccess(ORDER, TOKEN);
    // Another tab's save, straight into storage.
    const other = "ord_ffffffffffffffffffffffffffffffff";
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown[];
    localStorage.setItem(KEY, JSON.stringify([...stored, { f: orderAccessKey(other), t: "2b".repeat(32), at: Date.now() }]));
    rememberOrderAccess("ord_0000000000000000000000000000000a", "3c".repeat(32));
    expect(orderAccessFor(ORDER)).toBe(TOKEN);
    expect(orderAccessFor(other)).toBe("2b".repeat(32));
  });

  it("keeps another tab's entry saved a moment after this tab's clock was read (not dropped as future-dated)", () => {
    const now = Date.parse("2026-11-19T00:00:00Z");
    const other = "ord_ffffffffffffffffffffffffffffffff";
    // Another tab saved 5 ms after this one took `now`, before it read storage.
    localStorage.setItem(KEY, JSON.stringify([{ f: orderAccessKey(other), t: "2b".repeat(32), at: now + 5 }]));
    rememberOrderAccess(ORDER, TOKEN, now);
    expect(orderAccessFor(other, now)).toBe("2b".repeat(32));
    expect(orderAccessFor(ORDER, now)).toBe(TOKEN);
    // Far in the future (a wrong clock when it was saved): dropped.
    localStorage.setItem(KEY, JSON.stringify([{ f: orderAccessKey(other), t: "2b".repeat(32), at: now + 2 * 86_400_000 }]));
    expect(orderAccessFor(other, now)).toBeUndefined();
  });

  it("replaces an order's older token, and keeps only the newest 20", () => {
    const now = Date.parse("2026-11-17T00:00:00Z");
    for (let i = 0; i < ORDER_ACCESS_LIMIT + 5; i++) {
      rememberOrderAccess(`ord_${String(i).padStart(32, "0")}`, TOKEN, now + i);
    }
    rememberOrderAccess(ORDER, "1a".repeat(32), now + 100);
    rememberOrderAccess(ORDER, "2b".repeat(32), now + 101);
    const entries = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown[];
    expect(entries).toHaveLength(ORDER_ACCESS_LIMIT);
    expect(orderAccessFor(ORDER, now + 102)).toBe("2b".repeat(32));
    // The oldest went first.
    expect(orderAccessFor(`ord_${"0".repeat(32)}`, now + 102)).toBeUndefined();
    expect(orderAccessFor(`ord_${String(24).padStart(32, "0")}`, now + 102)).toBe(TOKEN);
  });

  it("forgets a token after 180 days", () => {
    const at = Date.parse("2026-01-01T00:00:00Z");
    rememberOrderAccess(ORDER, TOKEN, at);
    expect(orderAccessFor(ORDER, at + ORDER_ACCESS_MAX_AGE_MS)).toBe(TOKEN);
    expect(orderAccessFor(ORDER, at + ORDER_ACCESS_MAX_AGE_MS + 1)).toBeUndefined();
    // The next write drops it.
    rememberOrderAccess("ord_ffffffffffffffffffffffffffffffff", TOKEN, at + ORDER_ACCESS_MAX_AGE_MS + 1);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toHaveLength(1);
  });

  it("forgets one order's token (and any expired), leaving the others", () => {
    const OTHER = "ord_ffffffffffffffffffffffffffffffff";
    const start = Date.now();
    rememberOrderAccess("ord_old", "1a".repeat(32), start - ORDER_ACCESS_MAX_AGE_MS - 1);
    rememberOrderAccess(ORDER, TOKEN, start);
    rememberOrderAccess(OTHER, "2b".repeat(32), start);
    forgetOrderAccess(ORDER, start);
    expect(orderAccessFor(ORDER, start)).toBeUndefined();
    expect(orderAccessFor(OTHER, start)).toBe("2b".repeat(32));
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toHaveLength(1);
    forgetOrderAccess(OTHER, start);
    expect(localStorage.getItem(KEY)).toBeNull();
    // Nothing to forget: nothing written.
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    forgetOrderAccess(ORDER, start);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("forgetOrderAccessIfFinal: only an ended event, a scanned ticket or support's change are final", () => {
    for (const reason of ["event_ended", "ticket_scanned", "changed_by_support"] as const) {
      rememberOrderAccess(ORDER, TOKEN);
      forgetOrderAccessIfFinal(ORDER, { allowed: false, reason });
      expect(orderAccessFor(ORDER), reason).toBeUndefined();
    }
    rememberOrderAccess(ORDER, TOKEN);
    for (const change of [undefined, { allowed: true } as const, { allowed: false, reason: "email_already_changed" } as const, { allowed: false, reason: "order_not_paid" } as const]) {
      forgetOrderAccessIfFinal(ORDER, change);
      expect(orderAccessFor(ORDER)).toBe(TOKEN);
    }
  });

  it("forgetOrderAccessIfFinal: while the token can still send or take back a ticket, a scan doesn't end it (the rest still do)", () => {
    rememberOrderAccess(ORDER, TOKEN);
    forgetOrderAccessIfFinal(ORDER, { allowed: false, reason: "ticket_scanned" }, true);
    expect(orderAccessFor(ORDER)).toBe(TOKEN);
    for (const reason of ["event_ended", "changed_by_support"] as const) {
      rememberOrderAccess(ORDER, TOKEN);
      forgetOrderAccessIfFinal(ORDER, { allowed: false, reason }, true);
      expect(orderAccessFor(ORDER), reason).toBeUndefined();
    }
  });

  it("storage that throws is ignored: nothing kept, nothing thrown", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => rememberOrderAccess(ORDER, TOKEN)).not.toThrow();
    expect(orderAccessFor(ORDER)).toBeUndefined();
  });

  it("keepCheckoutAccess keeps a paid checkout's token, and leaves free answers alone", () => {
    const paid = { url: `/checkout/pay?order=${ORDER}`, orderId: ORDER, orderAccess: TOKEN };
    expect(keepCheckoutAccess(paid)).toBe(paid);
    expect(orderAccessFor(ORDER)).toBe(TOKEN);
    localStorage.clear();
    keepCheckoutAccess({ status: "confirmation_sent", expiresInHours: 24 });
    keepCheckoutAccess({ url: "/checkout/success?session_id=x" });
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("the checkout wrappers keep the token; the confirmation reads send it", () => {
  function stubFetch(body: unknown, status = 201) {
    const fetch = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("createCheckoutSession and createSeatedCheckout keep the 201's orderAccess", async () => {
    const { createCheckoutSession, getOrderBySession } = await import("@/lib/api/orders");
    const { createSeatedCheckout } = await import("@/lib/api/seating");
    stubFetch({ url: `/checkout/pay?order=${ORDER}`, orderId: ORDER, orderAccess: TOKEN });
    await createCheckoutSession("evt-access", [{ ticketTypeId: "ga", quantity: 1 }], "fan@example.com");
    expect(orderAccessFor(ORDER)).toBe(TOKEN);

    const seatedOrder = "ord_abcdefabcdefabcdefabcdefabcdefab";
    stubFetch({ url: `/checkout/pay?order=${seatedOrder}`, orderId: seatedOrder, orderAccess: "e".repeat(64), holdExpiresAt: "2026-11-17T01:00:00Z" });
    await createSeatedCheckout("evt-access-seated", { seats: { mapVersion: 1, seatIds: ["A1"] }, buyerEmail: "fan@example.com" });
    expect(orderAccessFor(seatedOrder)).toBe("e".repeat(64));

    // And the confirmation page's read sends it back in a header, not the address.
    const fetch = stubFetch({ status: "pending" }, 200);
    await getOrderBySession(ORDER, orderAccessFor(ORDER));
    expect(fetch.mock.calls[0][0]).toBe(`/api/orders/by-session/${ORDER}`);
    expect(String(fetch.mock.calls[0][0])).not.toContain(TOKEN);
    expect(fetch.mock.calls[0][1].headers["x-order-access"]).toBe(TOKEN);
  });
});
