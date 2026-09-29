import Link from "next/link";
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
      <div className="mx-auto max-w-6xl px-5 pb-8 pt-16 sm:px-8 sm:pt-24">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <div className="flex flex-col justify-between gap-8">
            <p className="display-xl leading-[0.85]">Sheltüh</p>
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
          <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <nav key={column.heading} aria-label={column.heading} className="flex flex-col gap-3">
                <p className="font-semibold">{column.heading}</p>
                {column.links.map((link) => (
                  <Link key={link.href} href={link.href} className="text-background/70 hover:text-background">
                    {link.label}
                  </Link>
                ))}
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-background/20 pt-6 text-sm text-background/70 sm:flex-row sm:items-center sm:justify-between">
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
