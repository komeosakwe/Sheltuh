"use client";

import type { Ref } from "react";
import { fieldClass } from "@/components/ui/Field";
import { DISPLAY_NAME_MAX, displayNameLength } from "@/lib/display-name";

/**
 * The display-name input shared by the event-page opt-in form and /account:
 * label, a character counter and an announced error.
 *
 * No `maxLength`: browsers count it in UTF-16 units, so an emoji would use
 * up two of the 40. Length is counted in code points, as the API does; the
 * counter turns red past the limit and the form's validation stops the save.
 */
export default function DisplayNameField({
  id,
  value,
  onChange,
  error,
  disabled,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const countId = `${id}-count`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, countId].filter(Boolean).join(" ");
  const length = displayNameLength(value);
  const over = length > DISPLAY_NAME_MAX;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="eyebrow text-muted">
        Display name
      </label>
      <input
        ref={inputRef}
        id={id}
        name="displayName"
        type="text"
        className={fieldClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="nickname"
        required
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      <p id={countId} className={`self-end text-xs tabular-nums ${over ? "text-danger" : "text-muted"}`}>
        {length}/{DISPLAY_NAME_MAX}
      </p>
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
