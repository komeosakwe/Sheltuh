"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAdminSummary } from "@/components/admin/AdminSummaryProvider";
import { useUnread } from "@/components/messages/UnreadProvider";
import CountBadge from "@/components/ui/CountBadge";
import { needsYouTotal } from "@/lib/admin-summary";
import { useAuth } from "@/lib/auth/AuthContext";

/**
 * Desktop nav link. `umlaut` (app/globals.css) draws the brand's two dots
 * over the label: orange on the current page (aria-current), black on hover.
 */
export const navLinkClass =
  "umlaut relative px-2 py-2 text-[0.8125rem] leading-4 font-semibold uppercase tracking-[0.01em] text-foreground";

/**
 * The account links in the header. `className` styles every link; it
 * defaults to the desktop nav style (the phone menu passes its own).
 *
 * `compact` (the desktop row): Messages and Account (and Admin for admins),
 * leaving out My events so the search field stays usable at 1024px (it
 * gets a shorter placeholder there). My events and Sign out are on
 * /account; the phone menu has room and also lists My events.
 */
export default function AuthNavLinks({
  className: linkClass = navLinkClass,
  compact = false,
}: { className?: string; compact?: boolean } = {}) {
  const auth = useAuth();
  const pathname = usePathname();
  const unread = useUnread();
  const adminSummary = useAdminSummary()?.summary;
  const adminWaiting = adminSummary ? needsYouTotal(adminSummary) : 0;

  function accountLink(href: string, label: string, extra?: ReactNode) {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={linkClass}
      >
        {label}
        {extra}
      </Link>
    );
  }

  if (!auth.configured) {
    return (
      <Link href="/login" className={linkClass} title="Accounts aren't configured in this environment yet">
        Sign in
      </Link>
    );
  }

  if (auth.status === "loading") {
    return <span className="px-2 py-2 text-sm text-muted">…</span>;
  }

  if (auth.status === "signed-out") {
    return (
      <Link href="/login" className={linkClass}>
        Sign in
      </Link>
    );
  }

  return (
    <>
      {auth.isAdmin &&
        accountLink(
          "/admin",
          "Admin",
          <CountBadge count={adminWaiting} srText={`, ${adminWaiting} waiting`} dataAttribute="data-admin-badge" />,
        )}
      {accountLink("/messages", "Messages", <UnreadBadge count={unread?.count ?? null} />)}
      {!compact && accountLink("/dashboard", "My events")}
      {accountLink("/account", "Account")}
    </>
  );
}

/**
 * The unread count beside "Messages". Not a live region: it changes in the
 * background every minute, and announcing that would be noise. The count is
 * part of the link's name instead ("Messages, 2 unread"), read when the link is.
 */
function UnreadBadge({ count }: { count: number | null }) {
  return <CountBadge count={count} srText={`, ${count} unread`} dataAttribute="data-unread-badge" />;
}
