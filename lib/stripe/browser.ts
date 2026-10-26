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

/**
 * Starts loading Stripe.js early (the payment page calls it at mount, beside
 * its first GET), so the form doesn't wait for the order's answer first. It's
 * the same memoised load: the form's own getStripe() shares it rather than
 * injecting the script again. A failure isn't reported here: a failed load
 * isn't kept (above), so the form's getStripe() either shares the failing
 * load or, once it has failed, tries again, and shows its own alert (with
 * "Try again") if that fails too.
 */
export function preloadStripe(): void {
  getStripe().catch(() => undefined);
}
