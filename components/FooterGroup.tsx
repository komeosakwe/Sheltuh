"use client";

import Link from "next/link";
import { useId, useState } from "react";

export interface FooterLink {
  href: string;
  label: string;
}

/**
 * Footer links: 44px rows on phones, 32px (py-1 on 24px lines) from 640px.
 * `mailto:` links are plain anchors.
 */
const linkClass =
  "inline-flex min-h-11 items-center text-[0.9375rem] leading-6 underline-offset-4 hover:underline sm:min-h-8 sm:self-start";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150 ${open ? "rotate-180" : ""}`.trim()}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * One group of footer links, a labelled nav (docs/design/mobile-redesign.md,
 * Refinement 22 Oct 2026).
 *
 * `collapsible` (Explore, Our company): below 640px the group is a
 * disclosure, a full-width 44px button with `aria-expanded` that shows or
 * hides its links (closed at first), so the footer stays short; from 640px
 * it's an ordinary column with its heading, always open. Not collapsible
 * (Fan support): always open at every width, so help, refunds and a person
 * are never behind a tap; on phones its links sit in a wrapping row.
 */
export default function FooterGroup({
  heading,
  links,
  collapsible = false,
}: {
  heading: string;
  links: FooterLink[];
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const headingClass = "eyebrow pb-1 text-muted";
  const listClass = collapsible
    ? `${open ? "flex" : "hidden"} flex-col pb-2 sm:flex sm:pb-0`
    : "flex flex-wrap gap-x-5 sm:flex-col sm:gap-x-0";

  return (
    <nav
      aria-label={heading}
      className={collapsible ? "border-t border-surface-border sm:border-0" : "pb-2 sm:pb-0"}
    >
      {collapsible ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
            className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-[0.9375rem] leading-6 font-semibold sm:hidden"
          >
            {heading}
            <ChevronIcon open={open} />
          </button>
          {/* From 640px the group is always open: its heading is a label, not a control. */}
          <p className={`hidden sm:block ${headingClass}`}>{heading}</p>
        </>
      ) : (
        <p className={headingClass}>{heading}</p>
      )}
      <ul id={listId} className={listClass}>
        {links.map((link) => (
          <li key={link.href} className="flex">
            {link.href.startsWith("mailto:") ? (
              <a href={link.href} className={linkClass}>
                {link.label}
              </a>
            ) : (
              <Link href={link.href} className={linkClass}>
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
