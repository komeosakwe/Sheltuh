import Link from "next/link";
import DotsMark from "@/components/brand/DotsMark";
import { ArrowRightIcon } from "./icons";

/**
 * A home (and /community) section's head (the proposal, redesign PR 3): the two orange dots, a
 * Heading/H1-size title (40/48; 32/40 on phones) in sentence case, an optional mono note beside
 * it with real context only (the weekend's dates, a count that's the whole number), and an
 * optional link on the right ("See all events →"), 48px above the content from 1024px. On a phone
 * the link stays on the title's row, as "See all" (named in full for screen readers: its visible
 * words come first, WCAG 2.5.3), and the note wraps under the title with no indent. The dots are
 * decorative, so the heading's name is the title alone. The h2 can take focus from script
 * (tabIndex -1, `data-home-focus`: Try again and Reset filters move focus to it), never from Tab.
 */
export default function HomeSectionHead({
  id,
  title,
  note,
  link,
  className = "",
}: {
  id: string;
  title: string;
  note?: string;
  /** `srLabel` completes a generic label for screen readers ("See all" → "See all organisers you follow"). */
  link?: { href: string; label: string; srLabel?: string };
  className?: string;
}) {
  const name = link ? (link.srLabel ? `${link.label} ${link.srLabel}` : link.label) : "";
  // Phones show "See all" for any "See all …" link, so it fits on the title's row.
  const short = link && /^See all\b/.test(link.label) ? "See all" : link?.label;
  return (
    <div className={`mb-6 flex items-start justify-between gap-4 md:mb-8 lg:mb-12 ${className}`.trim()}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id={id} tabIndex={-1} data-home-focus="" className="heading-h1 flex min-w-0 items-center gap-3 break-words">
          <DotsMark size="sm" className="shrink-0 text-signal" />
          {title}
        </h2>
        {note && (
          <p data-section-note="" className="mono-s basis-full text-muted sm:basis-auto">
            {note}
          </p>
        )}
      </div>
      {link && (
        <Link
          href={link.href}
          aria-label={name !== link.label || short !== link.label ? name : undefined}
          className="group/link label-button -mr-2 inline-flex min-h-12 shrink-0 items-center gap-2 px-2 underline-offset-4 hover:underline"
        >
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{link.label}</span>
          <ArrowRightIcon className="size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover/link:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
