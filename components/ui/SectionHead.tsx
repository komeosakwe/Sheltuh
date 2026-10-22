import Link from "next/link";
import DotsMark from "@/components/brand/DotsMark";
import { ArrowRightIcon } from "@/components/home/icons";

/**
 * The site's one section head (docs/design/mobile-redesign.md §6.3.3), on
 * the home, profiles and Saved alike: a black rule, then the h2 (the brand
 * dots before it, centred on its first line) and an optional link beside it,
 * on the h2's baseline. There's no mono strap repeating the title: the only
 * line under the h2 is an optional `note` with real context (This weekend's
 * dates), read after the heading. A long title wraps in balanced lines. The
 * h2 can take focus from script (tabIndex -1: the home's Try again moves
 * focus to the first section's heading, and #anchors land on it), never
 * from Tab.
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
}: {
  id: string;
  title: string;
  /** Context the title doesn't already say, e.g. "Fri 23 – Sun 25 Oct". */
  note?: string;
  link?: { href: string; label?: string; srLabel?: string };
}) {
  const label = link?.label ?? "See all";
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4 border-t border-foreground pt-3 sm:mb-5">
      <div className="min-w-0">
        {/* The title alone sets the baseline (the dots' box is self-start, out of it), so the link lines up with its first line. */}
        <h2 id={id} tabIndex={-1} className="display-md flex items-baseline gap-2">
          <span className="flex h-lh shrink-0 items-center self-start">
            <DotsMark size="xs" className="text-signal" />
          </span>
          <span className="min-w-0 break-words text-balance">{title}</span>
        </h2>
        {note && <p className="meta mt-1 text-muted">{note}</p>}
      </div>
      {link && (
        <Link
          href={link.href}
          className="group/link -mr-1 inline-flex min-h-11 shrink-0 items-center gap-1 px-1 text-sm leading-5 font-semibold underline underline-offset-4"
        >
          {link.srLabel ? (
            <>
              {/* The whole name in one span: a leading space in a separate sr-only suffix can be dropped inside a flex link. */}
              <span className="sr-only">
                {label} {link.srLabel}
              </span>
              <span aria-hidden="true">{label}</span>
            </>
          ) : (
            label
          )}
          <ArrowRightIcon className="h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover/link:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
