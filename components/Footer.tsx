import Link from "next/link";
import BrandU from "@/components/brand/BrandU";
import Wordmark from "@/components/brand/Wordmark";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import ThemeSwitch from "@/components/theme/ThemeSwitch";
import FooterContactIcon from "@/components/footer/FooterContactIcon";
import { FOOTER_LABEL_CLASS } from "@/components/footer/footer-styles";
import OrganisersLink from "@/components/nav/OrganisersLink";
import { ORGANISERS_HREF } from "@/lib/organiser-nav";
import { SHELTUH_SOCIALS, SUPPORT_EMAIL } from "@/lib/contact";

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
      // An approved organiser's goes to their dashboard, as the header's (OrganisersLink).
      { href: ORGANISERS_HREF, label: "For organisers" },
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

/** Body/S (14/20) on a 20px line, rows 28 apart (8 between); 2px of padding each way, cancelled by the
 * margin, makes each link a 24px-tall target (WCAG 2.5.8) without moving the rows. */
const linkClass = "-my-0.5 block py-0.5 body-s underline-offset-4 hover:underline";

function GroupLink({ link }: { link: FooterLink }) {
  if (link.href === ORGANISERS_HREF) return <OrganisersLink className={linkClass}>{link.label}</OrganisersLink>;
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

/** A 40px tile with a 24px icon, 8 apart (Latte: light grey on black; hover, an orange icon on a dark tile). */
const contactClass =
  "flex size-10 items-center justify-center rounded-control text-footer-icon hover:bg-surface hover:text-signal";

/**
 * The site footer, one component on every page, copied from Latte's 1120 "Dash / Site footer" frames: an
 * ink section (data-surface="ink" re-skins everything inside it), black in both themes. The brand block
 * (gap 8): the orange wordmark, 151 × 34 at every width (decorative: the © line carries the name); the
 * campaign line "Where is ÜR Sheltüh?" (Label/Nav, heard as "Where is your Sheltüh?"); the quiet install
 * action where the browser offers one; and the Light / Dark switch (footer only). Below 1024px (Latte's
 * 390 and 768 frames, 16 each side), 24 below it, Fan support, Explore and Our company side by side,
 * spread across the width (long labels wrap at 320px), then, 24 below, Contact Sheltüh. From 1024px
 * (Latte's 1440 frame, 64 each side from 1280px), one row: the brand block takes the free width and the
 * four columns sit at the right, each as wide as its words, 64 apart. Column labels are Mono/S #999;
 * links Body/S on 28px rows. Contact Sheltüh: LinkedIn, Instagram (lib/contact.ts, opening in a new tab)
 * and email, each an icon named for screen readers. Not in Latte's frames, but always reachable (Privacy
 * Act, ACL): the legal links and the © line, quietly in the same Mono/S grey, 48 below. `data-page-end`:
 * the page's last block, which gains bottom room while the map's phone sheet is open (globals.css), so
 * nothing ends up under it. In Dark the ink footer meets a black page, so it gains a 1px white rule.
 */
export default function Footer() {
  return (
    <footer data-surface="ink" data-page-end="" className="dark:border-t dark:border-foreground">
      {/* Latte's frames: 48 above; 16 each side on phones and tablets, 64 at 1440 (32 between 1024 and
          1280, where 64 would crowd the row). 1440 wide at most, so the content is 1312, as page-container's.
          The bottom padding clears the home indicator in an installed iPhone app; it's 0 elsewhere. */}
      <div className="mx-auto max-w-360 px-4 pt-12 pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:px-8 xl:px-16">
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-16">
          <div className="flex flex-col items-start gap-2 lg:min-w-0 lg:flex-1">
            {/* Latte's 151 × 44 logo box draws the mark 151 × 34, 2 from its top. */}
            <Wordmark className="mt-0.5 mb-2 block h-8.5 w-auto text-signal" />
            <p data-campaign-line="" className="label-nav">
              <BrandU spoken="Where is your Sheltüh?">Where is ÜR Sheltüh?</BrandU>
            </p>
            {/* A quiet secondary action under the campaign line, only where the browser can install the app. */}
            <InstallPrompt />
            <ThemeSwitch />
          </div>
          {/* Below lg: one row, the three groups spread across it (each shrinks and wraps its labels rather
              than overflow). From lg the row dissolves into the footer's row, each group as wide as its words. */}
          <div className="flex justify-between gap-x-3 lg:contents">
            {GROUPS.map((group) => (
              <nav key={group.heading} aria-label={group.heading} className="flex min-w-0 flex-col gap-2 lg:shrink-0 lg:whitespace-nowrap">
                <p className={FOOTER_LABEL_CLASS}>{group.heading}</p>
                <ul className="flex flex-col gap-2">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <GroupLink link={link} />
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
          <nav aria-label="Contact Sheltüh" className="flex flex-col gap-4 lg:shrink-0">
            <p className={`${FOOTER_LABEL_CLASS} whitespace-nowrap`}>Contact Sheltüh</p>
            <ul className="flex gap-2">
              {SHELTUH_SOCIALS.map((social) => (
                <li key={social.network}>
                  <a
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Sheltüh on ${social.name} (opens in a new tab)`}
                    className={contactClass}
                  >
                    <FooterContactIcon kind={social.network} />
                  </a>
                </li>
              ))}
              <li>
                <a href={`mailto:${SUPPORT_EMAIL}`} aria-label={`Email ${SUPPORT_EMAIL}`} className={contactClass}>
                  <FooterContactIcon kind="email" />
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-surface-border pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2 sm:order-last">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`flex min-h-6 items-center ${FOOTER_LABEL_CLASS} underline underline-offset-4 hover:text-foreground`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p className={`flex min-h-6 items-center ${FOOTER_LABEL_CLASS}`}>© {new Date().getFullYear()} Sheltüh</p>
        </div>
      </div>
    </footer>
  );
}
