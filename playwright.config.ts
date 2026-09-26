import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PINNED_CHROMIUM = "/opt/pw-browsers/chromium";

const PORT = 3177;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Claude Code's cloud environment pins a pre-installed Chromium
        // that doesn't always match the revision @playwright/test expects,
        // so launch it directly when it's there. Elsewhere (CI, laptops),
        // use the browser `npx playwright install chromium` fetched.
        launchOptions: existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {},
      },
    },
  ],
  webServer: {
    // Placeholder Supabase settings switch the app into live mode; every
    // request to the app's own /api/* routes is then intercepted by each
    // test's page.route(), so nothing here ever reaches a real Supabase
    // project or database.
    command:
      `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${PORT}/supabase-mock ` +
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=e2e-placeholder npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
