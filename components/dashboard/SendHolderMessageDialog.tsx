"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { ticketHolderCount } from "@/lib/holder-message-rules";

const TITLE_ID = "send-holder-message-title";
const PREVIEW_ID = "send-holder-message-preview";
const ATTEST_ID = "send-holder-message-attest";
const ATTEST_ERROR_ID = "send-holder-message-attest-error";
const PROBLEM_ID = "send-holder-message-problem";

/**
 * "Send to N ticket holders?": a modal dialog (native `<dialog>`, so focus is
 * kept inside, Escape closes it and focus returns to the Send button), with a
 * preview of what goes out and the tick box the API requires. Escape and
 * Cancel are ignored while a send is in flight. The form inside is mounted
 * fresh each time the dialog opens, and again when `askAgain` changes (the
 * count changed under the organiser: they must tick the box again).
 */
export default function SendHolderMessageDialog({
  open,
  count,
  subject,
  body,
  busy,
  problem,
  fieldProblem,
  notice,
  askAgain,
  onSend,
  onClose,
}: {
  open: boolean;
  /** How many people this will reach. */
  count: number;
  subject: string;
  body: string;
  busy: boolean;
  /** The send failed: shown in the dialog (the form is kept for another try). */
  problem: string | null;
  /** The API refused the tick box. */
  fieldProblem: string | null;
  /** Something changed since the organiser looked: said above the preview. */
  notice: string | null;
  askAgain: number;
  onSend: () => void;
  onClose: () => void;
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
      aria-labelledby={TITLE_ID}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
      className="mx-0 mt-auto mb-0 max-h-[90dvh] w-full max-w-none overflow-y-auto border-t border-foreground bg-background p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-foreground backdrop:bg-ink/50 sm:m-auto sm:max-h-[85dvh] sm:max-w-lg sm:border sm:p-8"
    >
      {open && (
        <ConfirmForm
          key={askAgain}
          count={count}
          subject={subject}
          body={body}
          busy={busy}
          problem={problem}
          fieldProblem={fieldProblem}
          notice={notice}
          onSend={onSend}
          onCancel={onClose}
        />
      )}
    </dialog>
  );
}

function ConfirmForm({
  count,
  subject,
  body,
  busy,
  problem,
  fieldProblem,
  notice,
  onSend,
  onCancel,
}: {
  count: number;
  subject: string;
  body: string;
  busy: boolean;
  problem: string | null;
  fieldProblem: string | null;
  notice: string | null;
  onSend: () => void;
  onCancel: () => void;
}) {
  const [attested, setAttested] = useState(false);
  const [attestError, setAttestError] = useState<string | null>(null);
  const attestRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const shownError = attestError ?? fieldProblem;

  // Opening starts at the title, so the question and the preview are read first.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // A failed send puts focus on what went wrong.
  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!attested) {
      setAttestError("Tick the box to send.");
      attestRef.current?.focus();
      return;
    }
    setAttestError(null);
    onSend();
  }

  const describedBy = [PREVIEW_ID, problem ? PROBLEM_ID : null].filter(Boolean).join(" ");

  return (
    <form noValidate aria-busy={busy} onSubmit={submit} className="flex flex-col gap-5">
      <h2 id={TITLE_ID} ref={titleRef} tabIndex={-1} className="font-heading text-xl break-words outline-offset-2">
        Send to {ticketHolderCount(count)}?
      </h2>

      {notice && (
        <Notice role="status">{notice}</Notice>
      )}

      <div id={PREVIEW_ID} className="flex flex-col gap-2 border border-foreground/30 bg-card p-3 sm:p-4">
        <p className="eyebrow text-muted">Preview</p>
        <p className="font-semibold break-words">{subject}</p>
        <p className="text-sm leading-5 break-words whitespace-pre-wrap">{body}</p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ATTEST_ID} className="flex min-h-11 items-center gap-3 text-sm leading-5">
          <input
            ref={attestRef}
            id={ATTEST_ID}
            type="checkbox"
            checked={attested}
            onChange={(e) => {
              setAttested(e.target.checked);
              setAttestError(null);
            }}
            aria-required="true"
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? ATTEST_ERROR_ID : undefined}
            className="size-5 shrink-0"
          />
          This is about the event, not promotion
        </label>
        {shownError && (
          <p id={ATTEST_ERROR_ID} className="text-sm text-danger">
            {shownError}
          </p>
        )}
      </div>

      {problem && (
        <div id={PROBLEM_ID} ref={problemRef} tabIndex={-1} className="outline-offset-2">
          <Notice tone="danger" role="alert">
            {problem}
          </Notice>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" size="lg" busy={busy} aria-describedby={describedBy} className="w-full sm:w-auto">
          {busy ? "Sending…" : "Send"}
        </Button>
        <Button size="lg" variant="outline" busy={busy} onClick={onCancel} className="w-full sm:w-auto">
          Cancel
        </Button>
      </div>
    </form>
  );
}
