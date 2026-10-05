"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import { validateMessage } from "@/lib/message-text";
import MessageField from "./MessageField";
import SessionExpiredNotice from "./SessionExpiredNotice";

/** What the thread reports back after trying to send. */
export type SendOutcome =
  | { ok: true }
  | { ok: false; fieldError: string }
  | { ok: false; message: string }
  /** Signed out underneath the page: sign in again in place, keeping the draft. */
  | { ok: false; session: true }
  /** The conversation has gone: the thread swaps this composer out and handles focus itself. */
  | { ok: false; gone: true };

type Problem = { kind: "message"; message: string } | { kind: "session" };

/**
 * The message box at the foot of a conversation. `mode`:
 * - `reply`: an ordinary message.
 * - `accept`: replying to a request, which accepts it.
 * - `waiting`: the member's own request is waiting for a reply, so they
 *   can't send more. Disabled (and dimmed), with `waitingNote` saying why.
 *
 * One row that grows with the text (capped, so it never fills a phone
 * screen), and a short visible label with the person's name for screen
 * readers. After a send, focus stays in (or returns to) the box. A field
 * error is announced if focus is already in the box (Ctrl/Cmd+Enter),
 * otherwise focus moves to the box and reads it; any other failure takes
 * focus itself. An expired session signs in again right here. The draft is
 * always kept.
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
  const [fieldError, setFieldError] = useState<{ text: string; announced: boolean } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  // Applied once the render that shows the error (or clears the box) has committed.
  const pendingFocus = useRef<"input" | "problem" | null>(null);
  const waiting = mode === "waiting";

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    // Consumed only once its element exists: an earlier render's effects can run first.
    const element = target === "problem" ? problemRef.current : inputRef.current;
    if (!element) return;
    pendingFocus.current = null;
    if (!(element instanceof HTMLTextAreaElement && element.disabled)) element.focus();
  });

  function showFieldError(message: string) {
    const inBox = document.activeElement === inputRef.current;
    setFieldError({ text: message, announced: inBox });
    if (!inBox) pendingFocus.current = "input";
  }

  async function send() {
    if (busy || waiting) return;
    setProblem(null);
    const invalid = validateMessage(text);
    if (invalid) {
      showFieldError(invalid);
      return;
    }
    setFieldError(null);
    setBusy(true);
    const outcome = await onSend(text.trim());
    setBusy(false);
    if (outcome.ok) {
      setText("");
      pendingFocus.current = "input";
    } else if ("gone" in outcome) {
      // The thread replaces this composer.
    } else if ("fieldError" in outcome) {
      showFieldError(outcome.fieldError);
    } else if ("session" in outcome) {
      setProblem({ kind: "session" });
      pendingFocus.current = "problem";
    } else {
      setProblem({ kind: "message", message: outcome.message });
      pendingFocus.current = "problem";
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  const label =
    mode === "accept" ? (
      <>
        Reply <span className="sr-only">to {otherName}</span> to accept
      </>
    ) : (
      <>
        Message <span className="sr-only">{otherName}</span>
      </>
    );

  return (
    <form noValidate aria-busy={busy} onSubmit={handleSubmit} className="flex flex-col gap-2">
      {waiting && waitingNote && (
        <p id="composer-waiting" className="text-sm leading-5">
          {waitingNote}
        </p>
      )}
      {problem?.kind === "message" && (
        <div ref={problemRef} tabIndex={-1} className="outline-offset-2">
          <ActionErrorNotice message={problem.message} returnTo={returnTo} announce={false} />
        </div>
      )}
      {problem?.kind === "session" && (
        <SessionExpiredNotice
          what="message"
          noticeRef={problemRef}
          onSignedIn={() => {
            setProblem(null);
            pendingFocus.current = "input";
          }}
        />
      )}
      <MessageField
        id="composer-message"
        label={label}
        value={text}
        onChange={(value) => {
          setText(value);
          if (fieldError) setFieldError(null);
        }}
        error={fieldError?.text}
        errorAnnounced={fieldError?.announced}
        describedBy={waiting && waitingNote ? "composer-waiting" : undefined}
        disabled={waiting}
        rows={1}
        autoGrow
        inputRef={inputRef}
        onSubmitShortcut={() => void send()}
        trailing={
          // busy, not disabled: focus stays on the button through the send.
          <Button type="submit" variant="solid" size="lg" busy={busy} disabled={waiting} className="shrink-0">
            {busy ? "Sending…" : "Send"}
          </Button>
        }
      />
      {!waiting && (
        <p className="hidden text-xs text-muted sm:block">Ctrl+Enter (⌘+Enter on a Mac) sends. Enter adds a new line.</p>
      )}
    </form>
  );
}
