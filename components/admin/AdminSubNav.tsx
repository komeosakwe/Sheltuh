"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navLinkClass } from "@/components/AuthNavLinks";
import { buttonClass } from "@/components/ui/Button";
import CountBadge from "@/components/ui/CountBadge";
import { AREA_COUNT_WORD, areaCount, type AdminArea } from "@/lib/admin-summary";
import { useAdminSummary } from "./AdminSummaryProvider";

interface SubNavLink {
  href: string;
  label: string;
  /** Whose count the link carries ("Reports, 3 open"). */
  area?: AdminArea;
}

/** In the order of the hub's "Needs you" (most urgent first), then the tools. Fixed: never re-sorted by count. */
export const ADMIN_SUB_NAV: SubNavLink[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/reports", label: "Reports", area: "reports" },
  { href: "/admin/events", label: "Events", area: "events" },
  { href: "/admin/organisers", label: "Organisers", area: "organisers" },
  { href: "/admin/emails", label: "Emails", area: "emails" },
  { href: "/admin/trending", label: "Trending" },
];

const NEW_EVENT_HREF = "/admin/events/new";

/** The link for this page: the hub only on /admin itself; a section for its own pages too (an event's edit page is Events). */
export function adminSectionFor(pathname: string): string | null {
  if (pathname === "/admin") return "/admin";
  if (pathname === NEW_EVENT_HREF) return NEW_EVENT_HREF;
  const match = ADMIN_SUB_NAV.find((link) => link.href !== "/admin" && (pathname === link.href || pathname.startsWith(`${link.href}/`)));
  return match?.href ?? null;
}

/**
 * The admin sub-nav, on every admin page (app/admin/layout.tsx): each area
 * with what's waiting there as a badge, and New event as a button at the
 * end. The badge number is decorative; the link's name carries the count
 * ("Events, 3 waiting"). The current area has aria-current (the umlaut and
 * an underline, as in the main nav). Wraps on phones: no sideways scrolling,
 * and every link is 44px tall.
 */
export default function AdminSubNav() {
  const pathname = usePathname();
  const summary = useAdminSummary()?.summary ?? null;
  const section = adminSectionFor(pathname);

  return (
    <nav aria-label="Admin" className="border-b border-foreground">
      <ul className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 sm:px-6">
        {ADMIN_SUB_NAV.map((link) => {
          const count = summary && link.area ? areaCount(summary, link.area) : 0;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={section === link.href ? "page" : undefined}
                className={`${navLinkClass} inline-flex min-h-11 items-center`}
              >
                {link.label}
                {link.area && (
                  <CountBadge
                    count={count}
                    srText={`, ${count} ${AREA_COUNT_WORD[link.area]}`}
                    dataAttribute="data-admin-count"
                  />
                )}
              </Link>
            </li>
          );
        })}
        <li className="sm:ml-auto">
          <Link
            href={NEW_EVENT_HREF}
            aria-current={section === NEW_EVENT_HREF ? "page" : undefined}
            className={buttonClass("outline", "sm", "min-h-11")}
          >
            New event
          </Link>
        </li>
      </ul>
    </nav>
  );
}
