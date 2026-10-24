import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PINNED_CHROMIUM = "/opt/pw-browsers/chromium";

const PORT = 3177;
/** The demo build (no Supabase env, sample data only), for e2e/demo.spec.ts. */
const DEMO_PORT = 3178;

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
      // The demo spec runs against the demo build (the "demo" project below).
      testIgnore: /demo\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        // Claude Code's cloud environment pins a pre-installed Chromium
        // that doesn't always match the revision @playwright/test expects,
        // so launch it directly when it's there. Elsewhere (CI, laptops),
        // use the browser `npx playwright install chromium` fetched.
        launchOptions: existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {},
      },
    },
    {
      // A 375px touch phone in Chromium, for the specs written for it. It is
      // not Safari or a real device: see docs/pwa.md.
      name: "phone-375",
      testMatch: /pwa\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        launchOptions: existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {},
      },
    },
    {
      // The site as the Vercel preview runs it: a production build with no
      // Supabase env (demo mode), so every page uses the sample data and
      // nothing may call the API.
      name: "demo",
      testMatch: /demo\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${DEMO_PORT}`,
        launchOptions: existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {},
      },
    },
  ],
  webServer: [
    {
      // Placeholder Supabase settings switch the app into live mode; every
      // request to the app's own /api/* routes is then intercepted by each
      // test's page.route(), so nothing here ever reaches a real Supabase
      // project or database.
      command:
        `NEXT_PUBLIC_MAPBOX_TOKEN= NEXT_PUBLIC_MAPBOX_STYLE= ` +
        `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${PORT}/supabase-mock ` +
        `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=e2e-placeholder npx next dev -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Empty values win over any .env.local, so this is always the demo.
      // A build of its own (next build writes .next, next dev .next/dev, so
      // it can run beside the dev server above), served by next start.
      // A placeholder public Mapbox token, as a Vercel preview with the map
      // style preview on (docs/mapbox-preview.md): e2e/mapbox-preview.demo.spec.ts
      // answers every tile request itself. The live server above has none,
      // so the rest of the suite sees /map exactly as production does.
      command: `npx next build && npx next start -p ${DEMO_PORT}`,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        NEXT_PUBLIC_MAPBOX_TOKEN: "pk.e2e-placeholder",
        NEXT_PUBLIC_MAPBOX_STYLE: "",
      },
      url: `http://127.0.0.1:${DEMO_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 600_000,
    },
  ],
});
