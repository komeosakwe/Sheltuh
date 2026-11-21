import { describe, expect, it } from "vitest";
import { ORDER_ACCESS_HEADER } from "@/lib/api/types";
import { clientKey, orderKey } from "@/lib/server/client-key";
import type { Deps } from "@/lib/server/deps";
import { hasOrderAccess, orderAccessSecret, orderAccessToken, verifyOrderAccess } from "@/lib/server/order-access";

const SECRET = "whsec_test_secret";
const ORDER = "ord_0123456789abcdef0123456789abcdef";
const OTHER = "ord_fedcba9876543210fedcba9876543210";

/** Just what the token needs from Deps. */
const depsWith = (secret: string | undefined) =>
  ({
    stripeWebhookSecret: () => {
      if (!secret) throw new Error("Missing required environment variable: STRIPE_WEBHOOK_SECRET");
      return secret;
    },
  }) as unknown as Deps;

const request = (token?: string) =>
  new Request("https://sheltuh.test/api/test", { headers: token === undefined ? {} : { [ORDER_ACCESS_HEADER]: token } });

describe("lib/server/order-access", () => {
  it("is 64 hex characters, stable per order and secret, and different for another order or secret", () => {
    const token = orderAccessToken(ORDER, SECRET);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(orderAccessToken(ORDER, SECRET)).toBe(token);
    expect(orderAccessToken(OTHER, SECRET)).not.toBe(token);
    expect(orderAccessToken(ORDER, "whsec_rotated")).not.toBe(token);
  });

  it("is never a stored key: not the order's rate-limit key, nor a client key of the same value", () => {
    const token = orderAccessToken(ORDER, SECRET);
    expect(token).not.toBe(orderKey(ORDER, SECRET));
    expect(token).not.toBe(clientKey(ORDER, SECRET));
    expect(token).not.toContain(ORDER.slice(4));
  });

  it("verifies only the order's own token, refusing anything else shaped otherwise without comparing", () => {
    const token = orderAccessToken(ORDER, SECRET);
    expect(verifyOrderAccess(ORDER, token, SECRET)).toBe(true);
    expect(verifyOrderAccess(OTHER, token, SECRET)).toBe(false);
    expect(verifyOrderAccess(ORDER, orderAccessToken(OTHER, SECRET), SECRET)).toBe(false);
    for (const bad of [undefined, null, "", token.slice(0, 63), `${token}0`, token.toUpperCase(), `${token.slice(0, 63)}g`, ` ${token}`]) {
      expect(verifyOrderAccess(ORDER, bad, SECRET), String(bad)).toBe(false);
    }
  });

  it("hasOrderAccess reads the x-order-access header (any case, trimmed) and refuses everything without the secret", () => {
    const token = orderAccessToken(ORDER, SECRET);
    expect(hasOrderAccess(request(token), depsWith(SECRET), ORDER)).toBe(true);
    expect(hasOrderAccess(request(` ${token.toUpperCase()} `), depsWith(SECRET), ORDER)).toBe(true);
    expect(hasOrderAccess(request(), depsWith(SECRET), ORDER)).toBe(false);
    expect(hasOrderAccess(request(token), depsWith(SECRET), OTHER)).toBe(false);
    expect(hasOrderAccess(request(token), depsWith(undefined), ORDER)).toBe(false);
    expect(orderAccessSecret(depsWith(undefined))).toBeUndefined();
  });
});
