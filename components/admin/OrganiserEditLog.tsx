"use client";

import { useState } from "react";
import type { OrganiserEditChange, OrganiserEditEntry, OrganiserEditField } from "@/lib/api/types";
import { formatDayTime } from "@/lib/format";
import { formatOrganiserFieldValue, ORGANISER_FIELD_LABELS, ORGANISER_FIELD_ORDER } from "./organiser-fields";

/** Values longer than this (code points) are cut short, with a button to show the rest. */
export const LOG_VALUE_PREVIEW_LENGTH = 120;
/** The API sends at most this many entries. */
const MAX_ENTRIES = 20;

const KIND_LABELS: Record<OrganiserEditEntry["kind"], string> = {
  profile_edit: "Profile edit",
  suspended: "Suspended",
};

/**
 * An organiser's recent log entries (newest first), collapsed by default:
 * profile edits they made without review, and takedowns with the admin's
 * reason. Each lists the fields that changed, old → new. Everything is
 * organiser- or admin-supplied text, shown as text.
 */
export default function OrganiserEditLog({ edits }: { edits: readonly OrganiserEditEntry[] }) {
  if (edits.length === 0) {
    return <p className="text-xs text-muted">No recent profile changes.</p>;
  }
  return (
    <details className="group text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block motion-safe:transition-transform group-open:rotate-90">
          ▸
        </span>
        Recent profile changes ({edits.length})
      </summary>
      <p className="text-xs text-muted">
        Newest first{edits.length >= MAX_ENTRIES ? `, the latest ${MAX_ENTRIES}` : ""}. Times are Melbourne time.
      </p>
      <ol className="mt-3 flex flex-col gap-4">
        {edits.map((entry, index) => (
          <li key={`${entry.at}-${index}`} className="flex flex-col gap-1.5 border-l-2 border-surface-border pl-3">
            <p className="text-xs text-muted">
              <span className="font-semibold text-foreground">{KIND_LABELS[entry.kind]}</span> ·{" "}
              <time dateTime={entry.at}>{formatDayTime(entry.at)}</time>
            </p>
            {entry.kind === "suspended" && entry.reason && (
              <p className="break-words whitespace-pre-wrap">
                <span className="text-muted">Reason: </span>
                {entry.reason}
              </p>
            )}
            <ChangeList changes={entry.changes} />
          </li>
        ))}
      </ol>
    </details>
  );
}

function ChangeList({ changes }: { changes: OrganiserEditEntry["changes"] }) {
  const rows = ORGANISER_FIELD_ORDER.flatMap((field) => {
    const change = changes[field];
    return change ? [{ field, change }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <dl className="flex flex-col gap-1">
      {rows.map(({ field, change }) => (
        <ChangeRow key={field} field={field} change={change} />
      ))}
    </dl>
  );
}

function ChangeRow({ field, change }: { field: OrganiserEditField; change: OrganiserEditChange }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="font-semibold">{ORGANISER_FIELD_LABELS[field]}</dt>
      <dd className="min-w-0 break-words">
        <LogValue field={field} value={change.old} />{" "}
        <span aria-hidden="true" className="text-muted">
          →
        </span>{" "}
        <span className="sr-only">changed to</span> <LogValue field={field} value={change.new} />
      </dd>
    </div>
  );
}

function LogValue({ field, value }: { field: OrganiserEditField; value: string | null }) {
  if (value === null) return <span className="text-muted italic">(none)</span>;
  return <LongText text={formatOrganiserFieldValue(field, value)} />;
}

/** Text cut to LOG_VALUE_PREVIEW_LENGTH with a "Show all" toggle, or in full when it's short. */
function LongText({ text }: { text: string }) {
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
      </button>
    </>
  );
}
