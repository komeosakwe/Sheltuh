"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import AccountAvatar from "@/components/nav/AccountAvatar";
import AccountMenu from "@/components/nav/AccountMenu";
import { MY_TICKETS_HREF, ORGANISERS_HREF, type NavAccount } from "@/components/nav/useNavAccount";
import CountBadge from "@/components/ui/CountBadge";

/**
 * The sub-navs' link style (the dashboard's, the admin's, the seat page's tabs). `umlaut`
 * (app/globals.css) draws the brand's two dots over the label: orange on the current page
 * (aria-current) and under the pointer.
 */
export const navLinkClass =
  "umlaut relative px-2 py-2 text-[0.8125rem] leading-4 font-semibold uppercase tracking-[0.01em] text-foreground";

/**
 * A nav item in the site header (the "Navigation" board): Label/Nav 18/24 in
 * sentence case, 40px tall, the 20×6 orange dots above it on hover and on the current page,
 * which is also underlined 13.5px under the label (globals.css `umlaut-nav`).
 */
export const headerNavClass = "umlaut umlaut-nav flex min-h-10 items-center py-2 label-nav text-foreground";

/** The header's outlined nav button ("For organisers"): globals.css `nav-button`. */
const headerButtonClass = "umlaut nav-button";

/**
 * A row in the phone drawer's account list (navigation-search.md §5.3 and §5.16, the "Menu drawer
 * / Mobile" board): 64px to tap, a hairline above it, the 18px label 12px under the hairline.
 */
const menuRowClass = "block min-h-16 pt-3 label-nav";

/** "S" for sam@…: the avatar's initial, from the account's email (no extra request). */
function initialFor(email: string | undefined): string {
  const first = email?.trim().charAt(0) ?? "";
  return /\p{L}|\p{N}/u.test(first) ? first.toLocaleUpperCase("en-AU") : "";
}

const NOT_CONFIGURED = "Accounts aren't configured in this environment yet";

/**
 * The right of the desktop header (the rules' Navigation board; navigation-search.md §5.1).
 * Signed out (and in the demo, where accounts aren't configured): Sign in, then the For
 * organisers nav button. Signed in: the For organisers nav button, Admin with what's waiting
 * (admins only), the Messages chip with its unread count, and the avatar, which opens the
 * avatar menu (components/nav/AccountMenu.tsx; never in the demo).
 */
export function HeaderAccount({ account }: { account: NavAccount }) {
  const { auth, current, unreadCount, adminWaiting } = account;
  const organisers = (
    <Link href={ORGANISERS_HREF} aria-current={current(ORGANISERS_HREF)} className={headerButtonClass}>
      For organisers
    </Link>
  );

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
            title={auth.configured ? undefined : NOT_CONFIGURED}
          >
            Sign in
          </Link>
        )}
        {organisers}
      </>
    );
  }

  return (
    <>
      {organisers}
      {auth.isAdmin && (
        <Link href="/admin" aria-current={current("/admin")} className={headerNavClass}>
          Admin
          <CountBadge count={adminWaiting} srText={`, ${adminWaiting} waiting`} dataAttribute="data-admin-badge" />
        </Link>
      )}
      {/* The Messages chip: 37px, 14px, filled black like the avatar, the count in an orange pill. */}
      <Link href="/messages" aria-current={current("/messages")} className="umlaut nav-chip">
        Messages
        <UnreadBadge count={unreadCount} tone="signal" shape="pill" />
      </Link>
      <AccountMenu account={account} initial={initialFor(auth.email)} />
    </>
  );
}

/**
 * The account part of the phone drawer (navigation-search.md §5.3 and §5.16, the "Menu drawer /
 * Mobile" board), at its foot. Signed out and in the demo: Sign in (orange) and For organisers
 * (outlined), 56px buttons 16px apart. Signed in: who's signed in (the round avatar, the 20px
 * name and "View profile", a link to the profile), then rows with hairlines: My tickets, Saved,
 * Messages (no counts: the board draws none), Your events (organisers) and Admin (admins, with
 * what's waiting), then For organisers. Settings and signing out are on /account.
 */
export function MenuAccount({ account }: { account: NavAccount }) {
  const { auth, current, adminWaiting, profile, profileHref, profileCurrent, ticketsCurrent, name, showEvents } = account;

  const organisersButton = (
    <Link href={ORGANISERS_HREF} aria-current={current(ORGANISERS_HREF)} className="btn btn-outline btn-lg w-full">
      For organisers
    </Link>
  );

  if (!auth.configured || auth.status === "signed-out") {
    return (
      <div className="mt-auto flex flex-col gap-4 pt-8">
        <Link
          href="/login"
          aria-current={current("/login")}
          className="btn btn-signal btn-lg w-full"
          title={auth.configured ? undefined : NOT_CONFIGURED}
        >
          Sign in
        </Link>
        {organisersButton}
      </div>
    );
  }

  if (auth.status === "loading") {
    return (
      <div className="mt-auto flex flex-col gap-4 pt-8">
        <div className="flex min-h-16 items-center gap-4">
          <span aria-hidden="true" data-avatar-placeholder="" className="size-12 shrink-0 rounded-full bg-avatar-placeholder" />
          <span className="label-nav text-muted">…</span>
        </div>
        {organisersButton}
      </div>
    );
  }

  function row(href: string, label: string, extra?: ReactNode, isCurrent: "page" | "location" | undefined = current(href)) {
    return (
      <li className="border-t border-surface-border">
        <Link href={href} aria-current={isCurrent} className={menuRowClass}>
          <span className="flex min-h-6 items-center justify-between gap-3">
            <span>{label}</span>
            {extra}
          </span>
        </Link>
      </li>
    );
  }

  const shownName = profile === undefined ? auth.email ?? "…" : name;
  return (
    <div className="mt-auto flex flex-col pt-8">
      <Link
        href={profileHref}
        aria-label={`${shownName}, view profile`}
        aria-current={profileCurrent}
        className="flex min-h-16 items-center gap-4 pb-4"
      >
        <AccountAvatar account={account} size="card" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xl font-semibold">{shownName}</span>
          <span className="text-sm font-medium text-muted">View profile</span>
        </span>
      </Link>
      <ul className="flex flex-col">
        {row(MY_TICKETS_HREF, "My tickets", undefined, ticketsCurrent)}
        {row("/saved", "Saved")}
        {row("/messages", "Messages")}
        {showEvents && row("/dashboard", "Your events")}
        {auth.isAdmin &&
          row(
            "/admin",
            "Admin",
            <CountBadge count={adminWaiting} srText={`, ${adminWaiting} waiting`} dataAttribute="data-admin-badge" />,
          )}
      </ul>
      {organisersButton}
    </div>
  );
}

/**
 * The unread count beside "Messages". Not a live region: it changes in the
 * background every minute, and announcing that would be noise. The count is
 * part of the link's name instead ("Messages, 2 unread"), read when the link is.
 */
function UnreadBadge({ count, tone, shape }: { count: number | null; tone?: "plain" | "signal"; shape?: "badge" | "pill" }) {
  return <CountBadge count={count} srText={`, ${count} unread`} dataAttribute="data-unread-badge" tone={tone} shape={shape} />;
}
