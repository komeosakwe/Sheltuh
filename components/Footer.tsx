import Link from "next/link";
import BrandU from "@/components/brand/BrandU";
import Wordmark from "@/components/brand/Wordmark";
import FooterGroup, { type FooterLink } from "@/components/FooterGroup";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import { SUPPORT_EMAIL } from "@/lib/contact";

/** Support first, and always open: help, refunds and a way to reach a person. */
const SUPPORT_LINKS: FooterLink[] = [
  { href: "/help", label: "Help & FAQs" },
  { href: "/refunds", label: "Request a refund" },
  { href: `mailto:${SUPPORT_EMAIL}`, label: "Contact support" },
];

/** Secondary groups: disclosures on phones, columns from 640px. */
const MORE_GROUPS: { heading: string; links: FooterLink[] }[] = [
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

const LEGAL_LINKS: FooterLink[] = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Use" },
  { href: "/purchase-terms", label: "Purchase Terms" },
];

/**
 * Site footer (docs/design/mobile-redesign.md §6.6 and its Refinement, 22
 * Oct 2026): an ink section (data-surface="ink" re-skins everything inside
 * it), kept short. The orange wordmark at a restrained size (decorative: the
 * © line carries the name), the campaign line "Where is ÜR Sheltüh?" as a
 * small brand line under it (heard as "Where is your Sheltüh?"), one note,
 * and the quiet install action. Then the link groups: Fan support always
 * open; Explore and Our company as disclosures on phones, columns from
 * 640px. The © line and the legal links close the page, always visible.
 * In the demo, the page's sample-data disclosure is the banner at the top
 * (DemoBanner), so the note here is the same in both modes.
 * `data-page-end`: the page's last block, which gains bottom room while the
 * map's phone sheet is open (globals.css), so nothing ends up under it.
 */
export default function Footer() {
  return (
    <footer data-surface="ink" data-page-end="">
      {/* The bottom padding clears the home indicator in an installed iPhone app; it's 0 elsewhere. */}
      <div className="mx-auto max-w-6xl px-5 pt-8 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-8 sm:pt-10">
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:gap-x-8">
          <div className="lg:col-span-5">
            <Wordmark className="block h-7 w-auto text-signal sm:h-8" />
            <p data-campaign-line="" className="mt-3 text-base leading-6 font-semibold">
              <BrandU spoken="Where is your Sheltüh?">Where is ÜR Sheltüh?</BrandU>
            </p>
            <p className="mt-1 max-w-sm text-sm leading-5 text-muted">Curated creative events in Melbourne.</p>
            {/* A quiet secondary action under the note, only where the browser can install the app. */}
            <InstallPrompt />
          </div>
          <div className="flex flex-col sm:grid sm:grid-cols-3 sm:gap-x-6 lg:col-span-7">
            <FooterGroup heading="Fan support" links={SUPPORT_LINKS} />
            {MORE_GROUPS.map((group) => (
              <FooterGroup key={group.heading} heading={group.heading} links={group.links} collapsible />
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-1 border-t border-surface-border pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 sm:order-last">
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
          <p className="text-xs leading-4 text-muted">© {new Date().getFullYear()} Sheltüh</p>
        </div>
      </div>
    </footer>
  );
}
