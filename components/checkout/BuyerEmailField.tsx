"use client";

import { useState, type RefObject } from "react";
import { suggestEmail } from "@/lib/email-typos";
import { dismissKeyboardOnEnter } from "@/lib/use-soft-keyboard";

/** The field's hint: where the tickets go, and why the account's address matters. */
export const BUYER_EMAIL_HINT = "Tickets are sent here. Use your account email to join Who’s Going.";

/**
 * "Email for your tickets": every checkout (paid and free, general admission
 * and seated) and the confirmation page's change of it. The server checks the
 * address (docs/architecture.md, "Buyer email checks"); this field only helps
 * get it right first time:
 * - once the buyer leaves the field, a domain that looks mistyped
 *   (lib/email-typos.ts suggestEmail) gets a "Did you mean …?" with Use this.
 *   It never blocks: they can check out with what they typed.
 * - `suggestion`: the server's corrected address (a 400 `email_typo` /
 *   `email_no_mail`), shown the same way until the address changes.
 * The suggestion is in a polite live region, so it's read out when it
 * appears; Use this puts it in the field and focus back on the field. Errors
 * are `role="alert"` and describe the field.
 *
 * `look`: `panel` is the event page's ticket panel (its 12px radius, mid-grey
 * edge); `plain` the seat page's and the confirmation page's default field.
 * `onSignOut`: signed in, with the account's address filled in: "Not you?
 * Sign out" (this browser only), so someone else's account isn't booked with.
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
  hint = BUYER_EMAIL_HINT,
  onSignOut,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  /** The server's corrected address, if it sent one; the parent clears it when the address changes. */
  suggestion?: string | null;
  /** The input, for the parent's focus moves (and Use this's). */
  inputRef: RefObject<HTMLInputElement | null>;
  look?: "panel" | "plain";
  label?: string;
  hint?: string | null;
  onSignOut?: () => void;
}) {
  // The address as it was when the buyer last left the field: the typo hint is for that, not for every keystroke.
  const [leftWith, setLeftWith] = useState<string | null>(null);
  const typed = value.trim();
  const hinted = leftWith !== null && leftWith === value ? suggestEmail(typed) : null;
  const offer = suggestion ?? hinted;
  const shown = offer && offer.toLowerCase() !== typed.toLowerCase() ? offer : null;

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const suggestionId = `${id}-suggestion`;
  const describedBy = [hint ? hintId : null, error ? errorId : null, shown ? suggestionId : null].filter(Boolean).join(" ");

  function takeSuggestion(next: string) {
    onChange(next);
    setLeftWith(next);
    inputRef.current?.focus();
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
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setLeftWith(value)}
        // The keyboard's own key says "Done" and closes the keyboard on a phone (there's no form to submit).
        enterKeyHint="done"
        onKeyDown={dismissKeyboardOnEnter}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        // 16px text so iOS doesn't zoom on focus, and a 48px target; the panel's look matches its name field.
        className={
          look === "panel"
            ? "min-h-12 rounded-card border-muted bg-card px-4 py-2 text-base aria-invalid:border-danger"
            : "min-h-12 px-3 py-2 text-base"
        }
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
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
              Did you mean <span className="font-semibold break-all">{shown}</span>?
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
    </div>
  );
}
