import Link from "next/link";
import type { Ref } from "react";
import ConversationAvatar from "./ConversationAvatar";

/**
 * A conversation's heading (live and demo), as the Messages frames' thread head: a 40px round
 * avatar, the other person's name (Label/Button, cut short with "…" rather than pushing the
 * actions out) and, under it in Label/Tag text/secondary, the event they're both going to.
 */
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
    <div className="flex min-w-0 flex-1 items-center gap-3 self-stretch sm:self-auto">
      <ConversationAvatar name={name} size="head" />
      <div className="min-w-0">
        <h1 ref={headingRef} tabIndex={-1} className="label-button truncate outline-offset-2">
          {name}
        </h1>
        {event && (
          <p className="label-tag flex min-w-0 items-center gap-1 text-muted">
            <span className="shrink-0">Going to</span>
            <Link
              href={`/events/${event.slug}`}
              className="inline-flex min-h-6 min-w-0 items-center truncate text-foreground underline underline-offset-4 hover:decoration-2"
            >
              <span className="truncate">{event.title}</span>
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
