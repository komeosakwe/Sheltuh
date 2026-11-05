"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import MessageField from "@/components/messages/MessageField";
import SendHolderMessageDialog from "@/components/dashboard/SendHolderMessageDialog";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { Notice } from "@/components/ui/Section";
import { ApiError, isApiConfigured, type GetToken } from "@/lib/api/client";
import { getHolderMessages, sendHolderMessage } from "@/lib/api/holder-messages";
import type { EventRecord, HolderMessagesState, HolderMessageSummary } from "@/lib/api/types";
import { formatMessageTime } from "@/lib/format";
import {
  allowanceText,
  blockedText,
  cleanedHolderText,
  sendBlockCode,
  ticketHolderCount,
  validateHolderField,
} from "@/lib/holder-message-rules";
import { messageLength } from "@/lib/message-text";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; state: HolderMessagesState };

/** The words for a request that failed: the API's own for a refusal, ours for anything else. */
function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * "Message ticket holders" on a published event's page: one short plain-text
 * email about the event to everyone holding a ticket. Sheltüh sends it, so
 * this tool never shows the organiser an address (buyers' names and emails are
 * in the Orders tab, for 12 months after the event). Live mode only, and not
 * for an event whose tickets are sold elsewhere (there are no holders).
 * Docs/architecture.md, "Messages to ticket holders".
 */
export default function MessageHoldersPanel({ event, getToken }: { event: EventRecord; getToken: GetToken }) {
  if (!isApiConfigured || event.ticketingMode === "external") return null;
  return <Panel eventId={event.eventId} getToken={getToken} />;
}

function Panel({ eventId, getToken }: { eventId: string; getToken: GetToken }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<{ subject?: string; body?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [dialogProblem, setDialogProblem] = useState<string | null>(null);
  const [attestProblem, setAttestProblem] = useState<string | null>(null);
  const [dialogNotice, setDialogNotice] = useState<string | null>(null);
  const [askAgain, setAskAgain] = useState(0);
  const [sentText, setSentText] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  // The block note is read out (as an alert) only when a send has just run into it.
  const [announceBlock, setAnnounceBlock] = useState(false);

  // One id per compose, kept across a retry of the same text and renewed after a send (or an edit
  // after a try): the API treats the same id as the same message.
  const requestId = useRef<string | null>(null);
  const tried = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const focusHeading = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getHolderMessages(eventId, getToken).then(
      (state) => {
        if (!cancelled) setLoad({ status: "ready", state });
      },
      (err: unknown) => {
        if (!cancelled) setLoad({ status: "error", message: errorText(err, "Couldn’t load this.") });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, getToken, attempt]);

  // After a send that leaves nothing to type into, focus would be lost with the form.
  useEffect(() => {
    if (!focusHeading.current || confirming) return;
    focusHeading.current = false;
    headingRef.current?.focus();
  });

  /** The latest state, kept on screen while it refreshes. Null if it couldn't be read. */
  async function refresh(): Promise<HolderMessagesState | null> {
    try {
      const state = await getHolderMessages(eventId, getToken);
      setLoad({ status: "ready", state });
      return state;
    } catch {
      return null;
    }
  }

  function edited() {
    setSentText("");
    setFailure(null);
    setAnnounceBlock(false);
    if (tried.current) {
      requestId.current = null;
      tried.current = false;
    }
  }

  if (load.status === "ready" && !load.state.canSend && load.state.blockedReason === "external") return null;

  const state = load.status === "ready" ? load.state : null;
  const limits = state?.limits;

  function review(e: FormEvent) {
    e.preventDefault();
    if (!limits) return;
    const next = {
      subject: validateHolderField("subject", subject, limits) ?? undefined,
      body: validateHolderField("body", body, limits) ?? undefined,
    };
    setErrors(next);
    if (next.subject) subjectRef.current?.focus();
    else if (next.body) bodyRef.current?.focus();
    else {
      setDialogProblem(null);
      setAttestProblem(null);
      setDialogNotice(null);
      setConfirming(true);
    }
  }

  async function send() {
    if (!state || sending) return;
    const cleanSubject = cleanedHolderText(subject);
    const cleanBody = cleanedHolderText(body);
    requestId.current ??= crypto.randomUUID();
    tried.current = true;
    setSending(true);
    setDialogProblem(null);
    setAttestProblem(null);
    try {
      const sent = await sendHolderMessage(
        eventId,
        {
          requestId: requestId.current,
          subject: cleanSubject,
          body: cleanBody,
          attest: true,
          expectedRecipients: state.audienceCount,
        },
        getToken,
      );
      setSubject("");
      setBody("");
      setErrors({});
      requestId.current = null;
      tried.current = false;
      setConfirming(false);
      setSentText(`Sent to ${sent.recipientCount}.`);
      const next = await refresh();
      if (!next || !next.canSend) focusHeading.current = true;
    } catch (err) {
      await failed(err);
    } finally {
      setSending(false);
    }
  }

  async function failed(err: unknown) {
    if (!(err instanceof ApiError)) {
      setDialogProblem("Couldn’t send. Try again.");
      return;
    }
    const code = err.body?.code;
    if (err.status === 409 && code === "audience_changed") {
      const now = numberFrom(err.body?.audienceCount);
      if (now !== null) {
        setLoad((current) =>
          current.status === "ready" ? { status: "ready", state: { ...current.state, audienceCount: now } } : current,
        );
        setDialogNotice(`It’s now ${ticketHolderCount(now)}. Check, then send again.`);
      } else {
        setDialogNotice("The number of ticket holders changed. Check, then send again.");
      }
      setAskAgain((n) => n + 1);
      return;
    }
    const blocked = sendBlockCode(code);
    if ((err.status === 409 || err.status === 429) && blocked) {
      setConfirming(false);
      const next = await refresh();
      if (next?.canSend) setFailure(err.message);
      else {
        setAnnounceBlock(true);
        focusHeading.current = true;
      }
      return;
    }
    if (err.status === 400 && err.fieldErrors) {
      const { subject: subjectError, body: bodyError, attest, requestId: idError, expectedRecipients } = err.fieldErrors;
      if (subjectError || bodyError) {
        setErrors({ subject: subjectError, body: bodyError });
        setConfirming(false);
        if (subjectError) subjectRef.current?.focus();
        else bodyRef.current?.focus();
        return;
      }
      if (idError) {
        requestId.current = null;
        tried.current = false;
      }
      if (attest) setAttestProblem(attest);
      else setDialogProblem(idError ?? expectedRecipients ?? err.message);
      return;
    }
    setDialogProblem(errorText(err, "Couldn’t send. Try again."));
  }

  return (
    <section aria-labelledby="message-holders-title" className="rounded-card border border-foreground bg-card p-4 sm:p-5">
      <h2 id="message-holders-title" ref={headingRef} tabIndex={-1} className="font-heading text-xl outline-offset-2">
        Message ticket holders
      </h2>

      {load.status === "loading" && <LoadingState text="Loading…" className="mt-3" />}

      {load.status === "error" && (
        <div className="mt-3 flex flex-col items-start gap-3">
          <Notice tone="danger" role="alert">
            {load.message}
          </Notice>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => {
              setLoad({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {state && limits && (
        <>
          <p className="mt-1 text-sm text-muted">
            {ticketHolderCount(state.audienceCount)}
            {state.canSend && <> · {allowanceText(state.remaining)}</>}
          </p>

          {state.blockedReason && (
            <div className="mt-3">
              <Notice role={announceBlock ? "alert" : undefined}>{blockedText(state.blockedReason)}</Notice>
            </div>
          )}

          {failure && (
            <div className="mt-3">
              <Notice tone="danger" role="alert">
                {failure}
              </Notice>
            </div>
          )}

          {state.canSend && (
            <form onSubmit={review} noValidate className="mt-4 flex flex-col gap-4">
              <SubjectField
                value={subject}
                error={errors.subject}
                max={limits.subjectMax}
                inputRef={subjectRef}
                onChange={(value) => {
                  setSubject(value);
                  setErrors((e) => ({ ...e, subject: undefined }));
                  edited();
                }}
              />
              <MessageField
                id="holder-message-body"
                label="Message"
                value={body}
                onChange={(value) => {
                  setBody(value);
                  setErrors((e) => ({ ...e, body: undefined }));
                  edited();
                }}
                error={errors.body}
                rows={5}
                max={limits.bodyMax}
                inputRef={bodyRef}
              />
              <div>
                <Button type="submit" size="lg" className="w-full sm:w-auto">
                  Send…
                </Button>
              </div>
            </form>
          )}

          <p role="status" className="mt-3 text-sm font-semibold empty:hidden">
            {sentText}
          </p>

          <History messages={state.messages} />

          <SendHolderMessageDialog
            open={confirming}
            count={state.audienceCount}
            subject={cleanedHolderText(subject)}
            body={cleanedHolderText(body)}
            busy={sending}
            problem={dialogProblem}
            fieldProblem={attestProblem}
            notice={dialogNotice}
            askAgain={askAgain}
            onSend={send}
            onClose={() => setConfirming(false)}
          />
        </>
      )}
    </section>
  );
}

/** A one-line field with the same counter, description and error wiring as MessageField. */
function SubjectField({
  value,
  error,
  max,
  inputRef,
  onChange,
}: {
  value: string;
  error: string | undefined;
  max: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
}) {
  const id = "holder-message-subject";
  const length = messageLength(value);
  const over = length > max;
  const nearLimit = length >= max * 0.9;
  const describedBy = [error ? `${id}-error` : null, nearLimit ? `${id}-count` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="eyebrow text-muted">
          Subject
        </label>
        <p id={`${id}-count`} className={`ml-auto shrink-0 text-xs tabular-nums ${over ? "text-danger" : "text-muted"}`}>
          <span aria-hidden="true">
            {length}/{max}
          </span>
          {nearLimit && (
            <span className="sr-only">
              {length} of {max} characters
            </span>
          )}
        </p>
      </div>
      <input
        ref={inputRef}
        id={id}
        name={id}
        type="text"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`${fieldClass} min-h-12 sm:min-h-11`}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function History({ messages }: { messages: HolderMessageSummary[] }) {
  return (
    <div className="mt-5 border-t border-foreground/15 pt-4">
      <h3 className="eyebrow text-muted">Sent messages</h3>
      {messages.length === 0 ? (
        <p className="mt-2 text-sm text-muted">None yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-foreground/15">
          {messages.map((message) => (
            <li key={message.messageId} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
              <p className="font-semibold break-words">{message.subject}</p>
              <p className="text-sm text-muted">
                <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                {" · "}Sent {message.sentCount} of {message.recipientCount}
                {message.cancelled && <> · Stopped</>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
