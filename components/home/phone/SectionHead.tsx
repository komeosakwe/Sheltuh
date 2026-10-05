import Link from "next/link";
import { ArrowRightIcon } from "./icons";

/** Sentence-case section title with an optional "See all" link (named for screen readers by `srLabel`). */
export default function SectionHead({
  id,
  title,
  seeAll,
}: {
  id: string;
  title: string;
  seeAll?: { href: string; srLabel: string };
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 id={id} className="text-[1.375rem] leading-7 normal-case">
        {title}
      </h2>
      {seeAll && (
        <Link
          href={seeAll.href}
          className="-mr-1 inline-flex min-h-11 shrink-0 items-center gap-1 px-1 text-sm font-semibold underline-offset-4 hover:underline"
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
