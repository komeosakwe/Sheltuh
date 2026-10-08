import Link from "next/link";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import { isApiConfigured } from "@/lib/api/client";

const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Our company",
    links: [
      { href: "/about", label: "About Sheltüh" },
      { href: "/partners", label: "Become a partner" },
    ],
  },
  {
    heading: "Fan support",
    links: [
      { href: "/help", label: "Help & FAQs" },
      { href: "/refunds", label: "Request a refund" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { href: "/events", label: "All events" },
      { href: "/map", label: "Map" },
      { href: "/search", label: "Search" },
      { href: "/organisers/apply", label: "For organisers" },
    ],
  },
];

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Use" },
  { href: "/purchase-terms", label: "Purchase Terms" },
];

export default function Footer() {
  return (
    <footer className="bg-foreground text-background">
      {/* The bottom padding clears the home indicator in an installed iPhone app; it's 0 elsewhere. */}
      <div className="mx-auto max-w-6xl px-5 pt-12 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-8 sm:pt-24">
        <InstallPrompt />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="flex flex-col justify-between gap-4 sm:gap-8">
            {/* 40px on phones; the display-xl scale from sm up. */}
            <p className="display-xl leading-[0.85] max-sm:text-[2.5rem]">Sheltüh</p>
            <div className="max-w-xs text-sm text-background/70">
              {isApiConfigured ? (
                <p>
                  Curated creative events in Melbourne. Questions?{" "}
                  <a
                    href="mailto:support@sheltuh.com.au"
                    className="text-background underline underline-offset-4"
                  >
                    support@sheltuh.com.au
                  </a>
                </p>
              ) : (
                <p>A local prototype. Sample events only — nothing here is a real booking.</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 text-sm sm:grid-cols-3 sm:gap-x-8">
            {COLUMNS.map((column) => (
              // 28px link targets (py-1). From sm, the heading's pb-1 restores the original 12px rhythm.
              <nav key={column.heading} aria-label={column.heading} className="flex flex-col gap-1">
                <p className="font-semibold sm:pb-1">{column.heading}</p>
                {column.links.map((link) => (
                  <Link key={link.href} href={link.href} className="py-1 text-background/70 hover:text-background">
                    {link.label}
                  </Link>
                ))}
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-background/20 pt-6 text-sm text-background/70 sm:mt-16 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p>© {new Date().getFullYear()} Sheltüh</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-background">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
