import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import Footer from "@/components/Footer";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import { UnreadProvider } from "@/components/messages/UnreadProvider";
import Nav from "@/components/Nav";
import ServiceWorkerRegistration from "@/components/pwa/ServiceWorkerRegistration";
import RouteProgress from "@/components/RouteProgress";
import { isApiConfigured } from "@/lib/api/client";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { APP_THEME_COLOR } from "@/lib/pwa/theme";
import { instrument, plexMono } from "./fonts";
import "./globals.css";

/**
 * The production origin, so the OG image (app/opengraph-image.tsx) and other
 * URL-based metadata resolve to absolute URLs. NEXT_PUBLIC_SITE_URL is the
 * same variable checkout uses for its return URLs; without it (or if it isn't
 * a valid URL) Next falls back to its own default.
 */
function siteOrigin(): URL | undefined {
  const value = process.env.NEXT_PUBLIC_SITE_URL;
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  title: "Sheltüh — Melbourne creative events",
  description: isApiConfigured
    ? "Sheltüh is a curated guide to Melbourne's live music, art, workshops and pop-ups — find what's on and get tickets."
    : "Sheltüh is a curated guide to Melbourne's live music, art, workshops and pop-ups. Local prototype with sample data — no real tickets are sold yet.",
  applicationName: "Sheltüh",
  // Home-screen app on iOS (the manifest is app/manifest.ts). "default" keeps
  // dark status-bar text over the cream header; see docs/pwa.md.
  appleWebApp: { title: "Sheltüh", statusBarStyle: "default" },
};

// viewport-fit=cover hands the notch and home-indicator areas to the page, so
// fixed and sticky edges pad with env(safe-area-inset-*) (0 on desktop).
// Child layouts merge field by field (app/messages/layout.tsx adds interactiveWidget).
export const viewport: Viewport = {
  themeColor: APP_THEME_COLOR,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-scroll-behavior: Next 16 turns the CSS smooth scroll off during route
    // changes, so page navigations still jump to the top instantly.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${instrument.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-background"
        >
          Skip to main content
        </a>
        <AuthProvider>
          <UnreadProvider>
            <FavouritesProvider>
              <Nav />
              {/* useSearchParams needs a Suspense boundary to keep pages static. */}
              <Suspense fallback={null}>
                <RouteProgress />
              </Suspense>
              <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
                {children}
              </main>
              <Footer />
            </FavouritesProvider>
          </UnreadProvider>
        </AuthProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
