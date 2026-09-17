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
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
