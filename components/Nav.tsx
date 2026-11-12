"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { HeaderAccount, MenuAccount, headerNavClass } from "@/components/AuthNavLinks";
import UMark from "@/components/brand/UMark";
import Wordmark from "@/components/brand/Wordmark";
import HomeLogoLink from "@/components/HomeLogoLink";
import { useUnread } from "@/components/messages/UnreadProvider";

const MENU_ID = "site-menu";

/** Whether a popover is showing; false where the selector isn't supported (jsdom, old browsers). */
function isPopoverOpen(element: HTMLElement): boolean {
  try {
    return element.matches(":popover-open");
  } catch {
    return false;
  }
}

/**
 * Discover · Nearby · Community (the rules' Navigation board). Nearby is the map (/map keeps
 * its address); Community is its own page (/community, redesign PR 3).
 */
const PRIMARY_LINKS = [
  { href: "/", label: "Discover" },
  { href: "/map", label: "Nearby" },
  { href: "/community", label: "Community" },
] as const;

/**
 * While the phone menu is open the page behind it is inert: screen readers'
 * virtual cursor (which ignores focus) can't wander into content the panel
 * covers. The header stays live: it holds the menu and its Close button.
 */
function setPageInert(inert: boolean) {
  for (const el of document.querySelectorAll<HTMLElement>("main, footer")) {
    if (!el.closest("header")) el.toggleAttribute("inert", inert);
  }
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="size-6"
    >
      {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

/**
 * Site header (the proposal, and the rules' Navigation board): black in both themes (an ink
 * section, so everything inside re-skins; in Dark it meets the black page over a 1px rule), 64px
 * below `lg` and 96px from it (--header-h).
 *
 * From `lg` it's one row: the wordmark; Discover, Nearby and Community; then the account area
 * (components/AuthNavLinks.tsx). No search field (owner decision: search lives in the home's
 * hero, /search and Nearby), no heart and no "Create profile".
 *
 * Below `lg` (phones and tablets): the ü logo, a search icon link (not on the home, whose hero
 * has the page's search) and Menu, 48px targets. Menu opens a black drawer under the bar, a
 * native popover (Escape and outside taps close it, focus returns to Menu): the three places in
 * Display/M with the orange dots on the current one, then the account links and Sign in / For
 * organisers as buttons. The theme switch is in the footer only.
 */
export default function Nav() {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const unreadCount = useUnread()?.count ?? 0;
  const inThread = /^\/messages\/(?!blocked$)[^/]+$/.test(pathname);
  // At the door the header scrolls away at every width, so it doesn't sit lit above the scanner.
  const atDoor = /^\/dashboard\/[^/]+\/check-in$/.test(pathname);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  // The page itself, or (Discover) the section: What's on and every event's page belong to Discover.
  const current = (href: string): "page" | "true" | undefined =>
    isActive(href) ? "page" : href === "/" && pathname.startsWith("/events") ? "true" : undefined;

  // Keep the button label in step with the popover, and move focus into the
  // menu when it opens (the browser moves it back to the button on close).
  // Tabbing out of the menu closes it, so keyboard focus never lands on page
  // content hidden behind the panel.
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    function handleToggle(event: ToggleEvent) {
      const open = event.newState === "open";
      setMenuOpen(open);
      setPageInert(open);
      if (open) menu?.querySelector<HTMLElement>("a[href]")?.focus();
    }
    function handleFocusOut(event: FocusEvent) {
      const next = event.relatedTarget;
      if (!(next instanceof Node)) return;
      if (menu?.contains(next) || menuButtonRef.current?.contains(next)) return;
      menu?.hidePopover?.();
    }
    menu.addEventListener("toggle", handleToggle);
    menu.addEventListener("focusout", handleFocusOut);
    // The button is a native popoverTarget, so a tap before hydration already
    // opened the menu, and its toggle event fired before this listener: sync to it.
    if (isPopoverOpen(menu)) {
      setMenuOpen(true);
      setPageInert(true);
    }
    return () => {
      menu.removeEventListener("toggle", handleToggle);
      menu.removeEventListener("focusout", handleFocusOut);
      setPageInert(false);
    };
  }, []);

  // A completed navigation always closes the menu. hidePopover() is a no-op
  // when it's already closed; the optional call covers DOMs without the API.
  // Only on a change: on mount it would close a menu tapped open before
  // hydration (slow phones), so the menu flashed open and shut.
  const lastPathname = useRef(pathname);
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    menuRef.current?.hidePopover?.();
  }, [pathname]);

  function closeMenu() {
    menuRef.current?.hidePopover?.();
  }

  // Links and actions close the menu (a link to the page already showing doesn't navigate).
  // The page is live again at once (the toggle event that also does it comes a task later), so
  // focus can move into it straight away.
  function closeMenuOnAction(event: MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("a, button")) {
      menuRef.current?.hidePopover?.();
      setPageInert(false);
    }
  }

  return (
    // In a conversation on phones the header scrolls away, leaving the screen
    // (and what the keyboard leaves of it) to the messages and the composer.
    // The top padding keeps it below a status bar or notch (viewport-fit=cover);
    // it's 0 on desktop and in iOS's black status-bar style.
    // In Dark the black header meets the black page over a 1px rule, drawn inside it (after:) so
    // the header stays exactly --header-h tall.
    <header
      data-surface="ink"
      className={`${atDoor ? "relative" : inThread ? "relative lg:sticky" : "sticky"} top-0 z-30 pt-[env(safe-area-inset-top)] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:hidden after:h-px after:bg-surface-border dark:after:block`}
    >
      {/* Compact bar (phones and tablets). */}
      <div data-compact-header="" className="page-container flex h-16 items-center justify-between lg:hidden">
        {/* The ü logo, 32px tall (the rules' Mobile (390) spec); the link carries the name. */}
        <HomeLogoLink className="-ml-2 flex size-12 items-center justify-center rounded-control" onActivate={closeMenu}>
          <UMark className="h-8 w-auto" />
        </HomeLogoLink>
        <div className="-mr-2 flex items-center">
          {/* Not on the home: its hero holds the page's one search. */}
          {pathname !== "/" && (
            <Link
              href="/search"
              aria-label="Search"
              aria-current={pathname === "/search" ? "page" : undefined}
              className="flex size-12 items-center justify-center rounded-control"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="size-6"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </Link>
          )}
          <button
            ref={menuButtonRef}
            type="button"
            popoverTarget={MENU_ID}
            className="relative flex size-12 items-center justify-center rounded-control"
          >
            <MenuIcon open={menuOpen} />
            <span className="sr-only">{menuOpen ? "Close" : "Menu"}</span>
            {/* The Messages count lives inside the menu; this says there's something in there. */}
            {unreadCount > 0 && (
              <>
                <span
                  aria-hidden="true"
                  data-menu-unread=""
                  className="absolute top-1 right-0 inline-flex h-5 min-w-5 items-center justify-center rounded-badge bg-signal px-1 text-xs leading-5 font-semibold text-signal-foreground tabular-nums"
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
                <span className="sr-only">
                  , {unreadCount} unread {unreadCount === 1 ? "message" : "messages"}
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Desktop row: 96px (the proposal). */}
      <div className="page-container hidden h-24 items-center gap-8 lg:flex">
        <HomeLogoLink className="flex items-center py-2" onActivate={closeMenu}>
          <Wordmark className="h-5 w-auto" />
        </HomeLogoLink>
        <nav aria-label="Primary" className="flex flex-1 items-center gap-8">
          {PRIMARY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={headerNavClass}
              aria-current={current(link.href)}
            >
              {link.label}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-8">
            <HeaderAccount />
          </div>
        </nav>
      </div>

      {/* Phone menu: a black drawer filling the screen under the bar. No display class on this
          root: it would override the popover's closed `display: none` and the menu could never
          close. It's fixed to the viewport, so it clears the top inset and a landscape notch
          itself (all 0 unless the device has them). */}
      <div
        id={MENU_ID}
        ref={menuRef}
        popover="auto"
        className="inset-x-0 top-[calc(var(--header-h)+env(safe-area-inset-top))] bottom-auto m-0 h-[calc(100dvh-var(--header-h)-env(safe-area-inset-top))] w-full max-w-none overflow-y-auto overscroll-contain border-0 border-t border-surface-border bg-background py-0 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-foreground lg:hidden"
      >
        <nav
          // Its own name: the desktop row's nav is "Primary", and two landmarks shouldn't share one.
          aria-label="Site menu"
          onClick={closeMenuOnAction}
          className="page-container flex min-h-full flex-col pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))]"
        >
          <ul className="flex flex-col gap-2">
            {PRIMARY_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={current(link.href)}
                  // The current page gets the orange dots over its first letter.
                  className="display-m umlaut umlaut-lg block pt-4 pb-2"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-4 border-t border-surface-border pt-6">
            <MenuAccount />
          </div>
        </nav>
      </div>
    </header>
  );
}
