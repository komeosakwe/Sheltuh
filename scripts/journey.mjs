// The journey harness's runner (`npm run test:journey`): plain Node, so it
// runs the same on Windows, macOS and Linux. See docs/testing.md.
//
// Skips (exit 0) unless both opt-ins are set:
//   JOURNEY=1
//   TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/postgres  (a local server it can create databases on)
// Extra arguments go to Vitest, e.g. `npm run test:journey -- journey/social-access.journey.ts`.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.JOURNEY !== "1" || !process.env.TEST_DATABASE_URL) {
  console.log(
    "Journey harness skipped: set JOURNEY=1 and TEST_DATABASE_URL (a local Postgres it can create databases on) to run it. See docs/testing.md.",
  );
  process.exit(0);
}

// Owner decision D9: the local fake Stripe API is only ever used with a test-mode key.
const key = process.env.STRIPE_SECRET_KEY;
if (key && !key.startsWith("sk_test_")) {
  console.error("Refusing to run: STRIPE_SECRET_KEY isn't a sk_test_ key. Unset it; the harness never calls Stripe.");
  process.exit(1);
}

const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const child = spawn(process.execPath, [vitest, "run", "--config", "vitest.journey.config.mts", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
