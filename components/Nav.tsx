"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import AuthNavLinks, { navLinkClass } from "@/components/AuthNavLinks";
import SearchBar from "@/components/SearchBar";
import { ButtonLink } from "@/components/ui/Button";

const MENU_ID = "site-menu";

const PRIMARY_LINKS = [
  { href: "/", label: "Discover" },
  { href: "/map", label: "Map" },
] as const;

const menuAccountLinkClass = "flex min-h-11 items-center text-base font-semibold";

/**
 * Site header. Below `lg` it is one 56px bar (logo, search link, Menu button)
 * whose menu is a native popover: Escape and outside taps close it, and focus
 * returns to the Menu button. From `lg` up it is the one-row desktop header.
 */
export default function Nav() {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  // The desktop row marks only what the pointer is on (navLinkClass) with a bar above the word; the
  // current page is still exposed to assistive tech through aria-current.
  function linkClassName() {
    return navLinkClass;
  }

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
    };
  }, []);

  // A completed navigation always closes the menu. hidePopover() is a no-op
  // when it's already closed; the optional call covers DOMs without the API.
  useEffect(() => {
    menuRef.current?.hidePopover?.();
  }, [pathname]);

  function closeMenuOnAction(event: MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("a, button")) {
      menuRef.current?.hidePopover?.();
    }
  }

  return (
    <header className="sticky top-0 z-30 bg-background lg:bg-background/95">
      {/* Compact bar (phones and tablets). */}
      <div className="flex h-14 items-center justify-between border-b border-surface-border px-5 sm:px-8 lg:hidden">
        <Link href="/" aria-label="Sheltüh home" className="font-heading text-3xl leading-none">
          Shelt<span aria-hidden="true">ü</span>h
        </Link>
        <div className="flex items-center">
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
          <button ref={menuButtonRef} type="button" popoverTarget={MENU_ID} className="eyebrow -mr-3 flex h-11 items-center px-3">
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {/* Desktop row. */}
      <div className="mx-auto hidden max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-8 lg:flex">
        <Link href="/" aria-label="Sheltüh home" className="font-heading text-4xl leading-none">
          Shelt<span aria-hidden="true">ü</span>h
        </Link>
        <div className="order-last w-full lg:order-none lg:max-w-sm lg:flex-1">
          <SearchBar label="Search the site" />
        </div>
        <nav aria-label="Primary" className="ml-auto flex flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-3">
          {PRIMARY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={linkClassName()}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
          <AuthNavLinks compact />
          <ButtonLink href="/organisers/apply" size="sm" className="ml-1">
            For organisers
          </ButtonLink>
        </nav>
      </div>

      {/* Phone menu. No display class on this root: it would override the
          popover's closed `display: none` and the menu could never close. */}
      <div
        id={MENU_ID}
        ref={menuRef}
        popover="auto"
        className="inset-x-0 top-(--header-h) bottom-auto m-0 h-[calc(100dvh-var(--header-h))] w-full max-w-none overflow-y-auto overscroll-contain border-0 border-t border-foreground bg-background p-0 text-foreground lg:hidden"
      >
        <nav
          aria-label="Primary"
          onClick={closeMenuOnAction}
          className="flex min-h-full flex-col px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-6 sm:px-8"
        >
          <ul className="flex flex-col">
            {PRIMARY_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={`display-lg block border-t-4 py-2 ${
                    isActive(link.href) ? "border-foreground" : "border-transparent"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col border-t border-foreground pt-6">
            <AuthNavLinks className={menuAccountLinkClass} />
          </div>
          <ButtonLink href="/organisers/apply" size="lg" className="mt-8 w-full">
            For organisers
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}
