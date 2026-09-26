import type { Metadata } from "next";
import { Bebas_Neue } from "next/font/google";
import Nav from "@/components/Nav";
import { isApiConfigured } from "@/lib/api/client";
import { AuthProvider } from "@/lib/auth/AuthContext";
import "./globals.css";

const bebasNeue = Bebas_Neue({
  variable: "--font-heading",
  weight: "400",
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
    <html lang="en" className={`${bebasNeue.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-background text-foreground antialiased">
        <AuthProvider>
          <Nav />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-surface-border px-4 py-6 text-center text-sm text-muted sm:px-6">
            {isApiConfigured ? (
              <p>
                Sheltüh — curated creative events in Melbourne. Questions?{" "}
                <a href="mailto:support@sheltuh.com.au" className="underline underline-offset-2">
                  support@sheltuh.com.au
                </a>
              </p>
            ) : (
              <p>
                Sheltüh is a local prototype. Sample events only — nothing here is a real
                booking.
              </p>
            )}
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
