"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import type { GetToken } from "@/lib/api/client";
import { startConversation } from "@/lib/api/messages";
import type { ConversationSummary, GoingAttendee } from "@/lib/api/types";
import { validateMessage } from "@/lib/message-text";
import MessageField from "./MessageField";
import { inlineLinkClass, messagingError, tallInlineLinkClass, threadHref, UNAVAILABLE_PERSON } from "./shared";

const REQUEST_RATE_LIMITED = "You’ve sent a lot of message requests today. Try again tomorrow.";

type Failure = { kind: "message"; message: string } | { kind: "exists" };

/**
 * One row's "Message" action on a Who's Going list: a button that opens a
 * first-message form under the name, and once sent, a link to the
 * conversation. `open`/`onOpenChange` come from the list, so only one form
 * is open at a time.
 */
export function AttendeeMessageAction({
  attendee,
  getToken,
  returnTo,
  open,
  onOpenChange,
}: {
  attendee: GoingAttendee;
  getToken: GetToken;
  returnTo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sent, setSent] = useState<ConversationSummary | null>(null);
  const sentRef = useRef<HTMLParagraphElement>(null);
  const pendingFocus = useRef<"button" | "sent" | null>(null);
  const formId = `wg-message-${attendee.attendeeId}`;
  const buttonId = `${formId}-open`;

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const element = target === "button" ? document.getElementById(buttonId) : sentRef.current;
    if (element) element.focus();
    else pendingFocus.current = target; // Not rendered yet: try after the next render.
  });

  if (sent) {
    return (
      <p ref={sentRef} tabIndex={-1} className="basis-full pl-10 text-sm leading-5 outline-offset-2">
        Request sent to {attendee.displayName}.{" "}
        <Link href={threadHref(sent.conversationId)} className={tallInlineLinkClass}>
          View conversation
        </Link>
      </p>
    );
  }

  return (
    <>
      <Button
        id={buttonId}
        variant="outline"
        size="sm"
        className="min-h-11 shrink-0"
        aria-label={`Message ${attendee.displayName}`}
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
        onClick={() => onOpenChange(!open)}
      >
        Message
      </Button>
      {open && (
        <div className="basis-full pt-2 pb-3">
          <ComposeRequestForm
            id={formId}
            attendee={attendee}
            getToken={getToken}
            returnTo={returnTo}
            onCancel={() => {
              pendingFocus.current = "button";
              onOpenChange(false);
            }}
            onSent={(conversation) => {
              setSent(conversation);
              pendingFocus.current = "sent";
              onOpenChange(false);
            }}
          />
        </div>
      )}
    </>
  );
}

/**
 * A first message to someone on the list. It says what happens: they're
 * asked, replying accepts, and there's no follow-up until they do. No links
 * in a first message (the API refuses them; its field error is shown).
 */
export function ComposeRequestForm({
  id,
  attendee,
  getToken,
  returnTo,
  onCancel,
  onSent,
}: {
  id: string;
  attendee: GoingAttendee;
  getToken: GetToken;
  returnTo: string;
  onCancel: () => void;
  onSent: (conversation: ConversationSummary) => void;
}) {
  const name = attendee.displayName;
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"input" | "failure" | null>(null);
  const aboutId = `${id}-about`;

  // Opening the form (a user action) moves focus into it.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = (target === "input" ? inputRef : failureRef).current;
    if (!element) return; // Not rendered yet: an earlier render's effects can run first.
    pendingFocus.current = null;
    element.focus();
  });

  async function send() {
    if (busy) return;
    setFailure(null);
    const invalid = validateMessage(text);
    setFieldError(invalid);
    if (invalid) {
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const conversation = await startConversation({ attendeeId: attendee.attendeeId, body: text.trim() }, getToken);
      onSent(conversation);
      return;
    } catch (err) {
      const mapped = messagingError(err, { rateLimited: REQUEST_RATE_LIMITED });
      if (mapped.kind === "field") {
        setFieldError(mapped.message);
        pendingFocus.current = "input";
      } else {
        setFailure(
          mapped.kind === "conflict"
            ? { kind: "exists" }
            : { kind: "message", message: mapped.kind === "unavailable" ? UNAVAILABLE_PERSON : mapped.message },
        );
        pendingFocus.current = "failure";
      }
    }
    setBusy(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  return (
    <form id={id} noValidate aria-labelledby={`${id}-title`} aria-busy={busy} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p id={`${id}-title`} className="text-sm font-semibold break-words">
        Message {name}
      </p>
      <p id={aboutId} className="text-sm leading-5">
        This sends {name} a message request with your display name and this event. If they reply, you can keep
        chatting. Until then you can&rsquo;t send another, and they might not reply. No links in a first message.
      </p>
      <MessageField
        id={`${id}-text`}
        label="Your message"
        value={text}
        onChange={(value) => {
          setText(value);
          if (fieldError) setFieldError(null);
        }}
        error={fieldError}
        describedBy={aboutId}
        rows={3}
        inputRef={inputRef}
        onSubmitShortcut={() => void send()}
      />
      {failure && (
        <div ref={failureRef} tabIndex={-1} className="outline-offset-2">
          {failure.kind === "exists" ? (
            <Notice tone="danger" role="alert">
              You already have a conversation with {name}.{" "}
              <Link href="/messages" className={inlineLinkClass}>
                Go to your messages
              </Link>
            </Notice>
          ) : (
            <ActionErrorNotice message={failure.message} returnTo={returnTo} />
          )}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" variant="solid" size="lg" busy={busy} aria-describedby={aboutId} className="w-full sm:w-auto">
          {busy ? "Sending…" : "Send request"}
        </Button>
        <Button variant="outline" size="lg" busy={busy} onClick={onCancel} className="w-full sm:w-auto">
          Cancel
        </Button>
      </div>
    </form>
  );
}
