import Link from "next/link";
import DotsMark from "@/components/brand/DotsMark";
import { ArrowRightIcon } from "./icons";

/**
 * A home section's head (docs/design/brand-direction-one.md §6.4): a black
 * rule with a mono strap (the dots, a short label, an optional note on the
 * right), then the h2 and an optional "See all" link named for screen
 * readers by `srLabel`. The strap label repeats the h2, so it's hidden from
 * screen readers; the note isn't.
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
  return (
    <div className="mb-3 sm:mb-6">
      <div className="eyebrow flex items-center justify-between gap-4 border-t border-foreground pt-2">
        <span aria-hidden="true" className="flex min-w-0 items-center gap-2">
          <DotsMark size="xs" className="text-signal" />
          <span className="truncate">{strap}</span>
        </span>
        {note && <span className={`shrink-0 text-muted ${note.className ?? ""}`.trim()}>{note.text}</span>}
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
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
    </div>
  );
}
