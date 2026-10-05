import type { ReactNode, Ref } from "react";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import type { GoingAttendee } from "@/lib/api/types";

/**
 * The guest list: the viewer's own "You" row first (spanning both columns),
 * then everyone else in two columns. Rows from `newFrom` on fade in (they
 * were just revealed by "Show more").
 *
 * With `renderAction` (a member who can message the people listed), each
 * row gets that action on the right, so the list becomes one column: two
 * columns leave no room for a 44px button beside a name at 320px.
 */
export default function NameList({
  attendees,
  youName,
  youIsNew = false,
  youRef,
  newFrom,
  listRef,
  renderAction,
}: {
  attendees: GoingAttendee[];
  /** The viewer's display name when they're going; omitted otherwise. */
  youName?: string;
  youIsNew?: boolean;
  youRef?: Ref<HTMLLIElement>;
  newFrom?: number;
  listRef?: Ref<HTMLUListElement>;
  renderAction?: (attendee: GoingAttendee) => ReactNode;
}) {
  const withActions = renderAction !== undefined;
  return (
    <ul
      ref={listRef}
      aria-label="People going"
      className={withActions ? "grid grid-cols-1 gap-y-1" : "grid grid-cols-2 gap-x-4 gap-y-3"}
    >
      {youName !== undefined && (
        <li
          ref={youRef}
          tabIndex={-1}
          className={`col-span-full flex min-w-0 items-center gap-2 outline-offset-2 ${withActions ? "min-h-11" : ""} ${
            youIsNew ? "fade-in" : ""
          }`.trim()}
        >
          <InitialsAvatar name={youName} you />
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
          className={`flex min-w-0 items-center gap-2 outline-offset-2 ${withActions ? "min-h-11 flex-wrap" : ""} ${
            newFrom !== undefined && index >= newFrom ? "fade-in" : ""
          }`.trim()}
        >
          <InitialsAvatar name={attendee.displayName} />
          <span
            className={`truncate text-sm leading-5 ${withActions ? "min-w-0 flex-1" : ""}`.trim()}
            title={attendee.displayName}
          >
            {attendee.displayName}
          </span>
          {renderAction?.(attendee)}
        </li>
      ))}
    </ul>
  );
}
