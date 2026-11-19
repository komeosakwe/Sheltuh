"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import BuyerEmailField from "@/components/checkout/BuyerEmailField";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { ApiError } from "@/lib/api/client";
import { changeOrderEmail, getOrderBySession } from "@/lib/api/orders";
import type { CustomerOrder, OrderEmailChange, OrderEmailChangeBlock } from "@/lib/api/types";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { buyerEmailError, emailSuggestionOf } from "@/lib/buyer-email";
import { SUPPORT_EMAIL } from "@/lib/contact";

/** Why the email can't be changed here, said before support's address (short; the server's 409 says more). */
const BLOCKED_COPY: Record<OrderEmailChangeBlock, string> = {
  email_already_changed: "You’ve already changed this email once. To change it again, contact",
  event_ended: "This event has ended. To change the email, contact",
  ticket_scanned: "A ticket has been scanned. To change the email, contact",
  order_not_paid: "To change the email, contact",
  changed_by_support: "Support has updated the email for this order. To change it, contact",
};

const BLOCKS = Object.keys(BLOCKED_COPY) as OrderEmailChangeBlock[];

function isBlock(code: unknown): code is OrderEmailChangeBlock {
  return typeof code === "string" && (BLOCKS as string[]).includes(code);
}

function SupportLink() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-foreground underline underline-offset-2 wrap-anywhere">
      {SUPPORT_EMAIL}
    </a>
  );
}

/** An address as the page shows it: bold, and wrapped anywhere only when it has to (a long one on a 320px phone). */
function Address({ email }: { email: string }) {
  return <span className="font-semibold text-foreground wrap-anywhere">{email}</span>;
}

/** What just happened, said in the status region (and in place of the usual lines while it's there). */
type Outcome =
  | { kind: "changed"; email: string | undefined }
  | { kind: "unchanged"; email: string | undefined }
  | { kind: "blocked"; reason: OrderEmailChangeBlock }
  | { kind: "refused" };

function OutcomeText({ outcome }: { outcome: Outcome }) {
  switch (outcome.kind) {
    case "changed":
      return (
        <>
          Email changed. Tickets are on their way to {outcome.email ? <Address email={outcome.email} /> : "the new address"}. To
          change it again, contact <SupportLink />.
        </>
      );
    case "unchanged":
      return (
        <>
          That’s already the email for this order{outcome.email ? <>: <Address email={outcome.email} /></> : null}. Nothing
          changed.
        </>
      );
    case "blocked":
      return (
        <>
          {BLOCKED_COPY[outcome.reason]} <SupportLink />.
        </>
      );
    case "refused":
      return (
        <>
          We couldn’t change it from here. Contact <SupportLink />.
        </>
      );
  }
}

/**
 * Where the confirmation page says the tickets went (docs/architecture.md,
 * "Buyer email checks"):
 * - the paying browser (`access`, its order access token, and the server's
 *   `email`, sent until the event ends): the full address, so a typo can be
 *   spotted, and while `emailChange` allows it, "Wrong email? Change it": an
 *   inline form (checked like checkout's; Enter sends it, Escape cancels it),
 *   then the tickets go to the new address. One change; after it, or when
 *   it's blocked, short words on why and support's address.
 * - anyone else (the ticket email's link, another device): the masked address,
 *   or none once the email has been changed (the server sends neither), and
 *   "Wrong email? Contact" support's address.
 * After a change, or a refusal that closes the form, the outcome is said in a
 * status region (read out once: focus goes to the box, which reads as its
 * short name only); a change's outcome names the address, so it takes the
 * place of the usual line. Once sent, the form can't be cancelled (Cancel and
 * Escape do nothing until the answer: the change may still go through), and
 * an answer about the address applies only while the field still holds what
 * was sent. A refusal that says the order has moved on (a 409: refunded, the
 * one change already used, perhaps by an earlier try whose answer was lost)
 * reads the order again, so the page shows it as it is now.
 * An answer that leaves it unclear whether the change went through (a server
 * error, a lost connection, or a 429 after one) also reads the order: if it
 * now has the address sent, it says the change was made, and offers no
 * second try.
 * `onOrder`: the order as the server has it after a change (or that read).
 * `onUnavailable(message)`: the order isn't paid any more but couldn't be
 * read again: the page stops showing its (void) tickets and says to reload.
 */
export default function OrderEmail({
  sessionId,
  order,
  access,
  onOrder,
  onUnavailable,
}: {
  sessionId: string;
  order: CustomerOrder;
  access: string | undefined;
  onOrder: (order: CustomerOrder) => void;
  onUnavailable?: (message: string) => void;
}) {
  const auth = useOptionalAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [fieldError, setFieldError] = useState<ReactNode>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Said once a change has gone through, found nothing to change, or was refused for good.
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // While a change is being sent (set before the request, so a second Enter or an Escape can't slip in first).
  const pending = useRef(false);
  // The field's latest value, for an answer that arrives after the buyer has typed on.
  const latestDraft = useRef("");
  const openRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Where focus goes after the next render: the field (opened), Change it (cancelled), or the box (done).
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
  const refused = outcome?.kind === "refused";
  const canChange = Boolean(access && order.email && change?.allowed && !refused);
  const blocked = change && !change.allowed ? change.reason : null;

  function open() {
    latestDraft.current = order.email ?? "";
    setDraft(order.email ?? "");
    setFieldError(null);
    setSuggestion(null);
    setFormError(null);
    setOutcome(null);
    setEditing(true);
    focusNext.current = "field";
  }

  function cancel() {
    if (pending.current) return;
    setEditing(false);
    focusNext.current = "open";
  }

  /** The order as the server has it now (the same read as the page's), or null if that can't be had. */
  async function currentOrder(): Promise<CustomerOrder | null> {
    try {
      const result = await getOrderBySession(sessionId, access);
      return result.status === "pending" ? null : result;
    } catch {
      return null;
    }
  }

  async function submit() {
    if (pending.current || !access) return;
    setFormError(null);
    setSuggestion(null);
    const problem = buyerEmailError(draft);
    if (problem) {
      setFieldError(problem);
      inputRef.current?.focus();
      return;
    }
    const sent = draft.trim();
    // Field feedback is about `sent`: kept only while the field still says it.
    const stillSent = () => latestDraft.current.trim() === sent;
    pending.current = true;
    setBusy(true);
    try {
      const result = await changeOrderEmail(
        sessionId,
        sent,
        access,
        auth?.status === "signed-in" ? auth.getAccessToken : undefined,
      );
      onOrder(result.order);
      setEditing(false);
      setOutcome({ kind: result.result, email: result.order.email });
      focusNext.current = "box";
    } catch (err) {
      const code = err instanceof ApiError ? err.body?.code : undefined;
      if (err instanceof ApiError && err.status === 400 && err.fieldErrors?.email) {
        // About the address sent: dropped if the buyer has typed another since (Send checks that one).
        if (stillSent()) {
          setFieldError(err.fieldErrors.email);
          setSuggestion(emailSuggestionOf(err));
          inputRef.current?.focus();
        }
      } else if (err instanceof ApiError && code === "email_has_account") {
        // The server's words ("Contact support@… to use this address."), with the address as a link.
        if (stillSent()) {
          setFieldError(
            <>
              Contact <SupportLink /> to use this address.
            </>,
          );
          inputRef.current?.focus();
        }
      } else if (err instanceof ApiError && err.status === 409 && isBlock(code)) {
        // It can't be changed here after all (refunded, the change already used, the event ended…): the status
        // says why, and the order is read again so the page shows it as it is (a refund's own page; where an
        // earlier try that did go through sent the tickets). Without that read, the order as it was, blocked.
        const blockedChange: OrderEmailChange = { allowed: false, reason: code };
        const now = await currentOrder();
        if (!now && code === "order_not_paid") {
          // Not paid any more (refunded, say), and its details couldn't be read: its tickets aren't shown as valid.
          onUnavailable?.("This order isn’t paid any more, so its tickets aren’t valid. Reload this page to see what happened.");
          return;
        }
        // The refusal itself is the last word on whether it can change (and on keeping the token): the read's is
        // used only when it also says no. Without the read, the order as it was, blocked; after a support change
        // without either address, as the server would send it.
        const before: CustomerOrder = { ...order, emailChange: blockedChange };
        if (code === "changed_by_support") {
          delete before.email;
          delete before.maskedEmail;
        }
        onOrder(now ? { ...now, emailChange: now.emailChange?.allowed === false ? now.emailChange : blockedChange } : before);
        setEditing(false);
        setOutcome({ kind: "blocked", reason: code });
        focusNext.current = "box";
      } else if (err instanceof ApiError && err.status === 404) {
        setEditing(false);
        setOutcome({ kind: "refused" });
        focusNext.current = "box";
      } else {
        // No clear answer (a server error, no connection, or a 429 after a try whose answer was lost): did it go
        // through? A read, never another change.
        const unclear = !(err instanceof ApiError) || err.status >= 500 || err.status === 429;
        const now = unclear ? await currentOrder() : null;
        const landed =
          now?.status === "paid" &&
          !!now.email &&
          now.email.toLowerCase() === sent.toLowerCase() &&
          (order.email ?? "").toLowerCase() !== sent.toLowerCase();
        if (now && landed) {
          onOrder(now);
          setEditing(false);
          setOutcome({ kind: "changed", email: now.email });
          focusNext.current = "box";
          return;
        }
        // A 429 or "being sent right now" says what to do; anything else gets the plain fallback.
        setFormError(err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : "Couldn’t change the email. Try again.");
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  // A change's outcome names the address itself, so it's the one line then; a refusal's doesn't, so the line stays.
  const line = outcome && (outcome.kind === "changed" || outcome.kind === "unchanged") ? null : order.email ? (
    <p className="text-sm text-muted">
      Tickets sent to <Address email={order.email} />.
    </p>
  ) : order.maskedEmail ? (
    <p className="text-sm text-muted wrap-anywhere">Tickets sent to {order.maskedEmail}.</p>
  ) : null;

  return (
    <div
      ref={boxRef}
      tabIndex={-1}
      data-order-email=""
      // Focused by script after a change, so focus isn't lost with the form: a group with a short name, so it isn't
      // read out a second time on top of the status below. Not a control, so no ring.
      role="group"
      aria-label="Ticket email"
      className="flex flex-col items-start gap-1 outline-offset-2 focus:outline-none!"
    >
      {line}
      <p role="status" className="text-sm text-foreground">
        {outcome && <OutcomeText outcome={outcome} />}
      </p>
      {editing ? (
        <form
          className="mt-2 flex w-full max-w-md flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          onKeyDown={(event) => {
            // Escape closes the form (an IME's own Escape, mid-composition, stays the IME's); not once it's sent.
            if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            cancel();
          }}
        >
          <BuyerEmailField
            id="order-email"
            label="New email for your tickets"
            hint="We’ll send your tickets there. You can change it once."
            value={draft}
            onChange={(value) => {
              latestDraft.current = value;
              setDraft(value);
              setFieldError(null);
              setSuggestion(null);
            }}
            error={fieldError}
            suggestion={suggestion}
            inputRef={inputRef}
            submitOnEnter
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
            {/* Not while it's being sent: the change may still go through (and use up the one change). */}
            <Button variant="outline" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : outcome && outcome.kind !== "unchanged" ? null : canChange ? (
        <button
          ref={openRef}
          type="button"
          onClick={open}
          className="inline-flex min-h-11 items-center text-sm text-foreground underline underline-offset-4"
        >
          Wrong email? Change it
        </button>
      ) : blocked ? (
        <p className="text-sm text-muted">
          {BLOCKED_COPY[blocked]} <SupportLink />.
        </p>
      ) : (
        // Another device (or a token that no longer works): support, with the address or without (once it's changed).
        <p className="text-sm text-muted">
          Wrong email? Contact <SupportLink />.
        </p>
      )}
    </div>
  );
}
