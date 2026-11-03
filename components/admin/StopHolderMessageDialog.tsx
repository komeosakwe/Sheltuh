"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";

const TITLE_ID = "stop-holder-message-title";
const PROBLEM_ID = "stop-holder-message-problem";

/**
 * "Stop this message?": a modal dialog (native `<dialog>`, so focus is kept
 * inside, Escape closes it and focus returns to the Stop button). Stopping
 * is final: whatever hasn't gone out never does. Escape and Cancel are
 * ignored while the request is in flight.
 */
export default function StopHolderMessageDialog({
  subject,
  busy,
  problem,
  onStop,
  onClose,
}: {
  /** The message to stop; null when the dialog is closed. */
  subject: string | null;
  busy: boolean;
  problem: string | null;
  onStop: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = subject !== null;

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
      className="mx-0 mt-auto mb-0 w-full max-w-none border-t border-foreground bg-background p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-foreground backdrop:bg-ink/50 sm:m-auto sm:max-w-lg sm:border sm:p-8"
    >
      {open && (
        <div aria-busy={busy} className="flex flex-col gap-5">
          <h2 id={TITLE_ID} className="font-heading text-xl break-words">
            Stop “{subject}”?
          </h2>
          <p className="text-sm leading-5">Emails that haven’t gone out won’t be sent. This can’t be undone.</p>
          {problem && (
            <div id={PROBLEM_ID}>
              <Notice tone="danger" role="alert">
                {problem}
              </Notice>
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="danger"
              size="lg"
              busy={busy}
              aria-describedby={problem ? PROBLEM_ID : undefined}
              onClick={onStop}
              className="w-full sm:w-auto"
            >
              {busy ? "Stopping…" : "Stop sending"}
            </Button>
            <Button variant="outline" size="lg" busy={busy} onClick={onClose} className="w-full sm:w-auto">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
