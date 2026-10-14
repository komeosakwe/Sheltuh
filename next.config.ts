import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server's HMR websocket accept connections from 127.0.0.1
  // (not just localhost) — needed for the Playwright e2e suite, which
  // navigates to http://127.0.0.1:<port>. Ignored outside development.
  allowedDevOrigins: ["127.0.0.1"],

  // The service worker must never be served from a stale cache, or the kill
  // switch (docs/pwa.md) could not reach visitors. Matches Next's PWA guide.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
