"use client";

import { useId, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { parseImport } from "@/lib/seating/editing";
import type { SeatMapTemplate } from "@/lib/seating/template";
import SeatDialog from "../SeatDialog";

/** Downloads the map as `{slug}-seat-map.json` (docs/design/seating.md §5.13). */
export function exportSeatMap(template: SeatMapTemplate, slug: string) {
  const blob = new Blob([`${JSON.stringify(template, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug}-seat-map.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

type Parsed = ReturnType<typeof parseImport>;

/**
 * Import a seat map from a JSON file (§5.13): checked with the same
 * validator as the API, then "Replace the current map?". With
 * `requireReason` (an admin's replacement, §5.14) a logged reason is
 * required and the confirm button is "Replace map" in danger style.
 * `onReplace` resolves to an error message to show, or null when done.
 */
export default function ImportDialog({
  open,
  onClose,
  ticketTypeIds,
  onReplace,
  requireReason = false,
  title = "Import a seat map",
}: {
  open: boolean;
  onClose: () => void;
  ticketTypeIds: string[];
  onReplace: (template: SeatMapTemplate, reason: string) => Promise<string | null> | string | null;
  requireReason?: boolean;
  title?: string;
}) {
  return (
    <SeatDialog open={open} title={title} onClose={onClose} wide>
      <ImportForm onClose={onClose} ticketTypeIds={ticketTypeIds} onReplace={onReplace} requireReason={requireReason} />
    </SeatDialog>
  );
}

function ImportForm({
  onClose,
  ticketTypeIds,
  onReplace,
  requireReason,
}: {
  onClose: () => void;
  ticketTypeIds: string[];
  onReplace: (template: SeatMapTemplate, reason: string) => Promise<string | null> | string | null;
  requireReason: boolean;
}) {
  const id = useId();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = event.target.files?.[0];
    if (!file) return setParsed(null);
    if (file.size > 1_000_000) return setParsed({ ok: false, errors: ["The file is over 1 MB."], more: 0 });
    setParsed(parseImport(await file.text(), ticketTypeIds));
  }

  async function replace() {
    if (!parsed || !parsed.ok) return;
    if (requireReason && !reason.trim()) {
      setReasonError("Give a reason. It’s logged, and the organiser sees it.");
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    const message = await onReplace(parsed.template, reason.trim());
    setBusy(false);
    if (message) setError(message);
    else onClose();
  }

  const sections = parsed?.ok ? parsed.template.sections.length : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-file`} className="eyebrow text-muted">
          Seat map file (.json)
        </label>
        <input id={`${id}-file`} type="file" accept=".json,application/json" onChange={onFile} className="min-h-11 text-sm" />
      </div>
      {parsed && !parsed.ok && (
        <Notice tone="danger" role="alert">
          <p>This file can&rsquo;t be used:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {parsed.errors.map((line) => (
              <li key={line} className="meta break-words">
                {line}
              </li>
            ))}
          </ul>
          {parsed.more > 0 && <p className="mt-1">+{parsed.more} more</p>}
        </Notice>
      )}
      {parsed && parsed.ok && (
        <>
          <p role="status" className="text-base">
            {sections} {sections === 1 ? "section" : "sections"}, {parsed.seatCount} seats. Replace the current map?
          </p>
          {requireReason && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-reason`} className="eyebrow text-muted">
                Reason (logged)
              </label>
              <textarea
                ref={reasonRef}
                id={`${id}-reason`}
                value={reason}
                maxLength={500}
                rows={3}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonError(null);
                }}
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={reasonError ? `${id}-reason-error` : undefined}
                className="px-3 py-2 text-base sm:text-sm"
              />
              {reasonError && (
                <p id={`${id}-reason-error`} role="alert" className="text-sm text-danger">
                  {reasonError}
                </p>
              )}
            </div>
          )}
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}
          <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
            <Button variant={requireReason ? "danger" : "solid"} busy={busy} onClick={replace} className="w-full sm:w-auto">
              Replace map
            </Button>
            <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
