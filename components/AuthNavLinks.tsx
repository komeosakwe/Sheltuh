"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";

export const navLinkClass =
  "px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground relative before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:origin-left before:scale-x-0 before:bg-foreground before:content-[''] motion-safe:before:transition-transform motion-safe:before:duration-200 hover:before:scale-x-100";

const activeClass = "before:scale-x-100";

/**
 * The account links in the header. `className` styles every link; it
 * defaults to the desktop nav style (the phone menu passes its own).
 *
 * `compact` (the desktop row): just Account (and Admin for admins), so the
 * search field keeps its full width at 1024px. My events and Sign out are on
 * /account. The phone menu has room and also lists My events.
 */
export default function AuthNavLinks({
  className: linkClass = navLinkClass,
  compact = false,
}: { className?: string; compact?: boolean } = {}) {
  const auth = useAuth();
  const pathname = usePathname();

  function accountLink(href: string, label: string) {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={active && !compact ? `${linkClass} ${activeClass}` : linkClass}
      >
        {label}
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
      {!compact && accountLink("/dashboard", "My events")}
      {accountLink("/account", "Account")}
    </>
  );
}
