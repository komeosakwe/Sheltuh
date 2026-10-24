import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server's HMR websocket accept connections from 127.0.0.1
  // (not just localhost) — needed for the Playwright e2e suite, which
  // navigates to http://127.0.0.1:<port>. Ignored outside development.
  allowedDevOrigins: ["127.0.0.1"],

  async headers() {
    return [
      // No page may be framed by another site (clickjacking): the legacy
      // header and the CSP directive that replaces it. Only frame-ancestors, so
      // no other content is restricted. It comes first: when two rules set the
      // same header key, the later one wins, so /sw.js keeps its own CSP below.
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
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

export default nextConfig;
