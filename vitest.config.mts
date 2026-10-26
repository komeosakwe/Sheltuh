import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Component-level tests (.test.tsx) opt into a real DOM via a leading
    // `// @vitest-environment jsdom` comment in the file; plain .test.ts
    // files stay on the lighter "node" environment set above.
    setupFiles: ["tests/test-utils/setup.ts"],
    // The API tests' beforeAll boots an in-process Postgres and applies every
    // migration; on a busy machine (parallel workers, CI) that can take more
    // than the default 10s.
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      // Font loaders only work inside Next's compiler (tests/test-utils/next-font-google.ts).
      "next/font/google": path.resolve(import.meta.dirname, "tests/test-utils/next-font-google.ts"),
    },
  },
});
