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
 * The sub-navs' link style (the dashboard's, the admin's, the seat page's tabs). `umlaut`
 * (app/globals.css) draws the brand's two dots over the label: orange on the current page
 * (aria-current) and under the pointer.
 */
export const navLinkClass =
  "umlaut relative px-2 py-2 text-[0.8125rem] leading-4 font-semibold uppercase tracking-[0.01em] text-foreground";

/**
 * A nav item in the black site header (the rules' Navigation board): Label/Nav 18/24 in
 * sentence case, 40px tall, the orange dots above it on hover and on the current page, which
 * is also underlined.
 */
export const headerNavClass = "umlaut flex min-h-10 items-center py-2 label-nav text-foreground";

/** The header's outlined nav button ("For organisers", "Messages"): globals.css `nav-button`. */
const headerButtonClass = "umlaut nav-button";

/** A row in the phone menu's account list: 48px. */
const menuRowClass = "flex min-h-12 items-center label-nav";

const ORGANISERS_HREF = "/organisers/apply";

function useAccountState() {
  const auth = useAuth();
  const pathname = usePathname();
  const unread = useUnread();
  const adminSummary = useAdminSummary()?.summary;
  const adminWaiting = adminSummary ? needsYouTotal(adminSummary) : 0;
  const current = (href: string) => (pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined);
  return { auth, current, unreadCount: unread?.count ?? null, adminWaiting };
}

/** "S" for sam@…: the avatar's initial, from the account's email (no extra request). */
function initialFor(email: string | undefined): string {
  const first = email?.trim().charAt(0) ?? "";
  return /\p{L}|\p{N}/u.test(first) ? first.toLocaleUpperCase("en-AU") : "";
}

/**
 * The right of the desktop header (the rules' Navigation board). Signed out (and in the demo,
 * where accounts aren't configured): Sign in, then the For organisers nav button. Signed in:
 * For organisers, Admin with what's waiting (admins only), the Messages button with its unread
 * count, and the avatar's initial, a link to /account (the avatar menu is Batch 2). Saved, Your
 * events and Sign out are on /account.
 */
export function HeaderAccount() {
  const { auth, current, unreadCount, adminWaiting } = useAccountState();

  if (!auth.configured || auth.status !== "signed-in") {
    return (
      <>
        {auth.configured && auth.status === "loading" ? (
          <span className="label-nav text-muted">…</span>
        ) : (
          <Link
            href="/login"
            aria-current={current("/login")}
            className={headerNavClass}
            title={auth.configured ? undefined : "Accounts aren't configured in this environment yet"}
          >
            Sign in
          </Link>
        )}
        <Link href={ORGANISERS_HREF} aria-current={current(ORGANISERS_HREF)} className={headerButtonClass}>
          For organisers
        </Link>
      </>
    );
  }

  const initial = initialFor(auth.email);
  return (
    <>
      <Link href={ORGANISERS_HREF} aria-current={current(ORGANISERS_HREF)} className={headerNavClass}>
        For organisers
      </Link>
      {auth.isAdmin && (
        <Link href="/admin" aria-current={current("/admin")} className={headerNavClass}>
          Admin
          <CountBadge count={adminWaiting} srText={`, ${adminWaiting} waiting`} dataAttribute="data-admin-badge" />
        </Link>
      )}
      <Link href="/messages" aria-current={current("/messages")} className={headerButtonClass}>
        Messages
        <UnreadBadge count={unreadCount} tone="signal" />
      </Link>
      <Link
        href="/account"
        aria-label="Account"
        aria-current={current("/account")}
        data-header-avatar=""
        className={`${headerButtonClass} size-10 justify-center px-0 font-semibold`}
      >
        {initial ? (
          <span aria-hidden="true">{initial}</span>
        ) : (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="size-5"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        )}
      </Link>
    </>
  );
}

/**
 * The account part of the phone menu (the rules: "Sign in / For organisers at bottom as
 * buttons"). Signed in: a list of 48px rows, Admin (admins), Messages, Saved, Your events and
 * Account, then the For organisers button. Signed out and in the demo: Sign in and For
 * organisers, as buttons.
 */
export function MenuAccount() {
  const { auth, current, unreadCount, adminWaiting } = useAccountState();

  const organisersButton = (
    <Link href={ORGANISERS_HREF} aria-current={current(ORGANISERS_HREF)} className="btn btn-outline btn-lg w-full">
      For organisers
    </Link>
  );

  if (auth.configured && auth.status === "loading") {
    return (
      <>
        <span className="label-nav text-muted">…</span>
        {organisersButton}
      </>
    );
  }

  if (!auth.configured || auth.status !== "signed-in") {
    return (
      <>
        <Link
          href="/login"
          aria-current={current("/login")}
          className="btn btn-solid btn-lg w-full"
          title={auth.configured ? undefined : "Accounts aren't configured in this environment yet"}
        >
          Sign in
        </Link>
        {organisersButton}
      </>
    );
  }

  function row(href: string, label: string, extra?: ReactNode) {
    return (
      <li>
        <Link href={href} aria-current={current(href)} className={menuRowClass}>
          {label}
          {extra}
        </Link>
      </li>
    );
  }

  return (
    <>
      <ul className="flex flex-col">
        {auth.isAdmin &&
          row(
            "/admin",
            "Admin",
            <CountBadge count={adminWaiting} srText={`, ${adminWaiting} waiting`} dataAttribute="data-admin-badge" />,
          )}
        {row("/messages", "Messages", <UnreadBadge count={unreadCount} />)}
        {row("/saved", "Saved")}
        {row("/dashboard", "Your events")}
        {row("/account", "Account")}
      </ul>
      {organisersButton}
    </>
  );
}

/**
 * The unread count beside "Messages". Not a live region: it changes in the
 * background every minute, and announcing that would be noise. The count is
 * part of the link's name instead ("Messages, 2 unread"), read when the link is.
 */
function UnreadBadge({ count, tone }: { count: number | null; tone?: "plain" | "signal" }) {
  return <CountBadge count={count} srText={`, ${count} unread`} dataAttribute="data-unread-badge" tone={tone} />;
}
