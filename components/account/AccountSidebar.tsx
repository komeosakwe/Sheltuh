"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import MemberAvatar from "@/components/members/MemberAvatar";
import type { AccountSummary } from "@/lib/api/types";
import type { NavAccount } from "@/components/nav/useNavAccount";
import { shownCount, type AccountNavItem } from "./useAccountNav";

/**
 * The desktop account sidebar (Latte's frames, "User / Sidebar", specs/SIDEBAR-desktop.md): a
 * 264px black column (an ink surface, so it's black in both themes) beside the page, from 1024px.
 * Top to bottom: the 112px round photo (the cream circle while there's none), the name (Label/Button,
 * white), "@handle · 3 upcoming" (IBM Plex Mono 12/16, text/secondary), the five places, and
 * "→ Log out" in orange at the bottom. Not an icon sidebar: each item is an 8px dot and its label
 * (Label/Button), 48px tall, radius 16; the current one is filled surface/muted (#1f1f1f on ink),
 * its label and dot orange, with aria-current="page". Counts are Label/Tag pills: grey, or orange
 * with a black number for unread messages. No hover is drawn: hover and keyboard focus fill the
 * row as the current one is filled, and focus also has the global ring.
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
    <aside
      data-surface="ink"
      data-account-sidebar=""
      aria-label="Your account"
      className="hidden w-66 shrink-0 flex-col items-center gap-3 px-8 pt-16 pb-10 lg:flex"
    >
      {account.profile ? (
        <MemberAvatar
          name={account.name}
          url={account.profile.avatarThumbUrl}
          getToken={auth.getAccessToken}
          size="sidebar"
          fallback="placeholder"
        />
      ) : (
        <span aria-hidden="true" data-avatar-placeholder="" className="size-28 shrink-0 rounded-full bg-avatar-placeholder" />
      )}
      {signedIn && <p className="label-button w-full truncate text-center">{account.name}</p>}
      {signedIn && meta && <p className="w-full truncate text-center font-mono text-xs leading-4 text-muted">{meta}</p>}
      <div aria-hidden="true" className="h-8" />
      <nav aria-label="Account" className="w-full">
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={item.current ? "page" : undefined}
                data-account-nav={item.key}
                className={`label-button flex min-h-12 items-center gap-3 rounded-card px-4 py-3 hover:bg-surface focus-visible:bg-surface motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${
                  item.current ? "bg-surface text-signal" : "text-foreground"
                }`}
              >
                <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${item.current ? "bg-signal" : "bg-foreground"}`} />
                {/* The count's words sit in the label's box, so the link is named "Saved, 12 events". */}
                <span className="min-w-0 flex-1 truncate">
                  {item.label}
                  {item.countText && <span className="sr-only">{item.countText}</span>}
                </span>
                {item.count !== null && (
                  <span
                    aria-hidden="true"
                    data-account-count=""
                    className={`label-tag shrink-0 rounded-badge px-2 py-1 tabular-nums ${
                      item.alert ? "bg-signal text-signal-foreground" : "bg-surface-border text-foreground"
                    }`}
                  >
                    {shownCount(item.count)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div aria-hidden="true" className="flex-1" />
      {signedIn && (
        <button
          type="button"
          onClick={logOut}
          className="label-button flex min-h-12 w-full items-center gap-2 rounded-card px-4 py-3 text-left text-signal hover:bg-surface focus-visible:bg-surface"
        >
          <span aria-hidden="true">→</span>
          Log out
        </button>
      )}
    </aside>
  );
}
