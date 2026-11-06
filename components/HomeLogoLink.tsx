"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

/** Instant under prefers-reduced-motion, smooth otherwise (also where matchMedia is missing: jsdom). */
function scrollToTop() {
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, left: 0, behavior: reduced ? "instant" : "smooth" });
}

/**
 * The header's logo link to the home. It stays a plain `<a href="/">` (so
 * middle-click, Open in new tab and the status-bar address all work), but a
 * plain click while already on the home does what people expect of a logo:
 * scrolls smoothly to the top (Next's Link would do nothing for the page
 * it's already on). With a query string or hash on the home it also goes to
 * the clean "/". From any other page it navigates as usual. `onActivate`
 * runs first on every plain click, e.g. to close the phone menu.
 */
export default function HomeLogoLink({
  className,
  onActivate,
  children,
}: {
  className: string;
  onActivate?: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // A modified or non-primary click is the browser's (new tab, new window, download).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    onActivate?.();
    if (pathname !== "/") return;
    event.preventDefault();
    if (window.location.search || window.location.hash) router.push("/");
    scrollToTop();
  }

  return (
    <Link href="/" aria-label="Sheltüh home" className={className} onClick={handleClick}>
      {children}
    </Link>
  );
}
