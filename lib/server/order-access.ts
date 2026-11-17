import { timingSafeEqual } from "node:crypto";
import { ORDER_ACCESS_HEADER } from "@/lib/api/types";
import { keyedHash } from "./client-key";
import type { Deps } from "./deps";

/**
 * The order access token (docs/architecture.md, "Buyer email checks"): proof
 * that a request comes from the browser that started a paid checkout, which
 * the order id alone isn't (the ticket email's "View your ticket(s)" link
 * carries the id, so whoever got the email has it too).
 *
 * It's an HMAC of the order id under its own label, salted from
 * STRIPE_WEBHOOK_SECRET as the client and order keys are
 * (./client-key.ts): nothing is stored, and no stored key (an order key, a
 * client key) can be turned into it. It's given out only in a paid
 * checkout's own answer (the 201, and a replay to the same client), kept by
 * that browser, and sent back in the `x-order-access` header: never in a
 * URL, an email or a log. Rotating the secret invalidates every token.
 */

/** The label of the token's salt: never another key's. */
const ORDER_ACCESS_CONTEXT = "sheltuh/order-access/v1";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** The token for `orderId`: 64 hex characters. */
export function orderAccessToken(orderId: string, secret: string): string {
  return keyedHash(ORDER_ACCESS_CONTEXT, orderId, secret);
}

/** Whether `token` is `orderId`'s, compared in constant time. False for anything not shaped like a token. */
export function verifyOrderAccess(orderId: string, token: string | null | undefined, secret: string): boolean {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return false;
  const expected = Buffer.from(orderAccessToken(orderId, secret), "hex");
  const given = Buffer.from(token, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The secret tokens are made with, or undefined when STRIPE_WEBHOOK_SECRET isn't set (no token is issued or accepted then). */
export function orderAccessSecret(deps: Deps): string | undefined {
  try {
    return deps.stripeWebhookSecret();
  } catch {
    return undefined;
  }
}

/** Whether the request carries `orderId`'s token in the `x-order-access` header. */
export function hasOrderAccess(req: Request, deps: Deps, orderId: string): boolean {
  const secret = orderAccessSecret(deps);
  return secret !== undefined && verifyOrderAccess(orderId, req.headers.get(ORDER_ACCESS_HEADER)?.trim().toLowerCase(), secret);
}
