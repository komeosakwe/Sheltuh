"use client";

import { useState } from "react";
import type { OrganiserEditChange, OrganiserEditEntry, OrganiserLogField } from "@/lib/api/types";
import { formatDayTime } from "@/lib/format";
import { formatOrganiserFieldValue, ORGANISER_FIELD_LABELS, ORGANISER_FIELD_ORDER } from "./organiser-fields";

/** Values longer than this (code points) are cut short, with a button to show the rest. */
export const LOG_VALUE_PREVIEW_LENGTH = 120;
/** The API sends at most this many entries. */
const MAX_ENTRIES = 20;

const KIND_LABELS: Record<OrganiserEditEntry["kind"], string> = {
  profile_edit: "Profile edit",
  suspended: "Suspended",
  invite_accepted: "Joined by invite",
};

/**
 * An organiser's recent log entries (newest first), collapsed by default:
 * profile edits they made without review, edits by the Sheltüh team (such as
 * removing the featured video, `byStaff`) and takedowns, each with the
 * admin's reason. Each lists the fields that changed, before and after. Everything is
 * organiser- or admin-supplied text, shown as text.
 */
export default function OrganiserEditLog({ edits }: { edits: readonly OrganiserEditEntry[] }) {
  if (edits.length === 0) {
    return <p className="text-xs text-muted">No recent changes.</p>;
  }
  return (
    <details className="group text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4 shrink-0 motion-safe:transition-transform group-open:rotate-90"
        >
          <path d="m9 5 7 7-7 7" />
        </svg>
        Recent changes ({edits.length})
      </summary>
      <p className="text-xs text-muted">
        Newest first{edits.length >= MAX_ENTRIES ? `, the latest ${MAX_ENTRIES}` : ""}. Times are Melbourne time.
      </p>
      <ol className="mt-3 flex flex-col gap-4">
        {edits.map((entry, index) => (
          <li key={`${entry.at}-${index}`} className="flex flex-col gap-2 border-l-2 border-surface-border pl-3">
            <p className="text-xs text-muted">
              <span className="font-semibold text-foreground">
                {entry.kind === "profile_edit" && entry.byStaff ? "Edit by the Sheltüh team" : KIND_LABELS[entry.kind]}
              </span>{" "}
              ·{" "}
              <time dateTime={entry.at}>{formatDayTime(entry.at)}</time>
            </p>
            {(entry.kind === "suspended" || entry.byStaff) && entry.reason && (
              <p className="break-words whitespace-pre-wrap">
                <span className="text-muted">Reason: </span>
                {entry.reason}
              </p>
            )}
            <ChangeList entry={entry} />
          </li>
        ))}
      </ol>
    </details>
  );
}

function ChangeList({ entry }: { entry: OrganiserEditEntry }) {
  const rows = ORGANISER_FIELD_ORDER.flatMap((field) => {
    const change = entry.changes[field];
    return change ? [{ field, change }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <dl className="flex flex-col gap-2 sm:grid sm:grid-cols-[6rem_1fr] sm:gap-x-3 sm:gap-y-2">
      {rows.map(({ field, change }) => (
        <ChangeRow key={field} field={field} change={change} kind={entry.kind} />
      ))}
    </dl>
  );
}

function ChangeRow({
  field,
  change,
  kind,
}: {
  field: OrganiserLogField;
  change: OrganiserEditChange;
  kind: OrganiserEditEntry["kind"];
}) {
  const label = ORGANISER_FIELD_LABELS[field];
  return (
    // A block of its own on phones (label above values); from sm its cells join the list's grid.
    <div className="flex flex-col gap-0.5 sm:contents">
      <dt className="text-muted">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-0.5 break-words">
        <span>
          <span className="text-muted">Before: </span>
          <LogValue field={field} context={`old ${label}`} value={change.old} kind={kind} />
        </span>
        <span>
          <span className="text-muted">After: </span>
          <LogValue field={field} context={`new ${label}`} value={change.new} kind={kind} />
        </span>
      </dd>
    </div>
  );
}

function LogValue({
  field,
  context,
  value,
  kind,
}: {
  field: OrganiserLogField;
  /** "old Bio", "new Website": who a "Show all" toggle belongs to. */
  context: string;
  value: string | null;
  kind: OrganiserEditEntry["kind"];
}) {
  if (value === null) return <span className="text-muted italic">(none)</span>;
  return <LongText text={formatOrganiserFieldValue(field, value, kind)} context={context} />;
}

/**
 * Text cut to LOG_VALUE_PREVIEW_LENGTH with a "Show all" toggle, or in full
 * when it's short. `context` ("new Bio") ends the toggle's name for screen
 * readers, so several toggles in one entry can be told apart.
 */
function LongText({ text, context }: { text: string; context: string }) {
  const [expanded, setExpanded] = useState(false);
  const chars = Array.from(text);
  if (chars.length <= LOG_VALUE_PREVIEW_LENGTH) {
    return <span className="break-words whitespace-pre-wrap">{text}</span>;
  }
  return (
    <>
      <span className="break-words whitespace-pre-wrap">
        {expanded ? text : `${chars.slice(0, LOG_VALUE_PREVIEW_LENGTH).join("")}…`}
      </span>{" "}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="inline-flex min-h-6 items-center text-xs font-semibold underline underline-offset-4 hover:decoration-2"
      >
        {expanded ? "Show less" : `Show all ${chars.length.toLocaleString("en-AU")} characters`}
{" "}
        <span className="sr-only">of the {context}</span>
      </button>
    </>
  );
}
