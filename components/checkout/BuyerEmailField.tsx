"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { UsersIcon } from "@/components/checkout/icons";
import { DETAILS_NOTICE } from "@/lib/buyer-details";
import { suggestEmail } from "@/lib/email-typos";
import { dismissKeyboardOnEnter } from "@/lib/use-soft-keyboard";

/** The field's hint for a guest: where the tickets go. */
export const BUYER_EMAIL_GUEST_HINT = "Tickets are sent here.";

/** The field's hint when signed in (the account's address filled in): where the tickets go, and why that address matters. */
export const BUYER_EMAIL_HINT = "Tickets are sent here. Use your account email to join Who’s Going.";

/** How long typing has to pause before the "Did you mean …?" is worked out. */
export const EMAIL_HINT_DELAY_MS = 500;

/** Typed far enough to judge the domain: something after the "@" with a dot in it. */
const DOMAIN_WITH_DOT = /@[^@\s]*\.[^@\s]*$/;

/**
 * "Email for your tickets": every checkout (paid and free, general admission
 * and seated) and the confirmation page's change of it. The server checks the
 * address (docs/architecture.md, "Buyer email checks"); this field only helps
 * get it right first time:
 * - a domain that looks mistyped (lib/email-typos.ts suggestEmail) gets a
 *   "Did you mean …?" with Use this, worked out once typing pauses
 *   (EMAIL_HINT_DELAY_MS) with a dot after the "@". It's there before the
 *   buyer reaches the button below, so nothing moves under a click, and Tab
 *   from the field goes to Use this (Tab, and Enter, work it out at once). A
 *   click elsewhere drops a pending hint rather than show it mid-click. It
 *   never blocks: they can check out with what they typed.
 * - `suggestion`: the server's corrected address (a 400 `email_typo` /
 *   `email_no_mail`), shown straight away, until the address changes.
 * The suggestion is in a polite live region, so it's read out when it
 * appears; Use this puts it in the field and focus back on the field. Errors
 * are `role="alert"` and describe the field.
 *
 * `look`: `panel` is the event page's ticket panel (its 12px radius, mid-grey
 * edge); `plain` the seat page's and the confirmation page's default field.
 * `onSignOut`: signed in, with the account's address filled in: "Not you?
 * Sign out" (this browser only), so someone else's account isn't booked
 * with; the hint then says the account's address joins Who's Going.
 * `detailsNotice`: the checkout's "Your name and email are shared with the
 * organiser" under the field (the name field above leaves it out then).
 * `submitOnEnter`: the field is in a form whose submit Enter should press
 * (the keyboard's key says "Send"); otherwise Enter only closes a phone's
 * keyboard ("Done").
 */
export default function BuyerEmailField({
  id,
  value,
  onChange,
  error,
  suggestion = null,
  inputRef,
  look = "plain",
  label = "Email for your tickets",
  hint,
  onSignOut,
  detailsNotice = false,
  submitOnEnter = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** What's wrong, said as an alert (text, or text with a link). */
  error: ReactNode;
  /** The server's corrected address, if it sent one; the parent clears it when the address changes. */
  suggestion?: string | null;
  /** The input, for the parent's focus moves (and Use this's). */
  inputRef: RefObject<HTMLInputElement | null>;
  look?: "panel" | "plain";
  label?: string;
  /** Under the field; by default BUYER_EMAIL_HINT signed in, BUYER_EMAIL_GUEST_HINT otherwise. Null: none. */
  hint?: string | null;
  onSignOut?: () => void;
  detailsNotice?: boolean;
  submitOnEnter?: boolean;
}) {
  // The address the typo hint is for: set once typing pauses (or on Tab / Enter), never on every keystroke.
  const [settled, setSettled] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typed = value.trim();
  const hinted = settled !== null && settled === value ? suggestEmail(typed) : null;
  const offer = suggestion ?? hinted;
  const shown = offer && offer.toLowerCase() !== typed.toLowerCase() ? offer : null;
  const hintText = hint === undefined ? (onSignOut ? BUYER_EMAIL_HINT : BUYER_EMAIL_GUEST_HINT) : hint;

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const suggestionId = `${id}-suggestion`;
  const noticeId = `${id}-notice`;
  const describedBy = [
    hintText ? hintId : null,
    error ? errorId : null,
    shown ? suggestionId : null,
    detailsNotice ? noticeId : null,
  ]
    .filter(Boolean)
    .join(" ");

  function cancelPending() {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }

  useEffect(() => cancelPending, []);

  function settleSoon(next: string) {
    cancelPending();
    if (!DOMAIN_WITH_DOT.test(next)) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setSettled(next);
    }, EMAIL_HINT_DELAY_MS);
  }

  /** Works the hint out now (leaving by Tab, or Enter): it's in place before focus moves on. */
  function settleNow() {
    cancelPending();
    if (DOMAIN_WITH_DOT.test(value)) setSettled(value);
  }

  function takeSuggestion(next: string) {
    cancelPending();
    onChange(next);
    setSettled(next);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Tab") {
      settleNow();
      return;
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    settleNow();
    // In a form, Enter submits it and focus stays here; otherwise it closes a phone's keyboard.
    if (!submitOnEnter) dismissKeyboardOnEnter(event);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={look === "panel" ? "text-sm font-semibold" : "eyebrow text-muted"}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="email"
        autoComplete="email"
        name="email"
        inputMode="email"
        required
        spellCheck={false}
        autoCapitalize="none"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          settleSoon(event.target.value);
        }}
        // Leaving by a click: a hint still pending would appear under the pointer mid-click, so it's dropped.
        onBlur={cancelPending}
        // The keyboard's own key: "Send" in a form (Enter submits it), else "Done" (it closes the keyboard on a phone).
        enterKeyHint={submitOnEnter ? "send" : "done"}
        onKeyDown={onKeyDown}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        // 16px text so iOS doesn't zoom on focus, and a 48px target; the panel's look matches its name field.
        className={
          look === "panel"
            ? "min-h-12 rounded-card border-muted bg-card px-4 py-2 text-base aria-invalid:border-danger"
            : "min-h-12 px-3 py-2 text-base"
        }
      />
      {hintText && (
        <p id={hintId} className="text-sm text-muted">
          {hintText}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {/* Always rendered, so what's put in it is read out. */}
      <div aria-live="polite" className="flex flex-wrap items-center gap-x-2">
        {shown && (
          <>
            <p id={suggestionId} className="min-w-0 text-sm text-foreground">
              Did you mean <span className="font-semibold wrap-anywhere">{shown}</span>?
            </p>
            <button
              type="button"
              onClick={() => takeSuggestion(shown)}
              aria-describedby={suggestionId}
              className="inline-flex min-h-11 min-w-11 items-center text-sm font-semibold text-foreground underline underline-offset-4"
            >
              Use this
            </button>
          </>
        )}
      </div>
      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex min-h-11 w-fit items-center text-sm text-muted underline underline-offset-4"
        >
          Not you? Sign out
        </button>
      )}
      {detailsNotice && (
        <p id={noticeId} className={look === "panel" ? "mt-2 flex items-start gap-2 text-sm text-muted" : "text-xs text-muted"}>
          {look === "panel" && <UsersIcon className="mt-0.5 size-4 shrink-0" />}
          <span>{DETAILS_NOTICE}</span>
        </p>
      )}
    </div>
  );
}
