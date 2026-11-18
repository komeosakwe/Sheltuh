"use client";

import MemberAvatar from "@/components/members/MemberAvatar";
import type { NavAccount } from "./useNavAccount";

const PLACEHOLDER = { nav: "size-10", card: "size-12" } as const;

/**
 * The account's round avatar in the avatar menu (40px, `nav`) and the phone drawer (48px, `card`),
 * navigation-search.md §4.1: the profile's 96px photo, fetched with the bearer token only once
 * the menu or drawer is open (`lazy`: a closed popover is never in view), else the initials of
 * the display name or the email. While the profile loads, a quiet `bg-surface` circle.
 * Decorative: the name beside it is what's read.
 */
export default function AccountAvatar({ account, size }: { account: NavAccount; size: keyof typeof PLACEHOLDER }) {
  if (account.profile === undefined) {
    return <span aria-hidden="true" data-avatar-placeholder="" className={`${PLACEHOLDER[size]} shrink-0 rounded-full bg-surface`} />;
  }
  return (
    <MemberAvatar
      name={account.name}
      url={account.profile?.avatarThumbUrl}
      getToken={account.auth.getAccessToken}
      size={size}
      lazy
    />
  );
}
