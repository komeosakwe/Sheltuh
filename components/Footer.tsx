import Link from "next/link";
import BrandU from "@/components/brand/BrandU";
import Wordmark from "@/components/brand/Wordmark";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import ThemeSwitch from "@/components/theme/ThemeSwitch";
import { SUPPORT_EMAIL } from "@/lib/contact";

interface FooterLink {
  href: string;
  label: string;
}

/** The proposal's link columns, in its order and words. Fan support first: help, refunds and a person. */
const GROUPS: { heading: string; links: FooterLink[] }[] = [
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
      { href: "/map", label: "Nearby" },
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

/** Not in the proposal's mock, but always reachable (Privacy Act, ACL). */
const LEGAL_LINKS: FooterLink[] = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Use" },
  { href: "/purchase-terms", label: "Purchase Terms" },
];

const headingClass = "eyebrow pb-2 text-muted";
/** 48px rows on phones and tablets, 32px from `lg`. */
const linkClass = "flex min-h-12 items-center body-s underline-offset-4 hover:underline lg:min-h-8";

function GroupLink({ link }: { link: FooterLink }) {
  return link.href.startsWith("mailto:") ? (
    <a href={link.href} className={linkClass}>
      {link.label}
    </a>
  ) : (
    <Link href={link.href} className={linkClass}>
      {link.label}
    </Link>
  );
}

function MailIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

/**
 * The site footer, one component on every page (the redesign proposal): an ink section
 * (data-surface="ink" re-skins everything inside it). On the left, the orange wordmark
 * (decorative: the © line carries the name), the campaign line "Where is ÜR Sheltüh?" (heard as
 * "Where is your Sheltüh?"), the quiet install action where the browser offers one, and the
 * Light / Dark switch (footer only). Then four columns: Fan support, Explore, Our company and
 * Contact Sheltüh, two to a row below `lg`. Contact Sheltüh has an icon only for a channel that
 * exists: email (LinkedIn and Instagram wait for their addresses). The legal links and the ©
 * line close the page. `data-page-end`: the page's last block, which gains bottom room while the
 * map's phone sheet is open (globals.css), so nothing ends up under it. In Dark the ink footer
 * meets a black page, so it gains a 1px white rule.
 */
export default function Footer() {
  return (
    <footer data-surface="ink" data-page-end="" className="dark:border-t dark:border-foreground">
      {/* The bottom padding clears the home indicator in an installed iPhone app; it's 0 elsewhere. */}
      <div className="page-container pt-12 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between lg:gap-16">
          <div>
            <Wordmark className="block h-7 w-auto text-signal sm:h-8" />
            <p data-campaign-line="" className="mt-3 text-base leading-6 font-semibold">
              <BrandU spoken="Where is your Sheltüh?">Where is ÜR Sheltüh?</BrandU>
            </p>
            {/* A quiet secondary action under the campaign line, only where the browser can install the app. */}
            <InstallPrompt />
            <ThemeSwitch className="mt-6" />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4 lg:gap-x-12">
            {GROUPS.map((group) => (
              <nav key={group.heading} aria-label={group.heading}>
                <p className={headingClass}>{group.heading}</p>
                <ul className="flex flex-col">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <GroupLink link={link} />
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
            <nav aria-label="Contact Sheltüh">
              <p className={headingClass}>Contact Sheltüh</p>
              <ul className="flex gap-2">
                <li>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    aria-label={`Email ${SUPPORT_EMAIL}`}
                    className="-ml-3 flex size-12 items-center justify-center rounded-control text-muted hover:bg-signal hover:text-signal-foreground lg:-ml-2 lg:size-10"
                  >
                    <MailIcon />
                  </a>
                </li>
              </ul>
            </nav>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-surface-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 sm:order-last">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex min-h-12 items-center text-sm leading-5 text-muted underline underline-offset-4 hover:text-foreground lg:min-h-8"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="text-sm leading-5 text-muted">© {new Date().getFullYear()} Sheltüh</p>
        </div>
      </div>
    </footer>
  );
}
