"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navLinkClass } from "@/components/AuthNavLinks";

interface SubNavLink {
  href: string;
  label: string;
}

/**
 * The organiser area's sections, in a fixed order, with short labels so the
 * row fits at 320px (the pages' own h1s say "Your events" and "Public
 * profile"). New event isn't one: it's an action on Your events.
 */
export const ORGANISER_SUB_NAV: SubNavLink[] = [
  { href: "/dashboard", label: "Events" },
  { href: "/dashboard/payouts", label: "Payouts" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/profile", label: "Profile" },
];

/**
 * The main nav's link style, narrower on phones so the four tabs fit on one row at 320px with
 * room to spare (about 17px in the brand face, and still one row in a wider fallback face such as
 * DejaVu Sans before the web font loads; e2e/dashboard.spec.ts). Each stays 44px tall.
 */
const subNavLinkClass = `${navLinkClass.replace(/\bpx-2\b/, "px-1 sm:px-2")} inline-flex min-h-11 items-center`;

/** The door scanner (docs/design/check-in.md): its own full-screen surface with its own way back, so no sub-nav. */
const DOOR_PATH = /^\/dashboard\/[^/]+\/check-in\/?$/;
/** An event's report belongs to Analytics (its back link is "← Analytics"). */
const EVENT_ANALYTICS_PATH = /^\/dashboard\/events\/[^/]+\/analytics\/?$/;

/**
 * The section a dashboard page belongs to: Payouts, Analytics and Public
 * profile for their own pages (an event's report is in Analytics), and Your
 * events for the list and everything about one event (new, edit, seat map).
 */
export function organiserSectionFor(pathname: string): string | null {
  if (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/")) return null;
  if (EVENT_ANALYTICS_PATH.test(pathname)) return "/dashboard/analytics";
  const match = ORGANISER_SUB_NAV.find(
    (link) => link.href !== "/dashboard" && (pathname === link.href || pathname.startsWith(`${link.href}/`)),
  );
  return match?.href ?? "/dashboard";
}

/**
 * The organiser sub-nav, on every organiser page for a signed-in approved
 * organiser (OrganiserShell, app/dashboard/layout.tsx) except the door scanner. Tabs in the main nav's style: the current
 * section has aria-current (the umlaut and an underline), "page" on the
 * section's own page and "true" on a page inside it (an event's editor is in
 * Your events). Wraps on phones: no sideways scrolling, every link 44px tall.
 */
export default function OrganiserSubNav() {
  const pathname = usePathname();
  if (DOOR_PATH.test(pathname)) return null;
  const section = organiserSectionFor(pathname);

  return (
    <nav aria-label="Organiser" className="border-b border-foreground">
      <ul className="mx-auto flex max-w-6xl flex-wrap items-center px-2 py-1 sm:gap-x-2 sm:px-6 sm:py-2">
        {ORGANISER_SUB_NAV.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={section === link.href ? (pathname === link.href ? "page" : "true") : undefined}
              className={subNavLinkClass}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
