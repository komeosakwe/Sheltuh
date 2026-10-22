import Link from "next/link";
import type { Ref } from "react";
import { tallInlineLinkClass } from "./shared";

/** A conversation's heading (live and demo): the other person's name, and the event they're both going to. */
export default function ThreadTitle({
  name,
  event,
  headingRef,
}: {
  name: string;
  event?: { title: string; slug: string };
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="min-w-0">
      <h1 ref={headingRef} tabIndex={-1} className="display-md break-words outline-offset-2">
        {name}
      </h1>
      {event && (
        <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-muted">
          Going to
          <Link href={`/events/${event.slug}`} className={`${tallInlineLinkClass} min-w-0 break-words text-foreground`}>
            {event.title}
          </Link>
        </p>
      )}
    </div>
  );
}
