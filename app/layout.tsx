import type { Metadata } from "next";
import { Bebas_Neue } from "next/font/google";
import Nav from "@/components/Nav";
import "./globals.css";

const bebasNeue = Bebas_Neue({
  variable: "--font-heading",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sheltüh — Melbourne creative events",
  description:
    "Sheltüh is a curated guide to Melbourne's live music, art, workshops and pop-ups. Local prototype with sample data — no real tickets are sold yet.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bebasNeue.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-background text-foreground antialiased">
        <Nav />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-surface-border px-4 py-6 text-center text-sm text-muted sm:px-6">
          <p>
            Sheltüh is a local prototype. Sample events only — nothing here is a real
            booking.
          </p>
        </footer>
      </body>
    </html>
  );
}
