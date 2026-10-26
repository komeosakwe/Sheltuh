/**
 * Checks, or with --register sets up, the Stripe payment method domains that
 * Apple Pay, Google Pay and Link need on the payment page (/checkout/pay).
 * The same can be done by hand in Stripe → Settings → Payment method domains.
 *
 * Usage (the key from STRIPE_DOMAINS_KEY, else STRIPE_SECRET_KEY, e.g. in
 * .env.local; a restricted key allowed only payment method domains is best):
 *   npm run payment-domains -- app.sheltuh.com.au
 *   npm run payment-domains -- --register app.sheltuh.com.au preview.sheltuh.com.au
 *
 * Hostnames only (no https://, path or port). The key's mode decides which
 * mode is checked: run it once with a test key and once with a live key.
 * Exits non-zero unless every domain is enabled with Apple Pay, Google Pay
 * and Link active. The key itself is never printed. All the logic, and its
 * tests, live in scripts/payment-domains.ts and tests/payment-domains.test.ts.
 */
import Stripe from "stripe";
import { main } from "./payment-domains";

main({
  argv: process.argv.slice(2),
  env: process.env,
  makeClient: (key) => new Stripe(key).paymentMethodDomains,
  print: (line) => console.log(line),
  printError: (line) => console.error(line),
})
  .then((code) => process.exit(code))
  .catch(() => {
    // main() catches and redacts every error itself; this is only a last resort, so it prints no details.
    console.error("payment-domains failed unexpectedly.");
    process.exit(1);
  });
