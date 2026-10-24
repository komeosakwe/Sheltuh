/**
 * Whether the Stripe publishable key the payment page loads Stripe.js with
 * belongs with the secret key the server creates sessions with. A session
 * made with a live secret key can't be mounted with a test publishable key
 * (or the reverse), so a mismatched deploy would create orders, seat holds
 * and Stripe sessions nobody can pay. Neither key's value is ever logged or
 * returned in a reason: only which variable is wrong and the modes.
 */

type StripeMode = "test" | "live";

/** `sk_`/`rk_` (secret or restricted) for the secret key, `pk_` for the publishable one. */
function keyMode(key: string | undefined, prefixes: readonly string[]): StripeMode | undefined {
  if (!key) return undefined;
  for (const prefix of prefixes) {
    if (key.startsWith(`${prefix}_test_`)) return "test";
    if (key.startsWith(`${prefix}_live_`)) return "live";
  }
  return undefined;
}

export type PublishableKeyCheck = { ok: true; key: string } | { ok: false; reason: string };

export function checkPublishableKey(publishableKey: string | undefined, secretKey: string | undefined): PublishableKeyCheck {
  if (!publishableKey) return { ok: false, reason: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY isn't set." };
  const publishableMode = keyMode(publishableKey, ["pk"]);
  if (!publishableMode) {
    return { ok: false, reason: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY isn't a publishable key (pk_test_… or pk_live_…)." };
  }
  const secretMode = keyMode(secretKey, ["sk", "rk"]);
  if (!secretMode) return { ok: false, reason: "STRIPE_SECRET_KEY isn't set, or isn't a secret key." };
  if (publishableMode !== secretMode) {
    return {
      ok: false,
      reason: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is a ${publishableMode} key but STRIPE_SECRET_KEY is a ${secretMode} key: they must be the same account and mode.`,
    };
  }
  return { ok: true, key: publishableKey };
}

/**
 * The publishable key when it matches the secret key, else undefined, with
 * one log line saying why (never a key's value).
 */
export function matchingPublishableKey(publishableKey: string | undefined, secretKey: string | undefined): string | undefined {
  const check = checkPublishableKey(publishableKey, secretKey);
  if (check.ok) return check.key;
  console.error(`Card payments are off: ${check.reason}`);
  return undefined;
}
