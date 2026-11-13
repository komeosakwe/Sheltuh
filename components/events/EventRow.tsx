import Link from "next/link";
import type { ReactNode } from "react";
import { RESULTS_GRID } from "@/components/EventResults";
import { ArrowRightIcon } from "@/components/home/icons";
import EventCard from "@/components/ui/EventCard";
import type { SheltuhEvent } from "@/lib/types";

/**
 * One of the event page's rows under the details ("More from {organiser}", "Similar nearby"; the owner's
 * event mock): an h2 with a mono note beside it, "See all" on the right, then the one EventCard in the
 * listings' grid (two columns on phones and tablets, four from 1024px). `children` stands in for the cards
 * (an error and its Try again).
 */
export default function EventRow({
  id,
  title,
  note,
  seeAll,
  events,
  children,
}: {
  id: string;
  title: string;
  /** Context beside the title, as written, e.g. "Live music · near Northcote". */
  note?: string;
  /** "See all", named for screen readers by `srLabel` ("See all events by High Note"). */
  seeAll?: { href: string; srLabel: string };
  events?: readonly SheltuhEvent[];
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-2">
          <h2 id={id} className="heading-h2 break-words">
            {title}
          </h2>
          {note && <p className="mono-s text-muted">{note}</p>}
        </div>
        {seeAll && (
          <Link
            href={seeAll.href}
            className="group/link inline-flex min-h-11 shrink-0 items-center gap-2 body-s font-semibold underline-offset-4 hover:underline"
          >
            {/* The whole name in one span: a leading space in a separate sr-only suffix can be dropped inside a flex link. */}
            <span className="sr-only">See all {seeAll.srLabel}</span>
            <span aria-hidden="true">See all</span>
            <ArrowRightIcon className="size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover/link:translate-x-0.5" />
          </Link>
        )}
      </div>
      {events && events.length > 0 && (
        <ul className={RESULTS_GRID}>
          {events.map((event) => (
            <li key={event.id} className="flex min-w-0">
              <EventCard event={event} />
            </li>
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}
