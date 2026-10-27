import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * The journey harness (journey/, docs/testing.md layer b). Run it with
 * `npm run test:journey` (scripts/journey.mjs), which skips unless JOURNEY=1
 * and TEST_DATABASE_URL are set. Not part of `npm test`: the default config
 * only includes tests/**.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["journey/**/*.journey.ts"],
    // One file at a time: each starts its own servers and throwaway database.
    fileParallelism: false,
    testTimeout: 60_000,
    // Creating the database and applying every migration on a real server.
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
