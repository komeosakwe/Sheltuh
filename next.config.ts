import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server's HMR websocket accept connections from 127.0.0.1
  // (not just localhost) — needed for the Playwright e2e suite, which
  // navigates to http://127.0.0.1:<port>. Ignored outside development.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
