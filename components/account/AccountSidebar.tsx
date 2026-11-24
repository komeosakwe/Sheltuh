"use client";

import { useRouter } from "next/navigation";
import DashSidebar from "@/components/dashboard/ui/DashSidebar";
import MemberAvatar from "@/components/members/MemberAvatar";
import type { AccountSummary } from "@/lib/api/types";
import type { NavAccount } from "@/components/nav/useNavAccount";
import type { AccountNavItem } from "./useAccountNav";

/**
 * The desktop account sidebar (Latte's frames, "User / Sidebar", specs/SIDEBAR-desktop.md): the
 * shared dashboard sidebar (components/dashboard/ui/DashSidebar.tsx, also the organiser's) with
 * the member's 112px round photo (the cream circle while there's none), their name, "@handle · 3
 * upcoming", the five places with their counts, and "→ Log out" in orange.
 */
export default function AccountSidebar({
  account,
  items,
  summary,
}: {
  account: NavAccount;
  items: AccountNavItem[];
  summary: AccountSummary | null;
}) {
  const router = useRouter();
  const { auth } = account;
  const signedIn = auth.configured && auth.status === "signed-in";
  const handle = summary?.username ? `@${summary.username}` : null;
  const upcoming = summary ? `${summary.upcomingCount} upcoming` : null;
  const meta = [handle, upcoming].filter((part): part is string => part !== null).join(" · ");

  function logOut() {
    auth.signOut();
    router.push("/");
  }

  return (
    <DashSidebar
      area="account"
      label="Your account"
      navLabel="Account"
      avatar={
        account.profile ? (
          <MemberAvatar
            name={account.name}
            url={account.profile.avatarThumbUrl}
            getToken={auth.getAccessToken}
            size="sidebar"
            fallback="placeholder"
          />
        ) : (
          <span aria-hidden="true" data-avatar-placeholder="" className="size-28 shrink-0 rounded-full bg-avatar-placeholder" />
        )
      }
      name={signedIn ? account.name : null}
      meta={meta || null}
      // aria-current: "page" on a place's own page, "location" under it (an Accept page, under My tickets).
      items={items.map((item) => ({ ...item, current: item.current ? (item.currentKind ?? "page") : false }))}
      onLogOut={signedIn ? logOut : undefined}
      logOutTone="signal"
    />
  );
}
