import { afterEach, describe, expect, it, vi } from "vitest";

// Live mode: the client only calls the API when Supabase is configured.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));

const { confirmFreeOrder, createCheckoutSession, getOrderBySession } = await import("@/lib/api/orders");

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
