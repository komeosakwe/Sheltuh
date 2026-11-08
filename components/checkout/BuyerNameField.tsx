import type { Ref } from "react";
import { UsersIcon } from "@/components/checkout/icons";
import { DETAILS_NOTICE } from "@/lib/buyer-details";
import { dismissKeyboardOnEnter } from "@/lib/use-soft-keyboard";

/**
 * The buyer's name at checkout (every order, paid or free), with the notice
 * that it's shared with the organiser as its hint. Not prefilled: the buyer
 * types the name they want the organiser to see.
 *
 * `placeholderLabel`: the event page's ticket panel look: the field says "Your name" as its
 * placeholder, and the label is for screen readers only (a placeholder is never the only name:
 * the label stays), with a people icon at the notice.
 */
export default function BuyerNameField({
  id,
  value,
  onChange,
  error,
  inputRef,
  placeholderLabel = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  inputRef?: Ref<HTMLInputElement>;
  placeholderLabel?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={placeholderLabel ? "sr-only" : "eyebrow text-muted"}>
        Your name
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoComplete="name"
        name="name"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // The keyboard's own key says "Done" and closes the keyboard on a phone (there's no form to submit),
        // which brings the page's sticky buy bar back into view.
        enterKeyHint="done"
        onKeyDown={dismissKeyboardOnEnter}
        placeholder={placeholderLabel ? "Your name" : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
        // 16px text so iOS doesn't zoom on focus, and a 48px target. The panel's look: a 12px
        // radius and a mid-grey 1px border (5:1, so the field's edge is still clear); the invalid
        // border is set here too, since a utility border would otherwise beat the base rule's.
        className={
          placeholderLabel
            ? "min-h-12 rounded-card border-muted bg-card px-4 py-2 text-base aria-invalid:border-danger"
            : "min-h-12 px-3 py-2 text-base"
        }
      />
      <p id={`${id}-hint`} className={placeholderLabel ? "mt-2 flex items-start gap-2 text-sm text-muted" : "text-xs text-muted"}>
        {placeholderLabel && <UsersIcon className="mt-0.5 size-4 shrink-0" />}
        <span>{DETAILS_NOTICE}</span>
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
