"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import type { ReportReason } from "@/lib/api/types";
import { validateMessage } from "@/lib/message-text";
import MessageField from "./MessageField";
import { REPORT_REASONS } from "./shared";

export type ReportOutcome =
  | { ok: true }
  | { ok: false; fieldErrors: { reason?: string; details?: string } }
  | { ok: false; message: string }
  /** The conversation has gone: the dialog closes and the thread says so. */
  | { ok: false; gone: true };

const REASON_ERROR = "Choose a reason.";

/**
 * Reporting a member: a modal dialog (native `<dialog>`, so focus is kept
 * inside, Escape closes it and focus returns to what opened it). A reason is
 * required; details are optional. The form is mounted fresh on each open.
 */
export default function ReportDialog({
  open,
  otherName,
  onClose,
  onSubmit,
  returnTo,
}: {
  open: boolean;
  otherName: string;
  onClose: () => void;
  onSubmit: (reason: ReportReason, details: string | undefined) => Promise<ReportOutcome>;
  returnTo: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="report-title"
      onClose={onClose}
      className="mx-0 mt-auto mb-0 w-full max-w-none border-t border-foreground bg-background p-5 text-foreground backdrop:bg-foreground/50 sm:m-auto sm:max-w-lg sm:border sm:p-8"
    >
      {open && <ReportForm otherName={otherName} onCancel={onClose} onSubmit={onSubmit} returnTo={returnTo} />}
    </dialog>
  );
}

function ReportForm({
  otherName,
  onCancel,
  onSubmit,
  returnTo,
}: {
  otherName: string;
  onCancel: () => void;
  onSubmit: (reason: ReportReason, details: string | undefined) => Promise<ReportOutcome>;
  returnTo: string;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstReasonRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"reason" | "details" | "error" | null>(null);

  // Opening the dialog (a user action) starts at the first reason.
  useEffect(() => {
    firstReasonRef.current?.focus();
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = (target === "reason" ? firstReasonRef : target === "details" ? detailsRef : errorRef).current;
    if (!element) return; // Not rendered yet: an earlier render's effects can run first.
    pendingFocus.current = null;
    element.focus();
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const nextReasonError = reason ? null : REASON_ERROR;
    const nextDetailsError = validateMessage(details, { label: "Details", optional: true });
    setReasonError(nextReasonError);
    setDetailsError(nextDetailsError);
    if (!reason || nextDetailsError) {
      (nextReasonError ? firstReasonRef : detailsRef).current?.focus();
      return;
    }
    setBusy(true);
    const outcome = await onSubmit(reason, details.trim() || undefined);
    if (outcome.ok || "gone" in outcome) return; // The dialog closes.
    setBusy(false);
    if ("fieldErrors" in outcome) {
      setReasonError(outcome.fieldErrors.reason ?? null);
      setDetailsError(outcome.fieldErrors.details ?? null);
      pendingFocus.current = outcome.fieldErrors.reason ? "reason" : "details";
    } else {
      setError(outcome.message);
      pendingFocus.current = "error";
    }
  }

  return (
    <form noValidate aria-busy={busy} onSubmit={handleSubmit} className="flex flex-col gap-5">
      <h2 id="report-title" className="display-md !text-2xl break-words">
        Report {otherName}
      </h2>
      <p id="report-about" className="text-sm leading-5">
        We&rsquo;ll keep a copy of this conversation with your report so our team can review it, even if messages
        are deleted later. We won&rsquo;t tell {otherName} about your report. If someone is in danger right now,
        call 000.
      </p>

      <fieldset
        aria-describedby={reasonError ? "report-reason-error" : undefined}
        aria-invalid={reasonError ? true : undefined}
        className="flex flex-col gap-1"
      >
        <legend className="mb-2 text-sm font-semibold">What&rsquo;s the problem?</legend>
        {REPORT_REASONS.map((option, index) => (
          <label key={option.value} className="flex min-h-11 items-center gap-3 text-base sm:text-sm">
            <input
              ref={index === 0 ? firstReasonRef : undefined}
              type="radio"
              name="report-reason"
              value={option.value}
              checked={reason === option.value}
              onChange={() => {
                setReason(option.value);
                setReasonError(null);
              }}
              className="size-5 shrink-0"
            />
            {option.label}
          </label>
        ))}
        {reasonError && (
          <p id="report-reason-error" className="text-sm text-danger">
            {reasonError}
          </p>
        )}
      </fieldset>

      <MessageField
        id="report-details"
        label="Anything else we should know? (optional)"
        value={details}
        onChange={setDetails}
        error={detailsError}
        rows={3}
        inputRef={detailsRef}
      />

      {error && (
        <div ref={errorRef} tabIndex={-1} className="outline-offset-2">
          <ActionErrorNotice message={error} returnTo={returnTo} />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" variant="solid" size="lg" busy={busy} aria-describedby="report-about" className="w-full sm:w-auto">
          {busy ? "Sending…" : "Send report"}
        </Button>
        <Button variant="outline" size="lg" busy={busy} onClick={onCancel} className="w-full sm:w-auto">
          Cancel
        </Button>
      </div>
    </form>
  );
}
