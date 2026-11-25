"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, createElement, useContext, useEffect, type ReactNode } from "react";
import { useAdminSummary } from "@/components/admin/AdminSummaryProvider";
import { useFavourites } from "@/components/favourites/FavouritesProvider";
import { useUnread } from "@/components/messages/UnreadProvider";
import { needsYouTotal } from "@/lib/admin-summary";
import type { ProfileRecord } from "@/lib/api/types";
import { useAuth, type AuthContextValue } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { useProfile } from "@/lib/auth/useProfile";
import { useFramedHint } from "@/lib/organiser-frame-hint";
import {
  isKnownOrganiser,
  ORGANISERS_HREF,
  OVERVIEW_HREF,
  organisersHref,
  type OrganiserLoad,
} from "@/lib/organiser-nav";

/**
 * Where "My tickets" goes until members have a tickets list (owner, 18 Nov 2026: Q2; the list
 * comes with the My ticket work, B1): Help's "Where are my tickets?", as /login's "Find my
 * tickets" (components/auth/LoginLinks.tsx). Tickets are emailed today.
 */
export const MY_TICKETS_HREF = "/help#where-are-my-tickets";

export { ORGANISERS_HREF } from "@/lib/organiser-nav";

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
  /** The signed-in account's organiser record, loaded once for the page (useOrganiser). */
  organiser: OrganiserLoad;
  /**
   * The account is an approved organiser: by its record, or while that loads by this browser's
   * frame hint (lib/organiser-nav.ts, isKnownOrganiser). /dashboard is prefetched for them.
   */
  knownOrganiser: boolean;
  /** Where the header's and the drawer's For organisers goes: /dashboard for a known organiser, else the For organisers page. */
  organisersHref: string;
  /**
   * aria-current for For organisers: only when it goes to the For organisers page and that's the page.
   * Never when it goes to /dashboard: there the avatar (and the drawer's Your events) already marks
   * the place, and two current links for one place would read and look doubled.
   */
  organisersCurrent: "page" | undefined;
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
  const router = useRouter();
  const signedIn = auth.configured && auth.status === "signed-in";
  const hinted = useFramedHint(signedIn ? auth.userId : undefined);
  const record: OrganiserLoad = { loading: organiser.loading, organiser: organiser.organiser, error: organiser.error };
  const knownOrganiser = isKnownOrganiser({ signedIn, record, hinted });

  // Their For organisers goes to the dashboard: have it ready before they click.
  useEffect(() => {
    if (knownOrganiser) router.prefetch(OVERVIEW_HREF);
  }, [knownOrganiser, router]);

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
    organiser: record,
    knownOrganiser,
    organisersHref: organisersHref(knownOrganiser),
    organisersCurrent: knownOrganiser ? undefined : current(ORGANISERS_HREF),
    avatarCurrent: AVATAR_MENU_PAGES.some((href) => current(href) === "page") || current(profileHref) === "page",
  };
}
