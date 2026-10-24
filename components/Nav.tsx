"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import AuthNavLinks, { navLinkClass } from "@/components/AuthNavLinks";
import Wordmark from "@/components/brand/Wordmark";
import SearchBar from "@/components/SearchBar";
import SavedNavLink from "@/components/favourites/SavedNavLink";
import { useUnread } from "@/components/messages/UnreadProvider";
import ThemeSwitch from "@/components/theme/ThemeSwitch";
import { ButtonLink } from "@/components/ui/Button";

const MENU_ID = "site-menu";

const PRIMARY_LINKS = [
  { href: "/", label: "Discover" },
  { href: "/map", label: "Map" },
] as const;

/** The phone menu's own primary list: the desktop links plus Saved (an icon link on desktop). */
const MENU_PRIMARY_LINKS = [...PRIMARY_LINKS, { href: "/saved", label: "Saved" }] as const;

const menuAccountLinkClass = "flex min-h-11 items-center text-base leading-6 font-semibold";

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

/**
 * Site header. Below `lg` it is one 56px bar (wordmark, search link except on the
 * home, whose hero has the search; Saved; Menu button)
 * whose menu is a native popover: Escape and outside taps close it, and focus
 * returns to the Menu button. From `lg` up it is the one-row desktop header.
 */
export default function Nav() {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const unreadCount = useUnread()?.count ?? 0;
  const inThread = /^\/messages\/(?!blocked$)[^/]+$/.test(pathname);
  // At the door the paper header scrolls away at every width, so it doesn't sit lit above the scanner.
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
    return () => {
      menu.removeEventListener("toggle", handleToggle);
      menu.removeEventListener("focusout", handleFocusOut);
      setPageInert(false);
    };
  }, []);

  // A completed navigation always closes the menu. hidePopover() is a no-op
  // when it's already closed; the optional call covers DOMs without the API.
  useEffect(() => {
    menuRef.current?.hidePopover?.();
  }, [pathname]);

  // Links and actions close the menu; the theme switch doesn't: the sheet re-skinning around you is the feedback.
  function closeMenuOnAction(event: MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("a, button") && !event.target.closest("[data-theme-switch]")) {
      menuRef.current?.hidePopover?.();
    }
  }

  return (
    // In a conversation on phones the header scrolls away, leaving the screen
    // (and what the keyboard leaves of it) to the messages and the composer.
    // The top padding keeps it below a status bar or notch (viewport-fit=cover);
    // it's 0 on desktop and in iOS's default status-bar style.
    <header
      className={`${atDoor ? "relative" : inThread ? "relative lg:sticky" : "sticky"} top-0 z-30 bg-background pt-[env(safe-area-inset-top)] lg:border-b lg:border-foreground`}
    >
      {/* Compact bar (phones and tablets). */}
      <div className="flex h-14 items-center justify-between border-b border-foreground px-5 sm:px-8 lg:hidden">
        {/* The official wordmark, 20px tall (88px wide); the link carries the name. */}
        <Link href="/" aria-label="Sheltüh home" className="flex h-11 items-center">
          <Wordmark className="h-5 w-auto" />
        </Link>
        <div className="flex items-center">
          {/* Not on the home: its hero holds the page's one search (as the desktop row leaves its field out there). */}
          {pathname !== "/" && (
            <Link
              href="/search"
              aria-label="Search"
              aria-current={pathname === "/search" ? "page" : undefined}
              className="flex size-11 items-center justify-center"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="h-5 w-5 text-foreground"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </Link>
          )}
          <SavedNavLink size="compact" />
          <button
            ref={menuButtonRef}
            type="button"
            popoverTarget={MENU_ID}
            className="-mr-3 flex h-11 items-center gap-2 px-3 text-[0.8125rem] leading-4 font-semibold tracking-[0.01em] uppercase"
          >
            {menuOpen ? "Close" : "Menu"}
            {/* The Messages count lives inside the menu; this says there's something in there. */}
            {unreadCount > 0 && (
              <>
                <span
                  aria-hidden="true"
                  data-menu-unread=""
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-badge bg-foreground px-1 text-xs leading-5 font-semibold tracking-normal text-background tabular-nums"
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

      {/* Desktop row. */}
      <div className="mx-auto hidden max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-8 lg:flex">
        <Link href="/" aria-label="Sheltüh home" className="flex items-center py-1">
          <Wordmark className="h-6 w-auto" />
        </Link>
        {/* The home's hero and /search have the page's search; a second field (and a second
            location) beside it would only compete (owner, 24 Oct 2026, D7). Black submit here. */}
        {pathname !== "/" && pathname !== "/search" && (
          <div className="order-last w-full lg:order-none lg:max-w-sm lg:flex-1">
            <SearchBar label="Search the site" placeholder="Search events" tone="plain" />
          </div>
        )}
        <nav aria-label="Primary" className="ml-auto flex flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-3">
          {PRIMARY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              // The "umlaut": two orange squares over the current page's label
              // (from aria-current), black ones over the label under the pointer.
              className={navLinkClass}
              aria-current={current(link.href)}
            >
              {link.label}
            </Link>
          ))}
          <SavedNavLink size="desktop" />
          <AuthNavLinks compact />
          <ButtonLink href="/organisers/apply" variant="outline" size="sm" className="ml-1">
            For organisers
          </ButtonLink>
        </nav>
      </div>

      {/* Phone menu. No display class on this root: it would override the
          popover's closed `display: none` and the menu could never close.
          It's fixed to the viewport, so it clears the top inset and a
          landscape notch itself (all 0 unless the device has them). */}
      <div
        id={MENU_ID}
        ref={menuRef}
        popover="auto"
        className="inset-x-0 top-[calc(var(--header-h)+env(safe-area-inset-top))] bottom-auto m-0 h-[calc(100dvh-var(--header-h)-env(safe-area-inset-top))] w-full max-w-none overflow-y-auto overscroll-contain border-0 border-t border-foreground bg-background py-0 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-foreground lg:hidden"
      >
        <nav
          // Its own name: the desktop row's nav is "Primary", and two landmarks shouldn't share one.
          aria-label="Site menu"
          onClick={closeMenuOnAction}
          className="flex min-h-full flex-col px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-6 sm:px-8"
        >
          <ul className="flex flex-col">
            {MENU_PRIMARY_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={current(link.href)}
                  // The current page gets the orange umlaut over its first letter.
                  className="display-lg umlaut umlaut-lg block pt-4 pb-3"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col border-t border-foreground pt-6">
            <AuthNavLinks className={menuAccountLinkClass} />
          </div>
          <ButtonLink href="/organisers/apply" variant="outline" size="lg" className="mt-8 w-full">
            For organisers
          </ButtonLink>
          <ThemeSwitch className="mt-8" />
          <p className="eyebrow mt-auto pt-8 text-muted">Melbourne · Australia</p>
        </nav>
      </div>
    </header>
  );
}
