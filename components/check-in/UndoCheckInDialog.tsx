"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Section";
import { ApiError } from "@/lib/api/client";
import { MAX_UNDO_REASON_LENGTH, MIN_UNDO_REASON_LENGTH } from "@/lib/api/types";
import { undoAbout, type UndoTarget } from "@/lib/check-in/door-copy";
import { eventZone } from "@/lib/format";
import { withNext } from "@/lib/safe-next-path";
import { doorBusyClass } from "./busy-class";

/**
 * Characters as the server counts them (MIN_UNDO_REASON_LENGTH and
 * MAX_UNDO_REASON_LENGTH, shared with lib/server/handlers/check-ins.ts): code
 * points, so an emoji is one, not two UTF-16 units.
 */
export function reasonLength(reason: string): number {
  return Array.from(reason).length;
}

const SUGGESTIONS = ["Scanned by mistake", "Wrong ticket scanned", "Letting them back in"];

/** A touch screen as the main pointer: focusing a text input there would throw up the keyboard over the sheet. */
function primaryPointerIsTouch(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

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
  timeZone,
}: {
  /** The admission to undo (from Recent scans or an Already-checked-in result); null when closed. */
  entry: UndoTarget | null;
  returnTo: string;
  onClose: () => void;
  onSubmit: (entry: UndoTarget, reason: string) => Promise<UndoDialogOutcome>;
  /** The event's zone, for the check-in's time; absent means Melbourne. */
  timeZone?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = entry !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Opening focuses the reason field, except on touch screens: there the heading takes focus, so the
      // keyboard only comes up when they tap the field (most reach for a suggestion). Set after showModal,
      // which would otherwise pick the field itself.
      dialog.querySelector<HTMLElement>(primaryPointerIsTouch() ? "#undo-title" : "#undo-reason")?.focus();
    }
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
      {entry && (
        <UndoForm key={entry.checkInId} entry={entry} returnTo={returnTo} onCancel={onClose} onSubmit={onSubmit} timeZone={timeZone} />
      )}
    </dialog>
  );
}

function UndoForm({
  entry,
  returnTo,
  onCancel,
  onSubmit,
  timeZone,
}: {
  entry: UndoTarget;
  returnTo: string;
  onCancel: () => void;
  onSubmit: (entry: UndoTarget, reason: string) => Promise<UndoDialogOutcome>;
  timeZone?: string;
}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  /** Bumped per field error, so the same error is put back into the live region and said again. */
  const [errorAttempt, setErrorAttempt] = useState(0);
  const [notice, setNotice] = useState<{ text: string; signIn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"input" | "notice" | null>(null);

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
    const length = reasonLength(trimmed);
    if (length < MIN_UNDO_REASON_LENGTH || length > MAX_UNDO_REASON_LENGTH) {
      setFieldError(
        length < MIN_UNDO_REASON_LENGTH
          ? `Give a reason of at least ${MIN_UNDO_REASON_LENGTH} characters.`
          : `Keep the reason to ${MAX_UNDO_REASON_LENGTH} characters or fewer.`,
      );
      setErrorAttempt((n) => n + 1);
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
      setErrorAttempt((n) => n + 1);
      pendingFocus.current = "input";
    } else {
      setNotice({ text: outcome.notice, signIn: outcome.signIn === true });
      pendingFocus.current = "notice";
    }
  }

  return (
    <form noValidate aria-busy={busy} onSubmit={handleSubmit} className="flex flex-col gap-5">
      <h2 id="undo-title" tabIndex={-1} className="display-md !text-2xl outline-offset-2">
        Undo this check-in?
      </h2>
      <p id="undo-about" className="text-sm">
        {undoAbout(entry, eventZone(timeZone))}. They&rsquo;ll count as not checked in, and the ticket can be scanned again.
      </p>

      <div className="flex flex-col gap-2">
        <label htmlFor="undo-reason" className="eyebrow text-muted">
          Reason
        </label>
        <input
          ref={inputRef}
          id="undo-reason"
          name="reason"
          value={reason}
          // maxLength counts UTF-16 units: twice the limit never cuts off a reason the server would take
          // (a code point is at most two units); the submit check above counts code points exactly.
          maxLength={MAX_UNDO_REASON_LENGTH * 2}
          autoComplete="off"
          onChange={(event) => {
            setReason(event.target.value);
            if (fieldError) setFieldError(null);
          }}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? "undo-reason-error undo-reason-hint" : "undo-reason-hint"}
          className={fieldClass}
        />
        <div>
          {/* Mounted before any error, so screen readers hear one appear. */}
          <div role="status" aria-atomic="true" data-testid="undo-reason-error-region">
            {fieldError && (
              <p key={errorAttempt} id="undo-reason-error" className="mb-1.5 text-sm text-danger">
                {fieldError}
              </p>
            )}
          </div>
          <p id="undo-reason-hint" className="text-xs text-muted">
            {`Kept in the check-in log. ${MIN_UNDO_REASON_LENGTH} to ${MAX_UNDO_REASON_LENGTH} characters.`}
          </p>
        </div>
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
        <Button type="submit" variant="danger" size="lg" busy={busy} className={`w-full sm:w-auto ${doorBusyClass}`}>
          {busy ? "Undoing…" : "Undo check-in"}
        </Button>
        <Button variant="outline" size="lg" onClick={onCancel} className="w-full sm:w-auto">
          Keep it
        </Button>
      </div>
    </form>
  );
}
