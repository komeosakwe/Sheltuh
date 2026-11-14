import type { CapacitorConfig } from "@capacitor/cli";
// Relative import, not "@/…": the Capacitor CLI loads this file with its own TypeScript loader.
import { APP_ID, APP_NAME, APP_SERVER_URL_VARIABLE, resolveAppServer } from "./lib/mobile/app-config";

/**
 * The phone app (docs/mobile-app.md): a Capacitor shell that opens the live
 * site. Read by `npx cap sync` / `npx cap copy`, which copy it into the native
 * projects: change it, then sync again. SHELTUH_APP_URL points a build at
 * another deployment (a preview, or `next dev` on this computer); unset, it's
 * production.
 */
const server = resolveAppServer(process.env[APP_SERVER_URL_VARIABLE]);

const config: CapacitorConfig = {
  appId: APP_ID,
  appName: APP_NAME,
  // A one-page fallback (mobile/www/index.html): shown when the site can't be
  // reached. The app itself is the live site at server.url.
  webDir: "mobile/www",
  // What shows behind the page while it loads: the site's light background.
  backgroundColor: "#ffffff",
  server: {
    url: server.url,
    // Plain http only for a local dev server (lib/mobile/app-config.ts).
    ...(server.cleartext ? { cleartext: true } : {}),
    // No allowNavigation: only server.url's own origin opens inside the app.
    // Every other site (Supabase sign-in, Stripe Connect onboarding, maps,
    // ticket links, Instagram…) opens in the system browser. See
    // docs/mobile-app.md, "What opens where".
    errorPath: "index.html",
  },
  plugins: {
    // Capacitor 8's built-in system bars plugin: light status-bar icons over
    // the site's black header (both themes). "native" insets: the WebView
    // honours the site's viewport-fit=cover, so the page's
    // env(safe-area-inset-*) padding applies (docs/pwa.md, "Safe areas").
    SystemBars: {
      style: "DARK",
      insetsHandling: "native",
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
