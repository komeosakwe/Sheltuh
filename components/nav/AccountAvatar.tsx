"use client";

import MemberAvatar from "@/components/members/MemberAvatar";
import type { NavAccount } from "./useNavAccount";

const PLACEHOLDER = { nav: "size-10", card: "size-12" } as const;

/**
 * The account's round avatar in the avatar menu (40px, `nav`) and the phone drawer (48px, `card`),
 * navigation-search.md §4.1 and §5.16: the profile's 96px photo, fetched with the bearer token only
 * once the menu or drawer is open (`lazy`: a closed popover is never in view). With no photo (none
 * set, still loading, or the fetch failed) it's the board's cream circle, never initials.
 * Decorative: the name beside it is what's read.
 */
export default function AccountAvatar({ account, size }: { account: NavAccount; size: keyof typeof PLACEHOLDER }) {
  if (account.profile === undefined) {
    return <span aria-hidden="true" data-avatar-placeholder="" className={`${PLACEHOLDER[size]} shrink-0 rounded-full bg-avatar-placeholder`} />;
  }
  return (
    <MemberAvatar
      name={account.name}
      url={account.profile?.avatarThumbUrl}
      getToken={account.auth.getAccessToken}
      size={size}
      lazy
      fallback="placeholder"
    />
  );
}
