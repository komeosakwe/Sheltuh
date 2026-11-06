import type { Ref } from "react";
import { DETAILS_NOTICE } from "@/lib/buyer-details";

/**
 * The buyer's name at checkout (every order, paid or free), with the notice
 * that it's shared with the organiser as its hint. Not prefilled: the buyer
 * types the name they want the organiser to see.
 */
export default function BuyerNameField({
  id,
  value,
  onChange,
  error,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="eyebrow text-muted">
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
        // The keyboard's own key says "Done" and closes the keyboard (there's no form to submit),
        // which brings the page's sticky buy bar back into view on a phone.
        enterKeyHint="done"
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
        // 16px text so iOS doesn't zoom on focus, and a 48px target.
        className="min-h-12 px-3 py-2 text-base"
      />
      <p id={`${id}-hint`} className="text-xs text-muted">
        {DETAILS_NOTICE}
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
