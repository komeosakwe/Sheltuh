"use client";

import { useEffect, useState } from "react";
import { MY_TICKETS_HREF, useNavAccount, type NavAccount } from "@/components/nav/useNavAccount";
import { isApiConfigured } from "@/lib/api/client";
import { getMe } from "@/lib/api/me";
import type { AccountSummary } from "@/lib/api/types";
import { accountKey } from "@/lib/auth/account";

export type AccountNavKey = "profile" | "tickets" | "saved" | "messages" | "settings";

export interface AccountNavItem {
  key: AccountNavKey;
  label: string;
  href: string;
  /** Shown in a pill after the label; null: no pill (unknown, none, or the item has no count). */
  count: number | null;
  /** The count is unread messages: the orange pill. */
  alert?: boolean;
  /** Read after the label by screen readers, with its separator: ", 3 unread". */
  countText?: string;
  current: boolean;
}

export interface AccountNav {
  account: NavAccount;
  items: AccountNavItem[];
  /** GET /api/me: the username and upcoming count; null until loaded (or in the demo, or if it failed). */
  summary: AccountSummary | null;
}

/**
 * The signed-in member's GET /api/me (lib/api/me.ts), for the account shell's "@handle · 3
 * upcoming" line and My tickets' count. Only in live mode while signed in. The count is a
 * decoration of the nav: if it can't be loaded the pill is simply not shown (the pages
 * themselves show their own errors).
 */
function useAccountSummary(account: NavAccount): AccountSummary | null {
  const { auth } = account;
  const enabled = isApiConfigured && auth.status === "signed-in";
  const key = enabled ? (accountKey(auth) ?? "") : null;
  const [result, setResult] = useState<{ key: string; summary: AccountSummary } | null>(null);
  const getToken = auth.getAccessToken;

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    getMe(getToken, controller.signal).then(
      (summary) => setResult({ key, summary }),
      () => {
        // Decorative (see above): no pill rather than a guessed one.
      },
    );
    return () => controller.abort();
  }, [key, getToken]);

  return result && result.key === key ? result.summary : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The account area's five places, in Latte's order (1120 frames: the desktop sidebar and the
 * tablet / mobile Account tabs): Profile · My tickets · Saved · Messages · Settings, with the
 * counts the app already keeps (saved, unread) and GET /api/me's upcoming tickets. Profile and
 * My tickets go to their interim pages until those are built: the member page (or where the
 * profile is edited) and Help's "Where are my tickets?" (MY_TICKETS_HREF).
 */
export function useAccountNav(pathname: string): AccountNav {
  // The header's (NavAccountProvider): the profile and organiser record aren't fetched again here.
  const account = useNavAccount();
  const summary = useAccountSummary(account);
  const upcoming = summary && summary.upcomingCount > 0 ? summary.upcomingCount : null;

  const at = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const items: AccountNavItem[] = [
    { key: "profile", label: "Profile", href: account.profileHref, count: null, current: false },
    {
      key: "tickets",
      label: "My tickets",
      href: MY_TICKETS_HREF,
      count: upcoming,
      countText: upcoming ? `, ${plural(upcoming, "upcoming event", "upcoming events")}` : undefined,
      current: false,
    },
    {
      key: "saved",
      label: "Saved",
      href: "/saved",
      count: account.savedCount,
      countText: account.savedCount ? `, ${plural(account.savedCount, "event", "events")}` : undefined,
      current: at("/saved"),
    },
    {
      key: "messages",
      label: "Messages",
      href: "/messages",
      count: account.unreadCount || null,
      alert: true,
      countText: account.unreadCount ? `, ${account.unreadCount} unread` : undefined,
      current: at("/messages"),
    },
    { key: "settings", label: "Settings", href: "/account", count: null, current: at("/account") },
  ];
  return { account, items, summary };
}

/** A pill's number: capped at 99+. */
export function shownCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
