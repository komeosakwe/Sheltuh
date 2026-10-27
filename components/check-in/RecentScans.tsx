"use client";

import { useState, type RefObject } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import type { CheckInLogEntry } from "@/lib/api/types";
import { recentRow } from "@/lib/check-in/door-copy";
import { eventZone, formatEventTime, formatMessageTime } from "@/lib/format";
import { speakSeatLine } from "@/lib/seating/format";
import SeatLine from "@/components/seating/SeatLine";
import { doorBusyClass } from "./busy-class";
import DoorIcon from "./DoorIcon";

const ICON_CLASS = { check: "text-door-admit", cross: "text-danger", undo: "text-foreground" } as const;

/**
 * Rows that weren't in the previous list (after a refresh), so they can fade
 * in. Nothing is new on the first render.
 */
function useFreshIds(entries: CheckInLogEntry[]): Set<string> {
  const [tracked, setTracked] = useState({ entries, fresh: new Set<string>() });
  if (tracked.entries !== entries) {
    const before = new Set(tracked.entries.map((entry) => entry.checkInId));
    setTracked({ entries, fresh: new Set(entries.filter((e) => !before.has(e.checkInId)).map((e) => e.checkInId)) });
  }
  return tracked.fresh;
}

/** §5.A9: the newest 20 log entries, with Undo on admissions that can still be undone. */
export default function RecentScans({
  entries,
  refreshing,
  refreshFailed,
  headingRef,
  onRefresh,
  onUndo,
  timeZone,
}: {
  entries: CheckInLogEntry[];
  refreshing: boolean;
  refreshFailed: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRefresh: () => void;
  onUndo: (entry: CheckInLogEntry) => void;
  /** The event's zone, for scan times (the door's clock); absent means Melbourne. */
  timeZone?: string;
}) {
  const fresh = useFreshIds(entries);
  const zone = eventZone(timeZone);
  return (
    <section aria-labelledby="recent-scans" className="border-t border-foreground pt-5">
      {/* At 768 the column is ~275px: the heading steps down to 20px there so it stays on one line beside Refresh. */}
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="recent-scans" ref={headingRef} tabIndex={-1} className="display-md min-w-0 !text-2xl outline-offset-2 md:!text-xl lg:!text-2xl">
          Recent scans
        </h2>
        <Button
          size="sm"
          variant="outline"
          busy={refreshing}
          onClick={onRefresh}
          className={`min-h-11 shrink-0 ${doorBusyClass}`}
        >
          Refresh
        </Button>
      </div>
      {refreshFailed && (
        <div className="mb-2">
          <Notice tone="danger">Couldn&rsquo;t refresh the list. It updates again when you&rsquo;re back online.</Notice>
        </div>
      )}
      {entries.length === 0 ? (
        <p className="text-sm text-muted">No scans yet. Scanned tickets show here.</p>
      ) : (
        <ul>
          {entries.map((entry) => {
            const row = recentRow(entry);
            return (
              <li
                key={entry.checkInId}
                className={`flex min-h-14 items-start gap-3 border-b border-surface-border py-3 ${
                  fresh.has(entry.checkInId) ? "fade-in" : ""
                }`.trim()}
              >
                <DoorIcon name={row.icon} className={`size-5 ${ICON_CLASS[row.icon]}`} />
                {/* Undo sits under the detail, inside this column, so every row's time stays flush right. */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold">{row.label}</p>
                    <p className="shrink-0 text-xs text-muted tabular-nums">{formatMessageTime(entry.at, new Date(), zone)}</p>
                  </div>
                  {/* A seated ticket's seat after the type and code (docs/design/seating.md §5.15). */}
                  <p className="text-sm break-words text-muted">
                    {row.detail}
                    {entry.seat && (
                      <>
                        {row.detail && <span aria-hidden="true"> · </span>}
                        <SeatLine seat={entry.seat} />
                      </>
                    )}
                  </p>
                  {entry.undoable && (
                    <Button size="sm" variant="outline" onClick={() => onUndo(entry)} className="mt-2 min-h-11 self-start">
                      Undo{" "}
                      <span className="sr-only">
                        check-in, {[entry.ticketTypeName, entry.codeLast4 ? `code ends ${entry.codeLast4}` : null, entry.seat ? speakSeatLine(entry.seat) : null]
                          .filter(Boolean)
                          .join(", ")}
                        , {formatEventTime(entry.at, zone)}
                      </span>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
