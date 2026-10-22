import { afterEach, describe, expect, it, vi } from "vitest";

// Live mode: the client only calls the API when Supabase is configured.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { confirmFreeOrder, createCheckoutSession, getOrderBySession } = await import("@/lib/api/orders");
const { createSeatedCheckout } = await import("@/lib/api/seating");
const { checkoutErrorCode, currentCheckoutKey, resetCheckoutAttempt } = await import("@/lib/api/checkout-attempt");

function stubFetch(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createCheckoutSession", () => {
  it("sends the tracking code only when there is one", async () => {
    const fetch = stubFetch({ url: "https://checkout.example/x" }, 201);
    await createCheckoutSession("evt-1", [{ ticketTypeId: "ga", quantity: 1 }], undefined, "abcd2345");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      lineItems: [{ ticketTypeId: "ga", quantity: 1 }],
      trackingCode: "abcd2345",
    });

    await createCheckoutSession("evt-1", [{ ticketTypeId: "ga", quantity: 1 }], "fan@example.com");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      lineItems: [{ ticketTypeId: "ga", quantity: 1 }],
      buyerEmail: "fan@example.com",
    });
  });
});

describe("createCheckoutSession (free orders)", () => {
  it("sends the account's token when given one, and goes the guest way when there's none to be had", async () => {
    const fetch = stubFetch({ status: "confirmation_sent", expiresInHours: 24 }, 202);
    const result = await createCheckoutSession("evt-1", [{ ticketTypeId: "f", quantity: 1 }], "a@example.com", undefined, async () => "tok");
    expect(result).toEqual({ status: "confirmation_sent", expiresInHours: 24 });
    expect(fetch.mock.calls[0][1].headers.authorization).toBe("Bearer tok");

    await createCheckoutSession("evt-1", [{ ticketTypeId: "f", quantity: 1 }], "a@example.com", undefined, async () => {
      throw new Error("session expired");
    });
    expect(fetch.mock.calls[1][1].headers.authorization).toBeUndefined();
  });
});

describe("confirmFreeOrder", () => {
  it("posts the token", async () => {
    const fetch = stubFetch({ url: "/checkout/success?session_id=x" });
    expect(await confirmFreeOrder("tok")).toEqual({ url: "/checkout/success?session_id=x" });
    expect(fetch.mock.calls[0][0]).toBe("/api/orders/confirm");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ token: "tok" });
  });
});

describe("getOrderBySession", () => {
  it("encodes the id into the path", async () => {
    const fetch = stubFetch({ status: "pending" });
    expect(await getOrderBySession("ord_a/b")).toEqual({ status: "pending" });
    expect(fetch.mock.calls[0][0]).toBe("/api/orders/by-session/ord_a%2Fb");
  });
});

// The Idempotency-Key (lib/api/checkout-attempt.ts; docs/architecture.md, "Checkout idempotency").
describe("checkout attempts", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const GA = [{ ticketTypeId: "ga", quantity: 2 }];

  /** A fetch answering each call in turn (a status and body, or an Error for a network failure). */
  function fetchSequence(...answers: ([number, unknown] | Error)[]) {
    const fetch = vi.fn(async () => {
      const answer = answers.shift() ?? [201, { url: "https://checkout.example/x", orderId: "ord_x" }];
      if (answer instanceof Error) throw answer;
      return new Response(JSON.stringify(answer[1]), { status: answer[0], headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  const keyOf = (fetch: ReturnType<typeof fetchSequence>, call: number) =>
    (fetch.mock.calls[call] as unknown as [string, { headers: Record<string, string> }])[1].headers["idempotency-key"];

  afterEach(() => {
    resetCheckoutAttempt();
    vi.useRealTimers();
  });

  it("sends a UUID key, keeps it after a server error, and starts a new one after success or a changed basket", async () => {
    const fetch = fetchSequence([500, { error: "Something went wrong." }], [201, { url: "u", orderId: "o" }], [201, { url: "u2" }], [201, {}]);
    await expect(createCheckoutSession("evt-1", GA, "fan@example.com")).rejects.toMatchObject({ status: 500 });
    const first = keyOf(fetch, 0);
    expect(first).toMatch(UUID);
    expect(currentCheckoutKey("evt-1")).toBe(first);

    // Pressed again: the same key (the server replays or retries the same attempt).
    expect(await createCheckoutSession("evt-1", GA, "fan@example.com")).toEqual({ url: "u", orderId: "o" });
    expect(keyOf(fetch, 1)).toBe(first);
    // Body as before; the key is only a header.
    expect(JSON.parse((fetch.mock.calls[1] as unknown as [string, { body: string }])[1].body)).toEqual({
      lineItems: GA,
      buyerEmail: "fan@example.com",
    });
    expect(currentCheckoutKey("evt-1")).toBeUndefined();

    // After success, a new attempt.
    await createCheckoutSession("evt-1", GA, "fan@example.com");
    expect(keyOf(fetch, 2)).toMatch(UUID);
    expect(keyOf(fetch, 2)).not.toBe(first);
    // A different basket, a different key.
    await createCheckoutSession("evt-1", [{ ticketTypeId: "ga", quantity: 3 }], "fan@example.com");
    expect(keyOf(fetch, 3)).not.toBe(keyOf(fetch, 2));
  });

  it("a double click shares one request", async () => {
    const fetch = fetchSequence([201, { url: "u", orderId: "o" }]);
    const [a, b] = await Promise.all([createCheckoutSession("evt-1", GA), createCheckoutSession("evt-1", GA)]);
    expect(a).toEqual({ url: "u", orderId: "o" });
    expect(b).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a changed basket while one is in flight is its own attempt", async () => {
    const fetch = fetchSequence([201, { url: "u1" }], [201, { url: "u2" }]);
    const [a, b] = await Promise.all([
      createCheckoutSession("evt-1", GA),
      createCheckoutSession("evt-1", [{ ticketTypeId: "vip", quantity: 1 }]),
    ]);
    expect([a, b]).toEqual([{ url: "u1" }, { url: "u2" }]);
    expect(keyOf(fetch, 0)).not.toBe(keyOf(fetch, 1));
  });

  it("retries a network failure once and an in-progress 409 after its Retry-After, all with the same key", async () => {
    vi.useFakeTimers();
    const fetch = fetchSequence(
      new TypeError("Failed to fetch"),
      [409, { error: "still being set up", code: "checkout_in_progress", retryAfterSeconds: 2 }],
      [200, { url: "u", orderId: "o" }],
    );
    const result = createCheckoutSession("evt-1", GA);
    await vi.advanceTimersByTimeAsync(1000); // the network retry
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(2); // still waiting out Retry-After
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ url: "u", orderId: "o" });
    expect(new Set([0, 1, 2].map((i) => keyOf(fetch, i))).size).toBe(1);
  });

  const busy = (retryAfterSeconds: number): [number, unknown] => [
    409,
    { error: "still being set up", code: "checkout_in_progress", retryAfterSeconds },
  ];

  it("waits out the server's worst case (a slow Stripe call and its retry, about 30 seconds) with the same key", async () => {
    vi.useFakeTimers();
    // 15 answers of "in progress, retry in 2 seconds": 30 seconds of waiting, then the first request's answer.
    const fetch = fetchSequence(...Array.from({ length: 15 }, () => busy(2)), [200, { url: "u", orderId: "o" }]);
    const result = createCheckoutSession("evt-1", GA);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toEqual({ url: "u", orderId: "o" });
    expect(fetch).toHaveBeenCalledTimes(16);
    expect(new Set(Array.from({ length: 16 }, (_, i) => keyOf(fetch, i))).size).toBe(1);
  });

  it("gives up on an in-progress 409 after 35 seconds of waiting, keeping the key for the next press", async () => {
    vi.useFakeTimers();
    const fetch = fetchSequence(...Array.from({ length: 19 }, () => busy(2)), [200, { url: "u" }]);
    const result = createCheckoutSession("evt-1", GA).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(34_999);
    expect(fetch).toHaveBeenCalledTimes(18); // 17 waits of 2 seconds, then a last one cut to the second left
    await vi.advanceTimersByTimeAsync(1);
    const err = await result;
    expect(checkoutErrorCode(err)).toBe("checkout_in_progress");
    expect(fetch).toHaveBeenCalledTimes(19);
    expect(currentCheckoutKey("evt-1")).toBe(keyOf(fetch, 0));
    expect(await createCheckoutSession("evt-1", GA)).toEqual({ url: "u" });
    expect(keyOf(fetch, 19)).toBe(keyOf(fetch, 0));
  });

  it("gives up after 20 in-progress retries even with short waits", async () => {
    vi.useFakeTimers();
    const fetch = fetchSequence(...Array.from({ length: 21 }, () => busy(1)));
    const result = createCheckoutSession("evt-1", GA).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(checkoutErrorCode(await result)).toBe("checkout_in_progress");
    expect(fetch).toHaveBeenCalledTimes(21);
  });

  it("drops the key after a refusal (any other 4xx), so the next press is a new attempt", async () => {
    const fetch = fetchSequence(
      [409, { error: "This checkout has ended. Start a new checkout.", code: "checkout_expired" }],
      [429, { error: "busy", code: "client_rate_limited" }],
      [201, { url: "u" }],
    );
    const expired = await createCheckoutSession("evt-1", GA).catch((err: unknown) => err);
    expect(checkoutErrorCode(expired)).toBe("checkout_expired");
    const limited = await createCheckoutSession("evt-1", GA).catch((err: unknown) => err);
    expect(checkoutErrorCode(limited)).toBe("client_rate_limited");
    await createCheckoutSession("evt-1", GA);
    expect(new Set([0, 1, 2].map((i) => keyOf(fetch, i))).size).toBe(3);
  });

  it("seated checkouts send a key too, with the body unchanged", async () => {
    const fetch = fetchSequence([201, { url: "u", holdExpiresAt: "2026-10-22T10:00:00.000Z", orderId: "o" }]);
    await createSeatedCheckout("evt-2", { seats: { mapVersion: 3, seatIds: ["A1"] }, buyerEmail: "fan@example.com" });
    expect(keyOf(fetch, 0)).toMatch(UUID);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({
      seats: { mapVersion: 3, seatIds: ["A1"] },
      buyerEmail: "fan@example.com",
    });
  });
});
