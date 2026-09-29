"use client";

import type { Ref } from "react";
import { fieldClass } from "@/components/ui/Field";
import { DISPLAY_NAME_MAX } from "@/lib/display-name";

/**
 * The display-name input shared by the event-page opt-in form and /account:
 * label, hint, a character counter and an announced error.
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
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hintId, countId].filter(Boolean).join(" ");
  const length = Array.from(value).length;

  return (
    <div className="flex flex-col gap-1.5">
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
        maxLength={DISPLAY_NAME_MAX}
        autoComplete="nickname"
        required
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      <div className="flex items-start justify-between gap-4">
        <p id={hintId} className="text-xs text-muted">
          1–{DISPLAY_NAME_MAX} characters. A first name and initial works well, like Mia T.
        </p>
        <p id={countId} className="shrink-0 text-xs text-muted tabular-nums">
          {length}/{DISPLAY_NAME_MAX}
        </p>
      </div>
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
