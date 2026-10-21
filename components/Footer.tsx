import Link from "next/link";
import Wordmark from "@/components/brand/Wordmark";
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

/**
 * Site footer: an ink section (data-surface="ink" re-skins everything inside
 * it), closing on the full-width orange wordmark (brand-direction-one.md
 * §6.13). The wordmark is decorative; the © line carries the name.
 */
export default function Footer() {
  return (
    <footer data-surface="ink">
      {/* The bottom padding clears the home indicator in an installed iPhone app; it's 0 elsewhere. */}
      <div className="mx-auto max-w-6xl px-5 pt-12 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-8 sm:pt-24">
        <InstallPrompt />
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 sm:gap-8">
          {COLUMNS.map((column) => (
            // 32px link targets (py-1 on 24px lines).
            <nav key={column.heading} aria-label={column.heading} className="flex flex-col gap-1">
              <p className="eyebrow pb-1 text-muted">{column.heading}</p>
              {column.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="self-start py-1 text-[0.9375rem] leading-6 underline-offset-4 hover:underline"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          ))}
        </div>

        <div className="mt-10 max-w-md text-sm text-muted">
          {isApiConfigured ? (
            <p>
              Curated creative events in Melbourne. Questions?{" "}
              <a href="mailto:support@sheltuh.com.au" className="text-foreground underline underline-offset-4">
                support@sheltuh.com.au
              </a>
            </p>
          ) : (
            <p>A local prototype. Sample events only — nothing here is a real booking.</p>
          )}
        </div>

        <Wordmark className="mt-12 block h-auto w-full text-signal sm:mt-24" />

        <div className="eyebrow mt-6 flex flex-col gap-1 border-t border-foreground/20 pt-4 text-muted sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="py-3 sm:py-0">© {new Date().getFullYear()} Sheltüh</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline sm:min-h-8"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
