"use client";

import type { MouseEvent } from "react";

/**
 * "Skip to main content", first in the page. It goes to `<main id="main">`, or, where the page has
 * a column of its own past a sidebar (a dashboard frame marks its page column `data-skip-target`:
 * DashFrame), straight to that column, so a keyboard user doesn't land before the sidebar's places
 * again. Without script it's a plain link to #main.
 */
export default function SkipLink() {
  function skip(event: MouseEvent<HTMLAnchorElement>) {
    const target = document.querySelector<HTMLElement>("[data-skip-target]");
    if (!target) return;
    event.preventDefault();
    target.focus();
  }
  return (
    <a
      href="#main"
      onClick={skip}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-background"
    >
      Skip to main content
    </a>
  );
}
