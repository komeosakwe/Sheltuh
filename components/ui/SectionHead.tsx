import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRightIcon } from "@/components/home/icons";

/**
 * The site's one section head (docs/design/mobile-redesign.md §6.3.3 and its
 * Refinement, 22 Oct 2026), on the home, profiles and Saved alike: a calm
 * sentence-case h2 (display-md) and an optional link beside it, on the h2's
 * first-line baseline. No rule and no dotted vowels (a functional heading is plain, 29 Oct 2026): the space above a section
 * separates it, and heavy uppercase is kept for the page's main headline.
 * The only line under the h2 is an optional `note` with real context (This
 * weekend's dates), read after the heading. A long title wraps in balanced
 * lines. The h2 can take focus from script (tabIndex -1: the home's Try
 * again moves focus to the first section's heading, and #anchors land on
 * it), never from Tab.
 *
 * `link`: "See all" by default, named for screen readers by `srLabel`
 * ("See all organisers you follow"). Where the target isn't this section's
 * own list, say where it goes instead (`label: "All events"`, no srLabel).
 */
export default function SectionHead({
  id,
  title,
  note,
  link,
  actions,
  variant = "default",
}: {
  id: string;
  title: string;
  /** Context the title doesn't already say, e.g. "Fri 23 – Sun 25 Oct". */
  note?: string;
  link?: { href: string; label?: string; srLabel?: string };
  /** Controls after the link, e.g. a home rail's Previous and Next buttons (`RailArrows`). */
  actions?: ReactNode;
  /**
   * `feature`: the home's This weekend head (owner's mockup, 8 Nov 2026): a big bold h2, the note
   * under it a step larger, and the link larger with a thick orange underline beside the arrow.
   */
  variant?: "default" | "feature";
}) {
  const feature = variant === "feature";
  const label = link?.label ?? "See all";
  // The feature link's underline is the words' own (so it stops before the arrow): 3px of orange, 8px under.
  const underline = feature ? "underline decoration-signal decoration-3 underline-offset-8" : undefined;
  const linkElement = link && (
    <Link
      href={link.href}
      className={`group/link inline-flex min-h-11 shrink-0 items-center px-1 font-semibold ${
        feature
          ? "gap-2 text-lg leading-6"
          : "gap-1 text-sm leading-5 underline underline-offset-4"
      } ${actions ? "" : "-mr-1"}`.trim()}
    >
      {link.srLabel ? (
        <>
          {/* The whole name in one span: a leading space in a separate sr-only suffix can be dropped inside a flex link. */}
          <span className="sr-only">
            {label} {link.srLabel}
          </span>
          <span aria-hidden="true" className={underline}>
            {label}
          </span>
        </>
      ) : feature ? (
        <span className={underline}>{label}</span>
      ) : (
        label
      )}
      <ArrowRightIcon
        className={`${feature ? "size-5" : "h-4 w-4"} shrink-0 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover/link:translate-x-0.5`}
      />
    </Link>
  );
  return (
    <div
      className={
        feature
          ? "mb-5 flex items-center justify-between gap-4 sm:mb-6"
          : "mb-3 flex items-baseline justify-between gap-4 sm:mb-4"
      }
    >
      <div className="min-w-0">
        <h2
          id={id}
          tabIndex={-1}
          className={
            feature
              ? "text-3xl leading-9 font-bold tracking-tight break-words text-balance sm:text-4xl sm:leading-10"
              : "display-md break-words text-balance"
          }
        >
          {title}
        </h2>
        {note && <p className={feature ? "mt-1 text-lg leading-6 text-muted" : "mt-0.5 text-sm leading-5 text-muted"}>{note}</p>}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">
          {linkElement}
          {actions}
        </div>
      ) : (
        linkElement
      )}
    </div>
  );
}
