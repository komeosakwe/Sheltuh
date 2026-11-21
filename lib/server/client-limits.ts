import { clientIp, clientKey } from "./client-key";
import type { Db } from "./db";
import type { Deps } from "./deps";
import type { RateWindow } from "./http";

/**
 * Fixed-window limits on private.take_client_rate_limit, keyed on a client
 * (its keyed IP address, ./client-key.ts) or on an order (orderKey): the
 * checkout's (CHECKOUT_RATE_LIMITS, ./handlers/orders.ts), the wallet
 * passes' (./handlers/wallet.ts), the email change's
 * (./handlers/order-email.ts) and the buyer email checks' DNS lookups
 * (./email-domain.ts).
 */
export type KeyedLimit = { readonly bucket: string; readonly hits: number; readonly window: RateWindow };

/** One hit on a keyed fixed-window counter: whether it's within the limit. */
export async function takeKeyedLimit(db: Db, key: string, limit: KeyedLimit): Promise<boolean> {
  const [row] = await db.query<{ allowed: boolean }>(
    `select private.take_client_rate_limit($1, $2, $3, $4::interval) as allowed`,
    [key, limit.bucket, limit.hits, limit.window],
  );
  return row.allowed;
}

/**
 * The secret rate-limit keys are salted with, or undefined when it isn't
 * configured (logged, naming only the limits skipped): the caller fails open.
 */
export function rateLimitSecret(deps: Deps, skipped: string): string | undefined {
  try {
    return deps.stripeWebhookSecret();
  } catch {
    console.error(`STRIPE_WEBHOOK_SECRET isn't set: ${skipped}.`);
    return undefined;
  }
}

/**
 * One hit on the request's client's counter for `limit`: false when it's
 * over. True (fails open) without `secret`, or without a usable client IP,
 * logged without any request detail as `what` (unless `what` is null:
 * silent, for a limit whose caller already says so).
 */
export async function takeClientLimit(
  req: Request,
  deps: Deps,
  secret: string | undefined,
  limit: KeyedLimit,
  what: string | null,
): Promise<boolean> {
  if (!secret) return true;
  const ip = clientIp(req);
  if (!ip) {
    if (what !== null) console.warn(`${what} without a client IP header: the per-client limit was skipped.`);
    return true;
  }
  return takeKeyedLimit(deps.db, clientKey(ip, secret), limit);
}
