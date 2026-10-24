/**
 * The platform's Stripe publishable key, for Stripe.js on the payment page
 * (/checkout/pay). Public by design. It must be the same Stripe account and
 * mode (pk_test with sk_test, pk_live with sk_live) as STRIPE_SECRET_KEY; the
 * server refuses paid checkouts when it isn't (lib/server/stripe-keys.ts).
 *
 * A literal `process.env.NEXT_PUBLIC_…` reference so Next inlines it at build
 * time: setting it on a deploy needs a rebuild. Unset in demo mode and on any
 * deploy that hasn't configured card payments.
 */
export const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || undefined;

export const isStripeConfigured = Boolean(STRIPE_PUBLISHABLE_KEY);
