"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Section";
import { ApiError } from "@/lib/api/client";
import type { CheckInLogEntry } from "@/lib/api/types";
import { undoAbout } from "@/lib/check-in/door-copy";
import { withNext } from "@/lib/safe-next-path";

export const UNDO_REASON_MIN = 3;
export const UNDO_REASON_MAX = 200;

const SUGGESTIONS = ["Scanned by mistake", "Wrong ticket scanned", "Letting them back in"];

/** What the page made of an undo request, for the dialog. */
export type UndoDialogOutcome =
  | { ok: true }
  | { ok: false; fieldError: string }
  | { ok: false; notice: string; signIn?: boolean };

/** An undo's thrown error, read for the dialog (§5.A10). */
export function undoErrorOutcome(error: unknown): UndoDialogOutcome {
  if (error instanceof ApiError) {
    if (error.status === 400 && error.fieldErrors?.reason) return { ok: false, fieldError: error.fieldErrors.reason };
    if (error.status === 401) return { ok: false, notice: "You’ve been signed out. Sign in again to undo.", signIn: true };
    if (error.status === 404) return { ok: false, notice: "That check-in can’t be found. Refresh the list and try again." };
    if (error.status === 429) return { ok: false, notice: "Too many scans and undos right now. Wait a few seconds and try again." };
  }
  return { ok: false, notice: "Couldn’t undo. Nothing changed. Check your connection and try again." };
}

/**
 * Undoing a check-in (docs/design/check-in.md §5.A10), following
 * ReportDialog: a native modal `<dialog>` (focus kept inside, Escape closes,
 * focus returns to the Undo button), bottom sheet on phones, form mounted
 * fresh on each open. Rendered inside the door scope, so it's ink.
 */
export default function UndoCheckInDialog({
  entry,
  returnTo,
  onClose,
  onSubmit,
}: {
  /** The admission to undo; null when closed. */
  entry: CheckInLogEntry | null;
  returnTo: string;
  onClose: () => void;
  onSubmit: (entry: CheckInLogEntry, reason: string) => Promise<UndoDialogOutcome>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = entry !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="undo-title"
      aria-describedby="undo-about"
      onClose={onClose}
      className="mx-0 mt-auto mb-0 w-full max-w-none border-t border-foreground bg-background p-5 text-foreground backdrop:bg-black/80 sm:m-auto sm:max-w-lg sm:border sm:p-8"
    >
      {entry && <UndoForm key={entry.checkInId} entry={entry} returnTo={returnTo} onCancel={onClose} onSubmit={onSubmit} />}
    </dialog>
  );
}

function UndoForm({
  entry,
  returnTo,
  onCancel,
  onSubmit,
}: {
  entry: CheckInLogEntry;
  returnTo: string;
  onCancel: () => void;
  onSubmit: (entry: CheckInLogEntry, reason: string) => Promise<UndoDialogOutcome>;
}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; signIn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"input" | "notice" | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === "input" ? inputRef.current : noticeRef.current;
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setNotice(null);
    const trimmed = reason.trim();
    if (trimmed.length < UNDO_REASON_MIN) {
      setFieldError("Give a reason of at least 3 characters.");
      pendingFocus.current = "input";
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    setBusy(true);
    const outcome = await onSubmit(entry, trimmed);
    if (outcome.ok) return; // The dialog closes.
    setBusy(false);
    if ("fieldError" in outcome) {
      setFieldError(outcome.fieldError);
      pendingFocus.current = "input";
    } else {
      setNotice({ text: outcome.notice, signIn: outcome.signIn === true });
      pendingFocus.current = "notice";
    }
  }

  return (
    <form noValidate aria-busy={busy} onSubmit={handleSubmit} className="flex flex-col gap-5">
      <h2 id="undo-title" className="display-md !text-2xl">
        Undo this check-in?
      </h2>
      <p id="undo-about" className="text-sm">
        {undoAbout(entry)}. They&rsquo;ll count as not checked in, and the ticket can be scanned again.
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="undo-reason" className="eyebrow text-muted">
          Reason
        </label>
        <input
          ref={inputRef}
          id="undo-reason"
          name="reason"
          value={reason}
          maxLength={UNDO_REASON_MAX}
          autoComplete="off"
          onChange={(event) => {
            setReason(event.target.value);
            if (fieldError) setFieldError(null);
          }}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? "undo-reason-error undo-reason-hint" : "undo-reason-hint"}
          className={fieldClass}
        />
        {fieldError && (
          <p id="undo-reason-error" className="text-sm text-danger">
            {fieldError}
          </p>
        )}
        <p id="undo-reason-hint" className="text-xs text-muted">
          Kept in the check-in log. 3 to 200 characters.
        </p>
      </div>

      <div role="group" aria-label="Suggested reasons" className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion}
            size="sm"
            variant="outline"
            className="min-h-11"
            onClick={() => {
              setReason(suggestion);
              setFieldError(null);
            }}
          >
            {suggestion}
          </Button>
        ))}
      </div>

      {notice && (
        <div ref={noticeRef} tabIndex={-1} className="outline-offset-2">
          <Notice tone="danger">
            {notice.text}
            {notice.signIn && (
              <>
                {" "}
                <Link href={withNext("/login", returnTo)} className="underline underline-offset-2">
                  Sign in
                </Link>
              </>
            )}
          </Notice>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" variant="danger" size="lg" busy={busy} className="w-full sm:w-auto">
          {busy ? "Undoing…" : "Undo check-in"}
        </Button>
        <Button variant="outline" size="lg" onClick={onCancel} className="w-full sm:w-auto">
          Keep it
        </Button>
      </div>
    </form>
  );
}
