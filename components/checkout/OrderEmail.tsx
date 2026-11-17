"use client";

import { useEffect, useRef, useState } from "react";
import BuyerEmailField from "@/components/checkout/BuyerEmailField";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { ApiError } from "@/lib/api/client";
import { changeOrderEmail } from "@/lib/api/orders";
import type { CustomerOrder, OrderEmailChangeBlock } from "@/lib/api/types";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { buyerEmailError, emailSuggestionOf } from "@/lib/buyer-email";
import { SUPPORT_EMAIL } from "@/lib/contact";

/** Why the email can't be changed here, said before "contact support" (short; the server's 409 says more). */
const BLOCKED_COPY: Record<OrderEmailChangeBlock, string> = {
  email_already_changed: "You’ve already changed this email once. To change it again, contact",
  event_ended: "This event has ended. To change the email, contact",
  ticket_scanned: "A ticket has been scanned. To change the email, contact",
  order_not_paid: "To change the email, contact",
  changed_by_support: "To change this email again, contact",
};

const BLOCKS = Object.keys(BLOCKED_COPY) as OrderEmailChangeBlock[];

function isBlock(code: unknown): code is OrderEmailChangeBlock {
  return typeof code === "string" && (BLOCKS as string[]).includes(code);
}

function SupportLink() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-foreground underline underline-offset-2 break-all">
      {SUPPORT_EMAIL}
    </a>
  );
}

/**
 * Where the confirmation page says the tickets went (docs/architecture.md,
 * "Buyer email checks"):
 * - the paying browser (`access`, its order access token, and the server's
 *   `email`): the full address, so a typo can be spotted, and while
 *   `emailChange` allows it, "Wrong email? Change it": an inline field
 *   (checked like checkout's), then the tickets go to the new address. One
 *   change; after it, or when it's blocked, short words on why and support's
 *   address.
 * - anyone else (the ticket email's link, another device): the masked address
 *   with "Wrong email?" and support's address; nothing once the email has
 *   been changed (the server sends neither).
 * `onOrder`: the order as the server has it after a change.
 */
export default function OrderEmail({
  sessionId,
  order,
  access,
  onOrder,
}: {
  sessionId: string;
  order: CustomerOrder;
  access: string | undefined;
  onOrder: (order: CustomerOrder) => void;
}) {
  const auth = useOptionalAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Said once a change has gone through (or found nothing to change), in the region below.
  const [outcome, setOutcome] = useState("");
  // The token wasn't accepted (another order's, or it's gone stale): only support can help now.
  const [refused, setRefused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Where focus goes after the next render: the field (opened), Change it (cancelled), or the line (done).
  const focusNext = useRef<"field" | "open" | "box" | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target === "field") inputRef.current?.focus();
    else if (target === "open") openRef.current?.focus();
    else boxRef.current?.focus();
  });

  const change = order.emailChange;
  const canChange = Boolean(access && order.email && change?.allowed && !refused);
  const blocked = change && !change.allowed ? change.reason : null;

  function open() {
    setDraft(order.email ?? "");
    setFieldError(null);
    setSuggestion(null);
    setFormError(null);
    setOutcome("");
    setEditing(true);
    focusNext.current = "field";
  }

  function cancel() {
    setEditing(false);
    focusNext.current = "open";
  }

  async function submit() {
    if (busy || !access) return;
    setFormError(null);
    setSuggestion(null);
    const problem = buyerEmailError(draft);
    if (problem) {
      setFieldError(problem);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const result = await changeOrderEmail(
        sessionId,
        draft.trim(),
        access,
        auth?.status === "signed-in" ? auth.getAccessToken : undefined,
      );
      onOrder(result.order);
      setEditing(false);
      setOutcome(
        result.result === "changed"
          ? `Email changed. Your tickets are on their way to ${result.order.email ?? "the new address"}.`
          : "That’s already the email for this order.",
      );
      focusNext.current = "box";
    } catch (err) {
      const code = err instanceof ApiError ? err.body?.code : undefined;
      if (err instanceof ApiError && err.status === 400 && err.fieldErrors?.email) {
        setFieldError(err.fieldErrors.email);
        setSuggestion(emailSuggestionOf(err));
        inputRef.current?.focus();
      } else if (err instanceof ApiError && code === "email_has_account") {
        setFieldError(err.message);
        inputRef.current?.focus();
      } else if (err instanceof ApiError && err.status === 409 && isBlock(code)) {
        // It can't be changed here after all (the event ended, a ticket was scanned…): the line says why.
        onOrder({ ...order, emailChange: { allowed: false, reason: code } });
        setEditing(false);
        focusNext.current = "box";
      } else if (err instanceof ApiError && err.status === 404) {
        setRefused(true);
        setEditing(false);
        focusNext.current = "box";
      } else {
        // A 429 or "being sent right now" says what to do; anything else gets the plain fallback.
        setFormError(err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : "Couldn’t change the email. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const line = order.email ? (
    <p className="text-sm text-muted">
      Tickets sent to <span className="font-semibold break-all text-foreground">{order.email}</span>.
    </p>
  ) : order.maskedEmail ? (
    <p className="text-sm text-muted">Tickets sent to {order.maskedEmail}.</p>
  ) : null;

  // Nothing to say (another device, once the email has changed), and nothing to do.
  if (!line && !blocked && !outcome) return null;

  return (
    <div
      ref={boxRef}
      tabIndex={-1}
      data-order-email=""
      // Focused by script after a change, to read what happened; not a control, so no ring.
      className="flex flex-col items-start gap-1 outline-offset-2 focus:outline-none!"
    >
      {line}
      <p role="status" className="text-sm text-foreground">
        {outcome}
      </p>
      {editing ? (
        <form
          className="mt-2 flex w-full max-w-md flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <BuyerEmailField
            id="order-email"
            label="New email for your tickets"
            hint="We’ll send your tickets there. You can change it once."
            value={draft}
            onChange={(value) => {
              setDraft(value);
              setFieldError(null);
              setSuggestion(null);
            }}
            error={fieldError}
            suggestion={suggestion}
            inputRef={inputRef}
          />
          {formError && (
            <Notice tone="danger" role="alert">
              {formError}
            </Notice>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="solid" busy={busy}>
              {busy ? "Sending…" : "Send tickets here"}
            </Button>
            <Button variant="outline" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : canChange ? (
        <button
          ref={openRef}
          type="button"
          onClick={open}
          className="inline-flex min-h-11 items-center text-sm text-foreground underline underline-offset-4"
        >
          Wrong email? Change it
        </button>
      ) : refused ? (
        <p role="alert" className="text-sm text-foreground">
          We couldn’t change it from here. Contact <SupportLink />.
        </p>
      ) : blocked ? (
        <p className="text-sm text-muted">
          {BLOCKED_COPY[blocked]} <SupportLink />.
        </p>
      ) : (
        line && (
          <p className="text-sm text-muted">
            Wrong email? Contact <SupportLink />.
          </p>
        )
      )}
    </div>
  );
}
