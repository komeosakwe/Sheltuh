import type { Ref } from "react";
import type { GoingAttendee } from "@/lib/api/types";
import { initialsFor } from "@/lib/initials";

function Avatar({ name, you = false }: { name: string; you?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center overflow-hidden text-xs leading-4 font-semibold tracking-wide ${
        you ? "bg-foreground text-background" : "bg-surface text-foreground"
      }`}
    >
      {initialsFor(name)}
    </span>
  );
}

/**
 * The guest list: the viewer's own "You" row first (spanning both columns),
 * then everyone else in two columns. Rows from `newFrom` on fade in (they
 * were just revealed by "Show more").
 */
export default function NameList({
  attendees,
  youName,
  youIsNew = false,
  youRef,
  newFrom,
  listRef,
}: {
  attendees: GoingAttendee[];
  /** The viewer's display name when they're going; omitted otherwise. */
  youName?: string;
  youIsNew?: boolean;
  youRef?: Ref<HTMLLIElement>;
  newFrom?: number;
  listRef?: Ref<HTMLUListElement>;
}) {
  return (
    <ul ref={listRef} aria-label="People going" className="grid grid-cols-2 gap-x-4 gap-y-3">
      {youName !== undefined && (
        <li
          ref={youRef}
          tabIndex={-1}
          className={`col-span-2 flex min-w-0 items-center gap-2 outline-offset-2 ${youIsNew ? "fade-in" : ""}`.trim()}
        >
          <Avatar name={youName} you />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm leading-5 font-semibold">You</span>
            <span className="truncate text-xs text-muted" title={youName}>
              Shown as {youName}
            </span>
          </span>
        </li>
      )}
      {attendees.map((attendee, index) => (
        <li
          key={attendee.attendeeId}
          data-row-index={index}
          tabIndex={-1}
          className={`flex min-w-0 items-center gap-2 outline-offset-2 ${
            newFrom !== undefined && index >= newFrom ? "fade-in" : ""
          }`.trim()}
        >
          <Avatar name={attendee.displayName} />
          <span className="truncate text-sm leading-5" title={attendee.displayName}>
            {attendee.displayName}
          </span>
        </li>
      ))}
    </ul>
  );
}
