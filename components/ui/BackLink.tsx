import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The site's one back link's look (docs/design/mobile-redesign.md §3.2):
 * Instrument Sans 14/20 semibold, underlined, 44px tall to tap. Not mono:
 * Plex Mono is for categories, dates and labels, not navigation.
 */
export const backLinkClass =
  "group/back inline-flex min-h-11 w-fit items-center gap-1 self-start text-sm leading-5 font-semibold underline underline-offset-4";

/** "← Back" above a page's content; the arrow is decorative, so the name is the words alone. */
export default function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={backLinkClass}>
      <span
        aria-hidden="true"
        className="motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover/back:-translate-x-0.5"
      >
        &larr;
      </span>{" "}
      {children}
    </Link>
  );
}
