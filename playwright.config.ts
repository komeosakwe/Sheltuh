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
    // A same-origin, made-up API path: every request to it is intercepted by
    // each test's own page.route() — nothing here ever hits a real network,
    // let alone real AWS. Same-origin (rather than a fake cross-origin host)
    // avoids a CORS preflight that page.route()'s plain JSON fulfil()
    // wouldn't satisfy.
    command: `NEXT_PUBLIC_API_URL=http://127.0.0.1:${PORT}/api-mock npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
