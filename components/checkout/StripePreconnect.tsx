"use client";

import { preconnect } from "react-dom";
import { isApiConfigured } from "@/lib/api/client";
import { isStripeConfigured } from "@/lib/stripe/config";

/** Where Stripe.js comes from (@stripe/stripe-js injects https://js.stripe.com/…/stripe.js). */
export const STRIPE_JS_ORIGIN = "https://js.stripe.com";

/**
 * The payment page's `<link rel="preconnect">` to Stripe.js, rendered into the
 * document's head (ReactDOM resource hints work in Client Components, which
 * are still rendered on the server). Only where the page will load Stripe.js:
 * live mode with a publishable key. The demo and a deploy without a key never
 * connect to Stripe. No crossOrigin: stripe-js adds its script without one,
 * so the connection it uses isn't a CORS one.
 */
export default function StripePreconnect() {
  if (isApiConfigured && isStripeConfigured) preconnect(STRIPE_JS_ORIGIN);
  return null;
}
