import Link from "next/link";
import DotsMark from "@/components/brand/DotsMark";
import { ArrowRightIcon } from "./icons";

/**
 * A home section's head (the proposal, redesign PR 3): the two orange dots, a Heading/H2 title
 * in sentence case, an optional mono note beside it with real context only (the weekend's dates,
 * a count that's the whole number), and an optional link on the right ("See all events →"). The
 * dots are decorative, so the heading's name is the title alone. The h2 can take focus from
 * script (tabIndex -1, `data-home-focus`: Try again moves focus to the first section), never
 * from Tab.
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
  return (
    <div className={`mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 md:mb-8 ${className}`.trim()}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id={id} tabIndex={-1} data-home-focus="" className="heading-h2 flex min-w-0 items-center gap-3 break-words">
          <DotsMark size="sm" className="text-signal" />
          {title}
        </h2>
        {note && (
          <p data-section-note="" className="mono-s text-muted uppercase">
            {note}
          </p>
        )}
      </div>
      {link && (
        <Link
          href={link.href}
          className="group/link label-button -mr-2 inline-flex min-h-12 shrink-0 items-center gap-2 px-2 underline-offset-4 hover:underline"
        >
          {link.srLabel ? (
            <>
              {/* The whole name in one span: a leading space in a separate sr-only suffix can be dropped inside a flex link. */}
              <span className="sr-only">
                {link.label} {link.srLabel}
              </span>
              <span aria-hidden="true">{link.label}</span>
            </>
          ) : (
            link.label
          )}
          <ArrowRightIcon className="size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover/link:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
