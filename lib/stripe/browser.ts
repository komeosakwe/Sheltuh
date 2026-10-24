/**
 * Loads Stripe.js (https://js.stripe.com) for the payment page only. The
 * `/pure` entry injects the script when getStripe() is first called, never
 * just by being imported, so no other page loads it.
 *
 * Payments are destination charges on the platform account, so Stripe.js is
 * initialised with the platform's key and no `stripeAccount`.
 */
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";
import { STRIPE_PUBLISHABLE_KEY } from "./config";

let stripePromise: Promise<Stripe | null> | null = null;

/**
 * The page's one Stripe instance (memoised). Resolves to null without a
 * publishable key (it never loads the script then) and rejects when the
 * script can't load (offline, a content blocker). A failed load, or one that
 * resolved to null, isn't kept, so "Try again" really tries again.
 */
export function getStripe(): Promise<Stripe | null> {
  if (!STRIPE_PUBLISHABLE_KEY) return Promise.resolve(null);
  if (!stripePromise) {
    const pending = loadStripe(STRIPE_PUBLISHABLE_KEY).then(
      (stripe) => {
        if (!stripe && stripePromise === pending) stripePromise = null;
        return stripe;
      },
      (err: unknown) => {
        if (stripePromise === pending) stripePromise = null;
        throw err;
      },
    );
    stripePromise = pending;
  }
  return stripePromise;
}
