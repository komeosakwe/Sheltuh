import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import Footer from "@/components/Footer";
import { UnreadProvider } from "@/components/messages/UnreadProvider";
import Nav from "@/components/Nav";
import ServiceWorkerRegistration from "@/components/pwa/ServiceWorkerRegistration";
import { isApiConfigured } from "@/lib/api/client";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { APP_THEME_COLOR } from "@/lib/pwa/theme";
import "./globals.css";

const display = Bricolage_Grotesque({
  variable: "--font-display",
  weight: "800",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sheltüh — Melbourne creative events",
  description: isApiConfigured
    ? "Sheltüh is a curated guide to Melbourne's live music, art, workshops and pop-ups — find what's on and get tickets."
    : "Sheltüh is a curated guide to Melbourne's live music, art, workshops and pop-ups. Local prototype with sample data — no real tickets are sold yet.",
  applicationName: "Sheltüh",
  // Home-screen app on iOS (the manifest is app/manifest.ts). "default" keeps
  // dark status-bar text over the paper header; see docs/pwa.md.
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
      className={`${display.variable} ${inter.variable} h-full`}
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
            <Nav />
            <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
              {children}
            </main>
            <Footer />
          </UnreadProvider>
        </AuthProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
