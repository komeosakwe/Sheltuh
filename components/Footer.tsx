import Link from "next/link";
import BrandU from "@/components/brand/BrandU";
import Wordmark from "@/components/brand/Wordmark";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import { isApiConfigured } from "@/lib/api/client";
import { SUPPORT_EMAIL } from "@/lib/contact";

/**
 * The link groups, support first: help, refunds and a way to reach a person
 * are the first links a phone sees. `mailto:` links are plain anchors.
 */
const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Fan support",
    links: [
      { href: "/help", label: "Help & FAQs" },
      { href: "/refunds", label: "Request a refund" },
      { href: `mailto:${SUPPORT_EMAIL}`, label: "Contact support" },
    ],
  },
  {
    heading: "Explore",
    links: [
      { href: "/events", label: "All events" },
      { href: "/map", label: "Map" },
      { href: "/search", label: "Search" },
      { href: "/organisers/apply", label: "For organisers" },
    ],
  },
  {
    heading: "Our company",
    links: [
      { href: "/about", label: "About Sheltüh" },
      { href: "/partners", label: "Become a partner" },
    ],
  },
];

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Use" },
  { href: "/purchase-terms", label: "Purchase Terms" },
];

/** 32px link targets (py-1 on 24px lines). */
const linkClass = "self-start py-1 text-[0.9375rem] leading-6 underline-offset-4 hover:underline";

/**
 * Site footer (docs/design/mobile-redesign.md §6.6): an ink section
 * (data-surface="ink" re-skins everything inside it). The campaign line
 * "WHERE IS ÜR SHELTÜH?" (a brand line, not a heading; heard as "Where is
 * your Sheltüh?") and a one-line note sit beside the link groups from 1024px
 * (5 + 7 columns), above them on phones; then the full-width orange wordmark
 * answers it, and the © line and the legal links close the page.
 * The wordmark is decorative; the © line carries the name.
 * `data-page-end`: the page's last block, which gains bottom room while the
 * map's phone sheet is open (globals.css), so nothing ends up under it.
 *
 * Kept short: tight gaps between the link groups and around the wordmark
 * (the wordmark itself is unchanged, full width), and the "add to home
 * screen" offer is a one-line text action under the note, not a banner.
 */
export default function Footer() {
  return (
    <footer data-surface="ink" data-page-end="">
      {/* The bottom padding clears the home indicator in an installed iPhone app; it's 0 elsewhere. */}
      <div className="mx-auto max-w-6xl px-5 pt-8 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-8 sm:pt-12">
        <div className="lg:grid lg:grid-cols-12 lg:gap-x-8">
          <div className="lg:col-span-5">
            {/* Leading opened up from display-lg's 0.95 so the second line's Ü dots clear the first line. */}
            <p className="display-lg leading-[1.05]">
              <BrandU spoken="Where is your Sheltüh?">
                <span className="block">Where is ÜR</span> <span className="block">Sheltüh?</span>
              </BrandU>
            </p>
            <p className="mt-2 max-w-sm text-sm leading-5 text-muted">
              {isApiConfigured
                ? "Curated creative events in Melbourne."
                : "A local prototype. Sample events only — nothing here is a real booking."}
            </p>
            {/* A quiet secondary action under the note, only where the browser can install the app. */}
            <InstallPrompt />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:col-span-7 lg:mt-0">
            {COLUMNS.map((column) => (
              <nav key={column.heading} aria-label={column.heading} className="flex flex-col">
                <p className="eyebrow pb-1 text-muted">{column.heading}</p>
                {column.links.map((link) =>
                  link.href.startsWith("mailto:") ? (
                    <a key={link.href} href={link.href} className={linkClass}>
                      {link.label}
                    </a>
                  ) : (
                    <Link key={link.href} href={link.href} className={linkClass}>
                      {link.label}
                    </Link>
                  ),
                )}
              </nav>
            ))}
          </div>
        </div>

        <Wordmark className="mt-8 block h-auto w-full text-signal sm:mt-12" />

        <div className="mt-5 flex flex-col gap-2 border-t border-foreground/20 pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="eyebrow text-muted">© {new Date().getFullYear()} Sheltüh</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex min-h-11 items-center text-sm leading-5 text-muted underline underline-offset-4 hover:text-foreground sm:min-h-8"
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
