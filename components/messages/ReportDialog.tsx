"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import type { ReportReason } from "@/lib/api/types";
import { validateMessage } from "@/lib/message-text";
import MessageField from "./MessageField";
import SessionExpiredNotice from "./SessionExpiredNotice";
import { inlineLinkClass, REPORT_REASONS } from "./shared";

export type ReportOutcome =
  | { ok: true }
  | { ok: false; fieldErrors: { reason?: string; details?: string } }
  | { ok: false; message: string }
  /** Signed out underneath the page: sign in again in place, keeping the report. */
  | { ok: false; session: true }
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

type Problem = { kind: "message"; message: string } | { kind: "session" };

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
  const [detailsError, setDetailsError] = useState<{ text: string; announced: boolean } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const firstReasonRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement | null>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"reason" | "details" | "problem" | null>(null);

  // Opening the dialog (a user action) starts at the first reason.
  useEffect(() => {
    firstReasonRef.current?.focus();
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = (target === "reason" ? firstReasonRef : target === "details" ? detailsRef : problemRef).current;
    if (!element) return; // Not rendered yet: an earlier render's effects can run first.
    pendingFocus.current = null;
    element.focus();
  });

  function showDetailsError(message: string) {
    const inBox = document.activeElement === detailsRef.current;
    setDetailsError({ text: message, announced: inBox });
    if (!inBox) pendingFocus.current = "details";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setProblem(null);
    const nextReasonError = reason ? null : REASON_ERROR;
    const nextDetailsError = validateMessage(details, { label: "Details", optional: true });
    setReasonError(nextReasonError);
    setDetailsError(null);
    if (!reason) {
      pendingFocus.current = "reason";
      if (nextDetailsError) setDetailsError({ text: nextDetailsError, announced: false });
      return;
    }
    if (nextDetailsError) {
      showDetailsError(nextDetailsError);
      return;
    }
    setBusy(true);
    const outcome = await onSubmit(reason, details.trim() || undefined);
    if (outcome.ok || "gone" in outcome) return; // The dialog closes.
    setBusy(false);
    if ("fieldErrors" in outcome) {
      setReasonError(outcome.fieldErrors.reason ?? null);
      if (outcome.fieldErrors.reason) {
        if (outcome.fieldErrors.details) setDetailsError({ text: outcome.fieldErrors.details, announced: false });
        pendingFocus.current = "reason";
      } else if (outcome.fieldErrors.details) {
        showDetailsError(outcome.fieldErrors.details);
      }
    } else if ("session" in outcome) {
      setProblem({ kind: "session" });
      pendingFocus.current = "problem";
    } else {
      setProblem({ kind: "message", message: outcome.message });
      pendingFocus.current = "problem";
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
        call 000.{" "}
        <Link href="/privacy#messages" className={inlineLinkClass}>
          How messages and reports are handled
        </Link>
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
        onChange={(value) => {
          setDetails(value);
          if (detailsError) setDetailsError(null);
        }}
        error={detailsError?.text}
        errorAnnounced={detailsError?.announced}
        rows={3}
        inputRef={detailsRef}
      />

      {problem?.kind === "message" && (
        <div ref={problemRef} tabIndex={-1} className="outline-offset-2">
          <ActionErrorNotice message={problem.message} returnTo={returnTo} announce={false} />
        </div>
      )}
      {problem?.kind === "session" && (
        <SessionExpiredNotice
          what="report"
          noticeRef={problemRef}
          onSignedIn={() => {
            setProblem(null);
            pendingFocus.current = "reason";
          }}
        />
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
