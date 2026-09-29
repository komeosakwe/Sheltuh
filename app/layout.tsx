import type { Metadata } from "next";
import { Anton, Inter } from "next/font/google";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import { isApiConfigured } from "@/lib/api/client";
import { AuthProvider } from "@/lib/auth/AuthContext";
import "./globals.css";

const anton = Anton({
  variable: "--font-display",
  weight: "400",
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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-scroll-behavior: Next 16 turns the CSS smooth scroll off during route
    // changes, so page navigations still jump to the top instantly.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${anton.variable} ${inter.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-background"
        >
          Skip to main content
        </a>
        <AuthProvider>
          <Nav />
          <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
            {children}
          </main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
