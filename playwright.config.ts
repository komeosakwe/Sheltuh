import { defineConfig, devices } from "@playwright/test";

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
        // This environment pins a pre-installed Chromium under
        // PLAYWRIGHT_BROWSERS_PATH that doesn't always match the exact
        // revision @playwright/test expects — launch it directly rather
        // than the version-matched binary `npx playwright install` would
        // otherwise try (and fail) to fetch.
        launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
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
