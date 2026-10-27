import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { missingOAuthLogos } from "./lib/auth/oauth-providers";

/**
 * NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is inlined into the browser bundle, so a
 * wrong value (a secret `sk_…` or restricted `rk_…` key pasted into the wrong
 * variable above all) would ship to every visitor. When it's set (after
 * trimming, as lib/stripe/config.ts reads it), it must look like a
 * publishable key, `pk_test_…` or `pk_live_…`, or loading this config throws:
 * `next build` (and `next dev`) fail before anything is bundled. Unset is
 * fine (demo mode, CI, a deploy without card payments). The message names the
 * variable, never its value. Whether its mode matches STRIPE_SECRET_KEY is
 * checked at runtime instead (lib/server/stripe-keys.ts: paid checkout is a
 * 503 until they match), since the secret key may not be present at build.
 */
export function assertStripePublishableKey(value: string | undefined): void {
  const key = value?.trim();
  if (key && !/^pk_(test|live)_/.test(key)) {
    throw new Error(
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a Stripe publishable key (pk_test_… or pk_live_…), or unset. " +
        "It's built into the browser bundle: never put a secret (sk_…) or restricted (rk_…) key in it.",
    );
  }
}

assertStripePublishableKey(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

/**
 * "Continue with Apple / Google" shows the vendors' own logo files from
 * public/auth/ (lib/auth/oauth-providers.ts OAUTH_LOGO_FILES), which the
 * owner downloads (docs/auth-logos.md): none is committed, and no stand-in
 * may ship. So a production build with NEXT_PUBLIC_AUTH_PROVIDERS listing a
 * provider whose files aren't there fails, naming them. It runs in the
 * production-build phase only (see the default export), which is `next
 * build` and also `next typegen` (Next loads the config in that phase for
 * it too, so typegen fails the same way). `next dev` runs without them, as
 * the e2e suite does with the flag on (it serves its own test files).
 */
export function assertOAuthLogos(
  providers: string | undefined,
  publicDir: string = path.join(process.cwd(), "public"),
): void {
  const missing = missingOAuthLogos(providers, (file) => existsSync(path.join(publicDir, "auth", file)));
  if (missing.length > 0) {
    throw new Error(
      `NEXT_PUBLIC_AUTH_PROVIDERS lists a provider whose official logo artwork is missing: ` +
        `${missing.map((file) => `public/auth/${file}`).join(", ")}. ` +
        "Add the files described in docs/auth-logos.md, or take the provider out of NEXT_PUBLIC_AUTH_PROVIDERS.",
    );
  }
}

/** Everything but the build-time checks; exported for tests/next-config.test.ts. */
export const nextConfig: NextConfig = {
  // Lets the dev server's HMR websocket accept connections from 127.0.0.1
  // (not just localhost) — needed for the Playwright e2e suite, which
  // navigates to http://127.0.0.1:<port>. Ignored outside development.
  allowedDevOrigins: ["127.0.0.1"],

  async headers() {
    return [
      // No page may be framed by another site (clickjacking): the legacy
      // header and the CSP directive that replaces it. Only frame-ancestors, so
      // no other content is restricted. And HTTPS only (HSTS). It comes first: when two rules set the
      // same header key, the later one wins, so /sw.js keeps its own CSP below.
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // HTTPS only, for two years, once a browser has seen it over HTTPS (browsers ignore it
          // over plain http, so local dev is unaffected). Not includeSubDomains yet: that's only
          // safe once every subdomain serves HTTPS.
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
        ],
      },
      // The service worker must never be served from a stale cache, or the kill
      // switch (docs/pwa.md) could not reach visitors. Matches Next's PWA guide.
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      // Checkout pages carry a credential in the URL: the order id
      // (/checkout/success?session_id=…) or a confirmation token (in the
      // fragment of /checkout/confirm, which browsers never send, but belt and
      // braces). Never send the URL on as a Referer, and keep the pages out of
      // search indexes.
      {
        source: "/checkout/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      // The pages emailed links open (a waitlist confirm or leave link, a
      // follower email's unsubscribe link) carry their token in the fragment:
      // the same headers as /checkout, so the URL is never a Referer and the
      // pages stay out of search indexes.
      {
        source: "/waitlist/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/following/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      // An account invite's link (/invite#token=…) carries its token in the
      // fragment: the same headers as the other emailed-link pages.
      {
        source: "/invite",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      // An organiser link (/organisers/join#token=…) carries its token in the
      // fragment: the same headers.
      {
        source: "/organisers/join",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      // /auth/callback?code=… carries a one-time sign-in code from Google or
      // Apple (via Supabase Auth): never send it on as a Referer, and keep the
      // page out of search indexes.
      {
        source: "/auth/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      // /search?near=Fitzroy carries the visitor's suburb (lib/location.ts): send
      // only the origin as a Referer, to this site and to any other, so the
      // suburb never leaves in one (docs/architecture.md, "Location"). The API
      // client sets the same policy on its own requests (lib/api/client.ts).
      {
        source: "/search",
        headers: [{ key: "Referrer-Policy", value: "strict-origin" }],
      },
      // The door scanner's self-hosted QR decoder (public/vendor/zxing-wasm/<version>/,
      // lib/check-in/detector.ts). The version is in the path and a new version gets a
      // new folder, so a file never changes at its URL: cache it for a year.
      {
        source: "/vendor/zxing-wasm/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

/**
 * Next calls this with the phase it's loading the config for. The logo check
 * runs in the production-build phase only (`next build`, and `next typegen`,
 * which loads the config in that phase too); the Stripe key check above runs
 * on every load.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) assertOAuthLogos(process.env.NEXT_PUBLIC_AUTH_PROVIDERS);
  return nextConfig;
}
