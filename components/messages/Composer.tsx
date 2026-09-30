"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import { validateMessage } from "@/lib/message-text";
import MessageField from "./MessageField";

/** What the thread reports back after trying to send. */
export type SendOutcome =
  | { ok: true }
  | { ok: false; fieldError: string }
  | { ok: false; message: string }
  /** The conversation has gone: the thread swaps this composer out and handles focus itself. */
  | { ok: false; gone: true };

/**
 * The message box at the foot of a conversation. `mode`:
 * - `reply`: an ordinary message.
 * - `accept`: replying to a request, which accepts it.
 * - `waiting`: the member's own request is waiting for a reply, so they
 *   can't send more. Disabled, with `waitingNote` saying why.
 *
 * After a send, focus stays in (or returns to) the message box, ready for
 * the next one. A field error focuses the box, with the error tied to it; any
 * other failure focuses the error, so it's read out. Either way the draft
 * stays put.
 */
export default function Composer({
  otherName,
  mode,
  waitingNote,
  onSend,
  returnTo,
}: {
  otherName: string;
  mode: "reply" | "accept" | "waiting";
  waitingNote?: string;
  onSend: (body: string) => Promise<SendOutcome>;
  returnTo: string;
}) {
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // Applied once the render that shows the error (or clears the box) has committed.
  const pendingFocus = useRef<"input" | "error" | null>(null);
  const waiting = mode === "waiting";

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    // Consumed only once its element exists: an earlier render's effects can run first.
    const element = target === "error" ? errorRef.current : inputRef.current;
    if (!element) return;
    pendingFocus.current = null;
    if (!(element instanceof HTMLTextAreaElement && element.disabled)) element.focus();
  });

  async function send() {
    if (busy || waiting) return;
    setError(null);
    const invalid = validateMessage(text);
    setFieldError(invalid);
    if (invalid) {
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    const outcome = await onSend(text.trim());
    setBusy(false);
    if (outcome.ok) {
      setText("");
      setFieldError(null);
      pendingFocus.current = "input";
    } else if ("gone" in outcome) {
      // The thread replaces this composer.
    } else if ("fieldError" in outcome) {
      setFieldError(outcome.fieldError);
      pendingFocus.current = "input";
    } else {
      setError(outcome.message);
      pendingFocus.current = "error";
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  const label = mode === "accept" ? `Reply to ${otherName} to accept` : `Message ${otherName}`;

  return (
    <form noValidate aria-busy={busy} onSubmit={handleSubmit} className="flex flex-col gap-3">
      {waiting && waitingNote && (
        <p id="composer-waiting" className="text-sm leading-5">
          {waitingNote}
        </p>
      )}
      {error && (
        <div ref={errorRef} tabIndex={-1} className="outline-offset-2">
          <ActionErrorNotice message={error} returnTo={returnTo} />
        </div>
      )}
      <MessageField
        id="composer-message"
        label={label}
        value={text}
        onChange={(value) => {
          setText(value);
          if (fieldError) setFieldError(null);
        }}
        error={fieldError}
        describedBy={waiting && waitingNote ? "composer-waiting" : undefined}
        disabled={waiting}
        rows={2}
        inputRef={inputRef}
        onSubmitShortcut={() => void send()}
        trailing={
          // busy, not disabled: focus stays on the button through the send.
          <Button type="submit" variant="solid" size="lg" busy={busy} disabled={waiting} className="shrink-0">
            {busy ? "Sending…" : "Send"}
          </Button>
        }
      />
    </form>
  );
}
