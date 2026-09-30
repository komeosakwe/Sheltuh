"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useUnread } from "@/components/messages/UnreadProvider";
import { useAuth } from "@/lib/auth/AuthContext";

export const navLinkClass =
  "px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground relative before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:origin-left before:scale-x-0 before:bg-foreground before:content-[''] motion-safe:before:transition-transform motion-safe:before:duration-200 hover:before:scale-x-100";

const activeClass = "before:scale-x-100";

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

  function accountLink(href: string, label: string, extra?: ReactNode) {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={active && !compact ? `${linkClass} ${activeClass}` : linkClass}
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
      {auth.isAdmin && accountLink("/admin", "Admin")}
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
  if (!count) return null;
  const shown = count > 99 ? "99+" : String(count);
  return (
    <>
      <span
        aria-hidden="true"
        data-unread-badge=""
        className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center bg-foreground px-1 align-middle text-xs leading-none font-semibold tracking-normal text-background tabular-nums normal-case"
      >
        {shown}
      </span>
      <span className="sr-only">, {count} unread</span>
    </>
  );
}
