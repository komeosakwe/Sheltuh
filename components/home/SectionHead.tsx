import Link from "next/link";
import DotsMark from "@/components/brand/DotsMark";
import { ArrowRightIcon } from "./icons";

/**
 * A home section's head (docs/design/mobile-redesign.md §6.3.3): a black rule,
 * then the h2 (the brand dots before it) and an optional "See all" link named
 * for screen readers by `srLabel`. There's no mono strap repeating the title:
 * the only line under the h2 is an optional `note` with real context (This
 * weekend's dates), read after the heading. The h2 can take focus from script
 * (tabIndex -1: the home's Try again moves focus to the first section's
 * heading), never from Tab.
 */
export default function SectionHead({
  id,
  title,
  note,
  seeAll,
}: {
  id: string;
  title: string;
  /** Context the title doesn't already say, e.g. "Fri 23 – Sun 25 Oct". */
  note?: string;
  seeAll?: { href: string; srLabel: string };
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4 border-t border-foreground pt-3 sm:mb-5">
      <div className="min-w-0">
        <h2 id={id} tabIndex={-1} className="display-md flex items-center gap-2">
          <DotsMark size="xs" className="shrink-0 text-signal" />
          <span className="min-w-0 break-words">{title}</span>
        </h2>
        {note && <p className="meta mt-1 text-muted">{note}</p>}
      </div>
      {seeAll && (
        <Link
          href={seeAll.href}
          className="-mr-1 inline-flex min-h-11 shrink-0 items-center gap-1 px-1 text-sm leading-5 font-semibold underline underline-offset-4"
        >
          {/* The whole name in one span: a leading space in a separate sr-only suffix can be dropped inside a flex link. */}
          <span className="sr-only">See all {seeAll.srLabel}</span>
          <span aria-hidden="true">See all</span>
          <ArrowRightIcon />
        </Link>
      )}
    </div>
  );
}
