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
    <html lang="en" className={`${anton.variable} ${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-background text-foreground antialiased">
        <AuthProvider>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
