/**
 * Signs the client secret JWT for Supabase Auth's Apple provider
 * (docs/supabase-setup.md, "Sign in with Google and Apple"). Apple caps it at
 * about 6 months, so this is re-run to rotate it (every ~5 months).
 *
 * Usage (no env needed; keep the .p8 outside the repo):
 *   npm run apple-client-secret -- --key ~/secure/AuthKey_ABCDE12345.p8 \
 *     --team-id ABCDE12345 --key-id ABCDE12345 --services-id au.com.sheltuh.web
 *
 * Prints the JWT on stdout (pipe it to the clipboard, e.g. `| pbcopy`) and
 * its expiry on stderr. The key is never printed. All the logic, and its
 * tests, live in scripts/apple-client-secret.ts and
 * tests/apple-client-secret.test.ts.
 */
import { readFileSync } from "node:fs";
import { main } from "./apple-client-secret";

let code = 1;
try {
  code = main({
    argv: process.argv.slice(2),
    readFile: (path) => readFileSync(path, "utf8"),
    now: () => new Date(),
    print: (line) => console.log(line),
    printError: (line) => console.error(line),
  });
} catch {
  // main() catches its own errors; this is only a last resort, so it prints no details.
  console.error("apple-client-secret failed unexpectedly.");
}
process.exit(code);
