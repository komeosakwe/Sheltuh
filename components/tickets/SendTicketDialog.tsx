"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import { ApiError } from "@/lib/api/client";
import type { TicketTransferErrorCode } from "@/lib/api/types";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { suggestEmail } from "@/lib/email-typos";
import { PERSON_NAME_MAX_LENGTH } from "@/lib/person-name";
import { TICKET_TRANSFER_RULES } from "@/lib/ticket-transfer-rules";

/** What the buyer types to send a ticket (TicketTransferInput less the ticket's number). */
export interface SendTicketFields {
  name: string;
  email: string;
  senderName: string;
}

/** A light check before sending: something@something.tld with no spaces. The server checks it properly. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What each refusal of a send says, in the form (the field errors are said at their fields). */
export const SEND_ERROR_MESSAGES: Partial<Record<TicketTransferErrorCode, string>> = {
  transfer_pending: "This ticket is already waiting for someone to accept it.",
  ticket_already_sent: "This ticket has already been sent.",
  ticket_checked_in: "This ticket has been checked in, so it can’t be sent.",
  transfers_closed: `Tickets can be sent until ${TICKET_TRANSFER_RULES.cutoffBeforeStart} before the event starts.`,
  event_unlisted: "This event is no longer listed.",
  ticket_type_not_transferable: "This ticket can’t be sent.",
  order_not_paid: "This order isn’t paid, so its tickets can’t be sent.",
  transfer_attempts_used: `This ticket has been offered too many times. Contact ${SUPPORT_EMAIL}.`,
  transfer_pending_cap: "You have too many tickets waiting to be accepted.",
  rate_limited: "You’ve sent a lot of tickets. Try again later.",
};

type FieldErrors = Partial<Record<keyof SendTicketFields, string>>;

function errorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const code = err.body?.code;
  return typeof code === "string" ? code : null;
}

interface SendTicketDialogProps {
  open: boolean;
  onClose: () => void;
  /** Which ticket, for an order of several: "Ticket 2 of 3 · Section A, row C, seat 12". Under the body. */
  ticketLabel?: string;
  /** The sender's name to start with: the signed-in member's display name, when there is one. */
  defaultSenderName?: string;
  /** Sends it. Resolves once it's sent (the page then closes this and says so); rejects with the API's error. */
  onSend: (fields: SendTicketFields) => Promise<void>;
  /**
   * Signs in to send (the API said this browser doesn't control the order: 403 `order_owner_only`). The form
   * says so with the API's words ("Sign in with the email you bought with (m***@example.com)…") and a Sign in
   * button calling this.
   */
  onSignIn: () => void;
}

/**
 * "Send this ticket" (Latte's 1120 frames: the 480 dialog from 768, the
 * bottom sheet below, both from ui/Sheet): their name, their email, and the
 * sender's own name (shown to the friend: "From Alex Chen"; not drawn, the
 * API needs it and nothing else on the order has it), then Send ticket.
 *
 * Focus starts on "Their name". Fields are checked before sending (the
 * first wrong one takes focus, with its message as an alert); the server's
 * own field messages are shown the same way, a mistyped domain gets "Did you
 * mean …?" with Use this, and anything else it refuses is said above the
 * button. Escape, the ✕ (or Cancel on phones) and the scrim close it; focus
 * goes back to what opened it.
 */
export default function SendTicketDialog({ open, onClose, ticketLabel, defaultSenderName = "", onSend, onSignIn }: SendTicketDialogProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Send this ticket"
      subtitle={
        <>
          Your friend gets their own QR code. This one stops working once they accept.
          {ticketLabel && (
            <span data-send-ticket-label="" className="mt-1 block font-semibold text-foreground">
              {ticketLabel}
            </span>
          )}
        </>
      }
      dismissLabel="Cancel"
    >
      <SendTicketForm defaultSenderName={defaultSenderName} onSend={onSend} onSignIn={onSignIn} />
    </Sheet>
  );
}

function SendTicketForm({
  defaultSenderName,
  onSend,
  onSignIn,
}: Pick<SendTicketDialogProps, "defaultSenderName" | "onSend" | "onSignIn">) {
  const id = useId();
  const [fields, setFields] = useState<SendTicketFields>({ name: "", email: "", senderName: defaultSenderName ?? "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<{ message: string; signIn?: boolean } | null>(null);
  /** The server's corrected address for the one typed (400 `email_typo` / `email_no_mail`). */
  const [serverSuggestion, setServerSuggestion] = useState<{ for: string; to: string } | null>(null);
  /** The address the typo hint is for: worked out when the field is left, never on every keystroke. */
  const [checkedEmail, setCheckedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const senderRef = useRef<HTMLInputElement>(null);
  const refs = { name: nameRef, email: emailRef, senderName: senderRef };

  // Focus starts on the first field. The sheet shows itself in its own effect, which runs after this one (it's
  // the parent), and a field in a dialog that isn't shown yet can't take focus: so a frame later. This form is
  // mounted afresh each time the sheet opens, so it's once per opening.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      // Unless a field already has it (someone quick, or a test).
      const field = nameRef.current;
      if (field && !field.form?.contains(document.activeElement)) field.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const typedEmail = fields.email.trim();
  const suggestion =
    serverSuggestion && serverSuggestion.for === fields.email
      ? serverSuggestion.to
      : checkedEmail !== null && checkedEmail === fields.email
        ? suggestEmail(typedEmail)
        : null;
  const shownSuggestion = suggestion && suggestion.toLowerCase() !== typedEmail.toLowerCase() ? suggestion : null;

  function set(key: keyof SendTicketFields, value: string) {
    setFields((was) => ({ ...was, [key]: value }));
    if (errors[key]) setErrors((was) => ({ ...was, [key]: undefined }));
    setFormError(null);
  }

  function showErrors(next: FieldErrors) {
    setErrors(next);
    const first = (["name", "email", "senderName"] as const).find((key) => next[key]);
    if (first) refs[first].current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const input: SendTicketFields = { name: fields.name.trim(), email: typedEmail, senderName: fields.senderName.trim() };
    const found: FieldErrors = {};
    if (!input.name) found.name = "Enter their name";
    if (!LOOKS_LIKE_EMAIL.test(input.email)) found.email = "Enter a valid email";
    if (!input.senderName) found.senderName = "Enter your name";
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await onSend(input);
    } catch (err) {
      setBusy(false);
      const code = errorCode(err);
      if (err instanceof ApiError && err.status === 403 && code === "order_owner_only") {
        setFormError({ message: err.message, signIn: true });
        return;
      }
      if (err instanceof ApiError && (err.fieldErrors || code === "own_email")) {
        const next: FieldErrors = {};
        for (const key of ["name", "email", "senderName"] as const) {
          const message = err.fieldErrors?.[key];
          if (message) next[key] = message;
        }
        if (code === "own_email") next.email = "That’s your own email";
        const to = err.body?.suggestion;
        if ((code === "email_typo" || code === "email_no_mail") && typeof to === "string") setServerSuggestion({ for: fields.email, to });
        if (Object.keys(next).length > 0) {
          showErrors(next);
          return;
        }
      }
      const known = code ? SEND_ERROR_MESSAGES[code as TicketTransferErrorCode] : undefined;
      setFormError({ message: known ?? (err instanceof ApiError && err.status < 500 ? err.message : "Couldn’t send the ticket. Try again.") });
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        id={`${id}-name`}
        label="Their name"
        value={fields.name}
        onChange={(value) => set("name", value)}
        error={errors.name}
        inputRef={nameRef}
        placeholder="e.g. Sam Lee"
        autoComplete="off"
      />
      <TextField
        id={`${id}-email`}
        label="Their email"
        value={fields.email}
        onChange={(value) => {
          set("email", value);
          setCheckedEmail(null);
        }}
        onBlur={() => setCheckedEmail(fields.email)}
        error={errors.email}
        inputRef={emailRef}
        placeholder="sam@email.com"
        type="email"
        autoComplete="off"
        after={
          // Always there, so a suggestion put in it is read out.
          <div aria-live="polite" className="flex flex-wrap items-center gap-x-2 empty:hidden">
            {shownSuggestion && (
              <>
                <p id={`${id}-suggestion`} className="body-s min-w-0 text-foreground">
                  Did you mean <span className="font-semibold wrap-anywhere">{shownSuggestion}</span>?
                </p>
                <button
                  type="button"
                  aria-describedby={`${id}-suggestion`}
                  onClick={() => {
                    set("email", shownSuggestion);
                    setCheckedEmail(shownSuggestion);
                    refs.email.current?.focus();
                  }}
                  className="body-s inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4"
                >
                  Use this
                </button>
              </>
            )}
          </div>
        }
      />
      <TextField
        id={`${id}-sender`}
        label="Your name"
        hint="Shown to them so they know it’s from you."
        value={fields.senderName}
        onChange={(value) => set("senderName", value)}
        error={errors.senderName}
        inputRef={senderRef}
        placeholder="e.g. Alex Chen"
        autoComplete="name"
      />
      {formError && (
        <div role="alert" className="flex flex-wrap items-center gap-x-2">
          <p className="body-s text-danger">{formError.message}</p>
          {formError.signIn && (
            <button
              type="button"
              onClick={onSignIn}
              className="body-s inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4"
            >
              Sign in
            </button>
          )}
        </div>
      )}
      <Button type="submit" variant="signal" busy={busy} className="w-full">
        {busy ? "Sending…" : "Send ticket"}
      </Button>
      {/* Someone else's name and email are collected here, and the page's footer is behind the modal: the policy
          is one link away. The wording is a placeholder for the owner's (owner question 33). */}
      <p className="body-s text-muted">
        How we use their details:{" "}
        <Link href="/privacy" className="text-foreground underline underline-offset-4 hover:decoration-2">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}

/** Latte's UI / Text field: the label in Body/S Strong, a 1px black edge, radius 8, 16 × 12, Body/M. */
function TextField({
  id,
  label,
  hint,
  value,
  onChange,
  onBlur,
  error,
  inputRef,
  placeholder,
  type = "text",
  autoComplete,
  after,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  inputRef: RefObject<HTMLInputElement | null>;
  placeholder: string;
  type?: "text" | "email";
  autoComplete: string;
  after?: ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="body-s font-semibold text-foreground">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        maxLength={type === "email" ? 254 : PERSON_NAME_MAX_LENGTH}
        required
        {...(type === "email" ? { inputMode: "email" as const, spellCheck: false, autoCapitalize: "none" } : {})}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="body-m min-h-12 w-full rounded-control border border-foreground bg-card px-4 py-3 text-foreground placeholder:text-disabled aria-invalid:border-danger"
      />
      {hint && (
        <p id={hintId} className="body-s text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="body-s text-danger">
          {error}
        </p>
      )}
      {after}
    </div>
  );
}
