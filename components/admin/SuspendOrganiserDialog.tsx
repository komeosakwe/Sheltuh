"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import MessageField from "@/components/messages/MessageField";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { validateMessage } from "@/lib/message-text";
import AdminSessionExpired from "./AdminSessionExpired";

/** The API's limit on a takedown reason (code points). */
export const SUSPEND_REASON_MAX = 500;

export const SUSPEND_WARNING =
  "This unpublishes all of their events and hides their public profile. Paid tickets stay valid; refunds are handled in Stripe. They can reapply; you’ll see it under Pending.";

export type SuspendOutcome =
  | { ok: true }
  /** The API refused the reason: shown on the field. */
  | { ok: false; reasonError: string }
  /**
   * Shown in the dialog. `gone`: there's nothing left to suspend (already
   * taken down, or unknown), so the only way on is to close the dialog.
   */
  | { ok: false; message: string; gone?: boolean }
  /** The session ran out: sign in again here (the reason is kept), then try again. */
  | { ok: false; sessionExpired: true };

const TITLE_ID = "suspend-organiser-title";
const WARNING_ID = "suspend-organiser-warning";
const REASON_ID = "suspend-organiser-reason";
const PROBLEM_ID = "suspend-organiser-problem";

/**
 * Taking an approved organiser down: a modal dialog (native `<dialog>`, so
 * focus is kept inside and Escape closes it, except while a suspend is in
 * flight). A reason is required (shown to the organiser, up to 500
 * characters). The form is mounted fresh for each organiser. `onClose` runs
 * whenever it closes (Cancel, Escape, or after `onSubmit` succeeds and the
 * parent clears `organiserName`). A browser may still force it closed (a
 * repeated Escape), so the parent must report a result that lands after that.
 */
export default function SuspendOrganiserDialog({
  organiserName,
  onClose,
  onSubmit,
}: {
  /** Who's being suspended; null when the dialog is closed. */
  organiserName: string | null;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<SuspendOutcome>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = organiserName !== null;
  /** A suspend is in flight: Escape mustn't close the dialog under it. */
  const busy = useRef(false);

  async function submit(reason: string): Promise<SuspendOutcome> {
    busy.current = true;
    try {
      return await onSubmit(reason);
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={TITLE_ID}
      aria-describedby={WARNING_ID}
      onCancel={(event) => {
        if (busy.current) event.preventDefault();
      }}
      onClose={onClose}
      className="mx-0 mt-auto mb-0 w-full max-w-none border-t border-foreground bg-background p-5 text-foreground backdrop:bg-ink/50 sm:m-auto sm:max-w-lg sm:border sm:p-8"
    >
      {organiserName !== null && <SuspendForm name={organiserName} onCancel={onClose} onSubmit={submit} />}
    </dialog>
  );
}

type Problem = { kind: "message"; message: string; gone: boolean } | { kind: "sessionExpired" };

function SuspendForm({
  name,
  onCancel,
  onSubmit,
}: {
  name: string;
  onCancel: () => void;
  onSubmit: (reason: string) => Promise<SuspendOutcome>;
}) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<"reason" | "problem" | "submit" | null>(null);

  // Opening the dialog (a user action) starts in the reason box.
  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = (target === "reason" ? reasonRef : target === "problem" ? problemRef : submitRef).current;
    if (!element) return; // Not rendered yet: an earlier render's effects can run first.
    pendingFocus.current = null;
    element.focus();
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || isGone(problem)) return;
    setProblem(null);
    const invalid = validateMessage(reason, { label: "Reasons", max: SUSPEND_REASON_MAX, empty: "Enter a reason." });
    setReasonError(invalid);
    if (invalid) {
      pendingFocus.current = "reason";
      return;
    }
    setBusy(true);
    const outcome = await onSubmit(reason.trim());
    if (outcome.ok) return; // The dialog closes.
    setBusy(false);
    if ("reasonError" in outcome) {
      setReasonError(outcome.reasonError);
      pendingFocus.current = "reason";
    } else if ("sessionExpired" in outcome) {
      setProblem({ kind: "sessionExpired" });
      pendingFocus.current = "problem";
    } else {
      setProblem({ kind: "message", message: outcome.message, gone: outcome.gone ?? false });
      pendingFocus.current = "problem";
    }
  }

  const gone = isGone(problem);

  // The reauth form isn't a description (its field labels would be read as one).
  const describedBy = problem?.kind === "message" ? `${WARNING_ID} ${PROBLEM_ID}` : WARNING_ID;

  return (
    <form noValidate aria-busy={busy} onSubmit={handleSubmit} className="flex flex-col gap-5">
      <h2 id={TITLE_ID} className="display-md !text-2xl break-words">
        Suspend {name}?
      </h2>
      <p id={WARNING_ID} className="text-sm leading-5">
        {SUSPEND_WARNING}
      </p>

      {!gone && (
        <MessageField
          id={REASON_ID}
          label="Reason (shown to the organiser)"
          value={reason}
          onChange={(value) => {
            setReason(value);
            if (reasonError) setReasonError(null);
          }}
          error={reasonError}
          rows={3}
          max={SUSPEND_REASON_MAX}
          inputRef={reasonRef}
        />
      )}

      {problem && (
        <div id={PROBLEM_ID} ref={problemRef} tabIndex={-1} className="outline-offset-2">
          {problem.kind === "sessionExpired" ? (
            // Not an alert as well: focus moves here, so it's read once.
            <AdminSessionExpired
              then="suspend them"
              alert={false}
              onSignedIn={() => {
                setProblem(null);
                pendingFocus.current = "submit";
              }}
            />
          ) : (
            <Notice tone="danger">
              {problem.message}
              {problem.gone && <> They&rsquo;ll be taken off this list when you close this.</>}
            </Notice>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        {gone ? (
          <Button
            variant="solid"
            size="lg"
            aria-describedby={PROBLEM_ID}
            onClick={onCancel}
            className="w-full sm:w-auto"
          >
            Close
          </Button>
        ) : (
          <>
            <Button
              ref={submitRef}
              type="submit"
              variant="danger"
              size="lg"
              busy={busy}
              aria-describedby={describedBy}
              className="w-full sm:w-auto"
            >
              {busy ? "Suspending…" : "Suspend organiser"}
            </Button>
            <Button variant="outline" size="lg" busy={busy} onClick={onCancel} className="w-full sm:w-auto">
              Cancel
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

function isGone(problem: Problem | null): boolean {
  return problem?.kind === "message" && problem.gone;
}
