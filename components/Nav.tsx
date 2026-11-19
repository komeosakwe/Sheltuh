"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  HeaderAccount,
  MenuAccount,
  headerNavClass,
} from "@/components/AuthNavLinks";
import UMark from "@/components/brand/UMark";
import Wordmark from "@/components/brand/Wordmark";
import HomeLogoLink from "@/components/HomeLogoLink";
import { useNavAccount } from "@/components/nav/useNavAccount";

const MENU_ID = "site-menu";

/**
 * The phone bar's logo: the orange SHELTÜH wordmark of the "Header / Mobile" and "Menu drawer /
 * Mobile" boards (navigation-search.md §5.3), which are newer than the Mobile (390) spec's ü mark.
 * Pending Latte's confirmation (§9.2 Q2): "umark" puts the ü back.
 */
const COMPACT_LOGO: "wordmark" | "umark" = "wordmark";

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
      {open ? (
        <path d="M6 6l12 12M18 6 6 18" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" />
      )}
    </svg>
  );
}

/**
 * Site header (the "Navigation" board; navigation-search.md §5.1 and §5.16), 64px below `lg` and
 * 100px from it (--header-h), as the boards draw them. Below `lg` the bar and its drawer are black
 * in both themes (ink sections, as the "Header / Mobile" board draws them). From `lg` the row
 * follows the theme (owner, 18 Nov 2026, Q1): white over a 1px black rule in Light, #0a0a0a over a
 * 1px #333 rule in Dark (`--header`), as the board's two frames.
 *
 * From `lg` it's one row: the wordmark; Discover, Nearby and Community; then the account area
 * (components/AuthNavLinks.tsx), whose avatar opens the avatar menu. No search field (owner
 * decision: search lives in the home's hero, /search and Nearby), no heart and no "Create profile".
 *
 * From 1280px the row tightens by 8px, to 92px, once the page has scrolled (Round 2 §1.2): a sentinel
 * at the document's top (an IntersectionObserver, no scroll listener) sets `data-scrolled` on the
 * header. --header-h stays 100px, so scroll padding and sticky offsets never under-measure it. The
 * header takes an 8px bottom margin as its row loses 8px, so its place in the flow stays 100px: nothing below
 * it moves, and scroll anchoring never nudges the page (back at the top, scrollY is 0, not 8). Both
 * ease together, only for people who don't prefer reduced motion.
 *
 * Below `lg` (phones and tablets): the orange wordmark (19px tall), a search icon link (not on the
 * home, whose hero has the page's search, nor while the drawer is open) and Menu, 40 × 48px targets
 * whose icons sit where the board draws them (centred 28px and 68px in from the right). Menu opens a
 * black drawer under the bar, a native popover (Escape and outside taps close it, focus returns
 * to Menu; while it's open the page behind is inert and Tab cycles through the bar and the drawer):
 * the three places in Label/Menu (40px bold) with the orange dots left of the current one, then
 * the account (navigation-search.md §5.3). The theme switch is in the footer only.
 */
export default function Nav() {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const compactBarRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const account = useNavAccount();
  const inThread = /^\/messages\/(?!blocked$)[^/]+$/.test(pathname);
  // At the door the header scrolls away at every width, so it doesn't sit lit above the scanner.
  const atDoor = /^\/dashboard\/[^/]+\/check-in$/.test(pathname);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  // The page itself, or (Discover) the section: What's on and every event's page belong to Discover.
  const current = (href: string): "page" | "true" | undefined =>
    isActive(href)
      ? "page"
      : href === "/" && pathname.startsWith("/events")
        ? "true"
        : undefined;

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
    // Focus may move anywhere in the bar (the logo and Close, which Tab cycles to from the drawer's
    // last control) without closing it; anywhere else closes it.
    function handleFocusOut(event: FocusEvent) {
      const next = event.relatedTarget;
      if (!(next instanceof Node)) return;
      if (menu?.contains(next) || menuButtonRef.current?.contains(next) || compactBarRef.current?.contains(next)) return;
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

  // Scrolled once the 16px sentinel at the document's top has left the viewport. No observer (old
  // browsers, jsdom): the header just keeps its full height.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setScrolled(!entry.isIntersecting);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
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

  // While the drawer is open, Tab and Shift+Tab cycle through the bar (logo, Close) and the
  // drawer, never past them (the page behind is inert anyway). Escape closes it with focus back
  // on Menu: the browser does that for a popover too, and this makes it the same everywhere.
  function handleHeaderKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!menuOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      menuRef.current?.hidePopover?.();
      menuButtonRef.current?.focus();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [compactBarRef.current, menuRef.current].flatMap((scope) =>
      scope ? Array.from(scope.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")) : [],
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
    // Where black meets black (Dark), and from lg in both themes (as the board's frames: black in
    // Light, #333 in Dark), a 1px rule, drawn inside the header (after:) so it stays exactly
    // --header-h tall.
    <>
      {/* The scroll sentinel: 16px at the very top of the document (absolute, so it takes no room). */}
      <span ref={sentinelRef} aria-hidden="true" data-header-sentinel="" className="pointer-events-none absolute top-0 left-0 h-4 w-px" />
      <header
        data-scrolled={scrolled ? "" : undefined}
        onKeyDown={handleHeaderKeyDown}
        className={`group/header ${atDoor ? "relative" : inThread ? "relative lg:sticky" : "sticky"} top-0 z-30 bg-ink pt-[env(safe-area-inset-top)] text-foreground lg:bg-header xl:data-scrolled:mb-2 motion-safe:transition-[margin] motion-safe:duration-200 motion-safe:ease-out after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:hidden after:h-px after:bg-surface-border dark:after:block lg:after:block lg:after:bg-foreground lg:dark:after:bg-surface-border`}
      >
        {/* Compact bar (phones and tablets): black in both themes. */}
        <div
          ref={compactBarRef}
          data-surface="ink"
          data-compact-header=""
          className="page-container flex h-16 items-center justify-between lg:hidden"
        >
          {/* The orange wordmark, 19px tall, 16px in and 2px above the bar's middle (the "Header / Mobile"
              and "Menu drawer / Mobile" boards); the link carries the name. */}
          {COMPACT_LOGO === "wordmark" ? (
            // min-w-0 / max-w-full: with 200% text at 320px it shrinks to fit beside Search and Menu.
            <HomeLogoLink className="-ml-2 flex h-12 min-w-0 items-center rounded-control px-2" onActivate={closeMenu}>
              <Wordmark className="h-4.75 w-auto max-w-full -translate-y-0.5 text-signal" />
            </HomeLogoLink>
          ) : (
            <HomeLogoLink
              className="-ml-2 flex size-12 items-center justify-center rounded-control"
              onActivate={closeMenu}
            >
              <UMark className="h-8 w-auto" />
            </HomeLogoLink>
          )}
          <div className="-mr-2 flex items-center">
            {/* Not on the home: its hero holds the page's one search. Not while the drawer is
                open either (the board draws only the wordmark and Close). */}
            {pathname !== "/" && !menuOpen && (
              <Link
                href="/search"
                aria-label="Search"
                aria-current={pathname === "/search" ? "page" : undefined}
                className="flex h-12 w-10 items-center justify-center rounded-control"
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
            {/* No count on Menu or Close: the "Header / Mobile" and "Menu drawer / Mobile" boards draw none. */}
            <button
              ref={menuButtonRef}
              type="button"
              popoverTarget={MENU_ID}
              className="flex h-12 w-10 items-center justify-center rounded-control"
            >
              <MenuIcon open={menuOpen} />
              <span className="sr-only">{menuOpen ? "Close" : "Menu"}</span>
            </button>
          </div>
        </div>

      {/* Desktop row: 100px (the "Header" board), 92px from 1280px once the page has scrolled. */}
      {/* Full width (owner, 13 Nov): the logo hugs the left and the actions the right on any screen, 64px in
          from 1280px (the mock's margin at 1440; the board's avatar ends 66px from the right), rather than
          stopping at the page column on wide screens. */}
      <div className="hidden h-25 w-full items-center gap-8 px-8 lg:flex xl:pr-16.5 xl:pl-16 xl:group-data-scrolled/header:h-23 motion-safe:transition-[height] motion-safe:duration-200 motion-safe:ease-out">
        {/* As measured on the board: the wordmark 2px above the row's middle, the places 34px after it. */}
        <HomeLogoLink className="mr-0.5 flex items-center py-2" onActivate={closeMenu}>
          <Wordmark className="h-5 w-auto -translate-y-0.5" />
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
            <HeaderAccount account={account} />
          </div>
        </nav>
      </div>

      {/* Phone menu: a black drawer filling the screen under the bar, with no rule between them.
          No display class on this root: it would override the popover's closed `display: none`
          and the menu could never close. It's fixed to the viewport, so it clears the top inset
          and a landscape notch itself (all 0 unless the device has them). */}
      <div
        id={MENU_ID}
        ref={menuRef}
        popover="auto"
        data-surface="ink"
        className="popover-fade inset-x-0 top-[calc(var(--header-h)+env(safe-area-inset-top))] bottom-auto m-0 h-[calc(100dvh-var(--header-h)-env(safe-area-inset-top))] w-full max-w-none overflow-y-auto overscroll-contain border-0 bg-background py-0 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-foreground lg:hidden"
      >
        <nav
          // Its own name: the desktop row's nav is "Primary", and two landmarks shouldn't share one.
          aria-label="Site menu"
          onClick={closeMenuOnAction}
          className="page-container flex min-h-full flex-col pb-[calc(2rem+env(safe-area-inset-bottom))]"
        >
          {/* The three places on a 72px pitch, the first word's line 56px under the 64px bar (as the
              board), the words 40px in from the margin (56 from the screen's edge), the current
              one's dots in that gap. */}
          <ul className="flex flex-col pt-11">
            {PRIMARY_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={current(link.href)}
                  className="label-menu umlaut umlaut-side block py-3 pl-10 break-words"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <MenuAccount account={account} />
        </nav>
      </div>
    </header>
    </>
  );
}
