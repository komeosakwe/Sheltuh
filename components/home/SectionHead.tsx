import Link from "next/link";
import DotsMark from "@/components/brand/DotsMark";
import { ArrowRightIcon } from "./icons";

/**
 * A home section's head (docs/design/brand-direction-one.md §6.4): a black
 * rule with a mono strap (the dots, a short label, an optional note on the
 * right), then the h2 and an optional "See all" link named for screen
 * readers by `srLabel`. The strap label repeats the h2, so it's hidden from
 * screen readers; the note isn't, and comes after the h2 in reading order.
 */
export default function SectionHead({
  id,
  title,
  strap = title,
  note,
  seeAll,
}: {
  id: string;
  title: string;
  /** The strap's short form of the title. */
  strap?: string;
  note?: { text: string; className?: string };
  seeAll?: { href: string; srLabel: string };
}) {
  // The note follows the h2 in the DOM (so it's read after the heading it belongs to)
  // but sits on the strap's right: both share the grid's first row.
  return (
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] sm:mb-6">
      <div className="eyebrow col-start-1 row-start-1 flex min-w-0 items-center gap-2 border-t border-foreground pt-2">
        <span aria-hidden="true" className="flex min-w-0 items-center gap-2">
          <DotsMark size="xs" className="text-signal" />
          <span className="truncate">{strap}</span>
        </span>
      </div>
      <div className="col-span-2 row-start-2 mt-3 flex items-end justify-between gap-4">
        <h2 id={id} className="display-md">
          {title}
        </h2>
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
      <div className="eyebrow col-start-2 row-start-1 border-t border-foreground pt-2 pl-4">
        {note && <span className={`text-muted ${note.className ?? ""}`.trim()}>{note.text}</span>}
      </div>
    </div>
  );
}
