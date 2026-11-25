"use client";

import { usePathname } from "next/navigation";
import { createContext, createElement, useContext, type ReactNode } from "react";
import { useAdminSummary } from "@/components/admin/AdminSummaryProvider";
import { useFavourites } from "@/components/favourites/FavouritesProvider";
import { useUnread } from "@/components/messages/UnreadProvider";
import { needsYouTotal } from "@/lib/admin-summary";
import type { ProfileRecord } from "@/lib/api/types";
import { useAuth, type AuthContextValue } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { useProfile } from "@/lib/auth/useProfile";

/**
 * Where "My tickets" goes until members have a tickets list (owner, 18 Nov 2026: Q2; the list
 * comes with the My ticket work, B1): Help's "Where are my tickets?", as /login's "Find my
 * tickets" (components/auth/LoginLinks.tsx). Tickets are emailed today.
 */
export const MY_TICKETS_HREF = "/help#where-are-my-tickets";

export const ORGANISERS_HREF = "/organisers/apply";

/** Where an own profile is edited: the account area's Profile page (Settings has the same card). */
export const PROFILE_HREF = "/profile";

/** The pages behind the avatar menu's rows that have no header item of their own. */
const AVATAR_MENU_PAGES = ["/account", PROFILE_HREF, "/saved", "/dashboard"];

/**
 * The member's own page, when other members can open it: the profile is visible and they aren't
 * suspended (a suspended member's page is a 404, their own included). Null otherwise.
 */
export function ownMemberPageHref(profile: ProfileRecord | null | undefined): string | null {
  if (!profile?.profileVisible || profile.suspended || !profile.profileId) return null;
  return `/members/${encodeURIComponent(profile.profileId)}`;
}

export interface NavAccount {
  auth: AuthContextValue;
  /** aria-current for a link to `href`: the page itself or anything under it. */
  current: (href: string) => "page" | undefined;
  /** The unread count; null until it's known (or never, for someone who can't message yet). */
  unreadCount: number | null;
  adminWaiting: number;
  /** Saved events, only once the list has loaded and isn't empty: never a guessed "0". */
  savedCount: number | null;
  /** The Who's Going profile: undefined while it loads, null when there's none or it failed. */
  profile: ProfileRecord | null | undefined;
  /** The member page when other members can open it (ownMemberPageHref), else /profile, where it's edited. */
  profileHref: string;
  /**
   * aria-current for a Profile link: "page" on its own page; "location" on /profile when the link goes to
   * the member page instead (as the account tabs mark it, useAccountNav).
   */
  profileCurrent: "page" | "location" | undefined;
  /** The display name, else the email: what the identity rows show first. */
  name: string;
  /** Organisers and applicants (or when that couldn't be told, as /account decides) get Your events. */
  showEvents: boolean;
  /** The page is one of the avatar menu's: the header's avatar keeps its dots. */
  avatarCurrent: boolean;
}

const NavAccountContext = createContext<NavAccount | null>(null);

/**
 * Loads the signed-in account once for the whole page (the root layout, around the header and the
 * page): the header's avatar menu and phone drawer (Nav) and the account area's sidebar and tabs
 * (AccountShell) all read it through useNavAccount, so the profile and organiser record are
 * fetched once, not once per reader.
 */
export function NavAccountProvider({ children }: { children: ReactNode }) {
  return createElement(NavAccountContext.Provider, { value: useLoadNavAccount() }, children);
}

/**
 * The signed-in account as the header's avatar menu and the phone drawer show it (Nav reads it
 * and passes it down), and as the account area's sidebar shows it: the profile for the name,
 * photo and profile link, the organiser record for Your events, and the counts already kept
 * app-wide (unread, admin, saved). Loaded by NavAccountProvider; nothing fetches in demo mode or
 * while signed out.
 */
export function useNavAccount(): NavAccount {
  const account = useContext(NavAccountContext);
  if (!account) throw new Error("useNavAccount needs a NavAccountProvider above it (the root layout has one).");
  return account;
}

/** useNavAccount where there may be no provider (a component rendered on its own, in a test): null then. */
export function useOptionalNavAccount(): NavAccount | null {
  return useContext(NavAccountContext);
}

function useLoadNavAccount(): NavAccount {
  const auth = useAuth();
  const pathname = usePathname();
  const unread = useUnread();
  const favourites = useFavourites();
  const adminSummary = useAdminSummary()?.summary;
  const { state: profileState } = useProfile();
  const organiser = useOrganiser();

  const current = (href: string) => (pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined);

  const profile =
    profileState.status === "ready" ? profileState.profile : profileState.status === "error" ? null : undefined;
  const profileHref = ownMemberPageHref(profile) ?? PROFILE_HREF;
  const savedCount =
    favourites && favourites.status === "ready" && favourites.count > 0 ? favourites.count : null;

  return {
    auth,
    current,
    unreadCount: unread?.count ?? null,
    adminWaiting: adminSummary ? needsYouTotal(adminSummary) : 0,
    savedCount,
    profile,
    profileHref,
    profileCurrent: current(profileHref) ?? (current(PROFILE_HREF) ? "location" : undefined),
    name: profile?.displayName || auth.email || "Your account",
    showEvents: !organiser.loading && (organiser.organiser !== null || organiser.error !== null),
    avatarCurrent: AVATAR_MENU_PAGES.some((href) => current(href) === "page") || current(profileHref) === "page",
  };
}
