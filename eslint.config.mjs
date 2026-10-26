import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // node-forge is only for the Apple pass's PKCS #7 signature (docs/architecture.md, "Wallet passes"): an open
  // advisory affects its signature verification, so nothing else may import it, and only these two files may.
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["lib/server/wallet/apple.ts", "tests/server/helpers/wallet.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node-forge",
              message: "node-forge is only for signing Apple passes: use it in lib/server/wallet/apple.ts (tests: tests/server/helpers/wallet.ts).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
