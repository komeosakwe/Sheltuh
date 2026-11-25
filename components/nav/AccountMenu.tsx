"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import CountBadge from "@/components/ui/CountBadge";
import AccountAvatar from "./AccountAvatar";
import { MY_TICKETS_HREF, type NavAccount } from "./useNavAccount";

export const ACCOUNT_MENU_ID = "account-menu";

/**
 * A row (navigation-search.md §5.2 and §5.16, the "Avatar menu" board): 40px as drawn, 16px
 * semibold, the label 16px in from the panel's padding; --menu-hover (cream in Light, #2e2b26 in
 * Dark) under the pointer, on keyboard focus and while pressed.
 */
const rowClass =
  "group flex min-h-10 w-full items-center justify-between gap-3 rounded-control px-4 text-left text-base leading-6 font-semibold hover:bg-menu-hover focus-visible:bg-menu-hover active:bg-menu-hover";

/** The menu's two hairlines, edge to edge across the panel as drawn (through its 8px padding). */
const dividerClass = "-mx-2 h-px bg-surface-border";

/** Whether a popover is showing; false where the selector isn't supported (jsdom, old browsers). */
function isPopoverOpen(element: HTMLElement): boolean {
  try {
    return element.matches(":popover-open");
  } catch {
    return false;
  }
}

/**
 * Saved's count, as the board draws it: the number in a 24 × 16 pill in the other of the panel's
 * two fills (cream on white, white on a hovered row; Dark: #2e2b26, flush with a hovered row).
 * The number is decorative; `srText` puts it in the link's name. Never a live region.
 */
function MenuCount({ count, srText }: { count: number | null; srText: string }) {
  if (!count) return null;
  return (
    <>
      <span
        aria-hidden="true"
        data-menu-count=""
        className="inline-flex h-4 min-w-6 items-center justify-center rounded-full bg-menu-hover px-2 text-xs leading-4 font-semibold text-foreground tabular-nums group-hover:bg-menu group-focus-visible:bg-menu dark:group-hover:bg-menu-hover dark:group-focus-visible:bg-menu-hover"
      >
        {count > 99 ? "99+" : count}
      </span>
      <span className="sr-only">{srText}</span>
    </>
  );
}

/**
 * The header's avatar and its menu (navigation-search.md §5.2 and §5.16; the "Avatar menu" board),
 * from `lg`. The avatar (the 40px block with the initial and a caret) is a disclosure button: it
 * toggles a native `popover="auto"` panel holding `nav "Account"`: who's signed in, then Profile,
 * My tickets, Saved (its count), Messages (the unread badge), Your events (organisers), Admin
 * (admins), Settings and Log out.
 *
 * Keyboard: Tab from the avatar walks into the panel (it follows the button in the DOM), Arrow
 * Up / Down, Home and End move between its rows too, Escape closes it and puts focus back on
 * the avatar, and tabbing out of it closes it. An outside click closes it (light dismiss).
 *
 * The panel (280px, radius 16, as drawn) sits 8px under the 100px header, its right edge on the
 * avatar's (the row's right padding: 32px, 66px from 1280px), and follows the row to 92px once the page
 * has scrolled at XL: all CSS, so it's right before hydration too. It sits in the black header's DOM
 * (an ink section), so `data-surface="page"` puts it back on the page's theme: white with a 1px
 * hairline in Light (no shadow, as drawn), #1c1b17 with a 1px white stroke in Dark.
 */
export default function AccountMenu({ account, initial }: { account: NavAccount; initial: string }) {
  const {
    auth,
    current,
    unreadCount,
    adminWaiting,
    savedCount,
    profile,
    profileHref,
    profileCurrent,
    name,
    showEvents,
    avatarCurrent,
  } = account;
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    function handleToggle(event: ToggleEvent) {
      setOpen(event.newState === "open");
    }
    // Tabbing out of the panel (anywhere but back to the avatar) closes it.
    function handleFocusOut(event: FocusEvent) {
      const next = event.relatedTarget;
      if (!(next instanceof Node)) return;
      if (panel?.contains(next) || buttonRef.current?.contains(next)) return;
      panel?.hidePopover?.();
    }
    panel.addEventListener("toggle", handleToggle);
    panel.addEventListener("focusout", handleFocusOut);
    // Opened before hydration (the button is a native popoverTarget): sync to it.
    if (isPopoverOpen(panel)) setOpen(true);
    return () => {
      panel.removeEventListener("toggle", handleToggle);
      panel.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  function close() {
    panelRef.current?.hidePopover?.();
  }

  function items(): HTMLElement[] {
    return Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a[href], button") ?? []);
  }

  // Escape is handled here as well as by the browser, so focus always lands back on the avatar.
  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      buttonRef.current?.focus();
      return;
    }
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const target =
      event.key === "ArrowDown"
        ? list[(index + 1) % list.length]
        : event.key === "ArrowUp"
          ? list[(index - 1 + list.length) % list.length]
          : event.key === "Home"
            ? list[0]
            : event.key === "End"
              ? list[list.length - 1]
              : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  // Arrow Down on the avatar opens the menu (if it's closed) and moves into it.
  function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    const panel = panelRef.current;
    if (panel && !isPopoverOpen(panel)) panel.showPopover?.();
    items()[0]?.focus();
  }

  function handleSignOut() {
    close();
    auth.signOut();
    router.push("/");
  }

  // A link closes the menu (a link to the page already showing doesn't navigate).
  function row(href: string, label: string, extra?: ReactNode, isCurrent?: "page" | "location") {
    return (
      <li>
        <Link href={href} aria-current={isCurrent} className={rowClass} onClick={close}>
          {/* The current page: the dots over the label and its 2px underline (globals.css umlaut). */}
          <span className="umlaut" data-current={isCurrent ? "" : undefined}>
            {label}
          </span>
          {extra}
        </Link>
      </li>
    );
  }

  const line2 = profile?.displayName ? auth.email : undefined;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={ACCOUNT_MENU_ID}
        aria-controls={ACCOUNT_MENU_ID}
        aria-expanded={open}
        aria-label="Account"
        data-header-avatar=""
        data-current={avatarCurrent ? "" : undefined}
        onKeyDown={handleButtonKeyDown}
        className="umlaut nav-avatar"
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
        {/* The board's small caret: 6 × 4, 4px after the initial. */}
        <svg aria-hidden="true" viewBox="0 0 6 4" fill="currentColor" className="h-1 w-1.5">
          <path d="M0 0h6L3 4z" />
        </svg>
      </button>
      {/* No display class on the root: it would override the closed popover's display:none. */}
      <div
        id={ACCOUNT_MENU_ID}
        ref={panelRef}
        popover="auto"
        data-surface="page"
        data-account-menu=""
        onKeyDown={handlePanelKeyDown}
        className="popover-fade top-27 right-8 bottom-auto left-auto m-0 max-h-[calc(100dvh-7rem)] w-70 overflow-y-auto rounded-card border border-surface-border bg-menu p-2 text-foreground dark:border-foreground xl:right-16.5 xl:group-data-scrolled/header:top-25"
      >
        <nav aria-label="Account">
          {/* Who's signed in: not a link (Profile is the first row). */}
          <div className="flex items-center gap-4 px-2 py-4">
            <AccountAvatar account={account} size="nav" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate body-m font-semibold">{profile === undefined ? auth.email : name}</span>
              {line2 && <span className="truncate meta text-muted">{line2}</span>}
            </span>
          </div>
          <div aria-hidden="true" className={`mb-2 ${dividerClass}`} />
          <ul className="flex flex-col">
            {row(profileHref, "Profile", undefined, profileCurrent)}
            {row(MY_TICKETS_HREF, "My tickets")}
            {row("/saved", "Saved", <MenuCount count={savedCount} srText={`, ${savedCount} saved`} />, current("/saved"))}
            {row(
              "/messages",
              "Messages",
              <CountBadge count={unreadCount} srText={`, ${unreadCount} unread`} dataAttribute="data-unread-badge" tone="signal" shape="pill" />,
              current("/messages"),
            )}
            {showEvents && row("/dashboard", "Your events", undefined, current("/dashboard"))}
            {auth.isAdmin &&
              row(
                "/admin",
                "Admin",
                <CountBadge count={adminWaiting} srText={`, ${adminWaiting} waiting`} dataAttribute="data-admin-badge" shape="pill" />,
                current("/admin"),
              )}
            {row("/account", "Settings", undefined, current("/account"))}
          </ul>
          <div aria-hidden="true" className={`my-2 ${dividerClass}`} />
          {/* The board's Log out. Light: --signal-text (#d03e00), 4.8:1 on white and 4.59:1 on the cream
              hover row (owner, 19 Nov 2026: accessibility over the board's #ff4800 here). Dark: the board's
              --signal (#ff4800), 5.07:1 on the panel (navigation-search.md §5.16). */}
          <button type="button" onClick={handleSignOut} className={`${rowClass} text-signal-text dark:text-signal`}>
            Log out
          </button>
        </nav>
      </div>
    </>
  );
}
