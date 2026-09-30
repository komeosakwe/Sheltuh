"use client";

import type { KeyboardEvent, ReactNode, Ref } from "react";
import { fieldClass } from "@/components/ui/Field";
import { MESSAGE_MAX, messageLength } from "@/lib/message-text";

/**
 * A plain-text message box: label, optional hint, a character counter (code
 * points, as the API counts them) and an error tied to the field. No
 * `maxLength`: browsers count UTF-16 units, so an emoji would use up two.
 * The counter turns red past the limit and validation stops the send.
 */
export default function MessageField({
  id,
  label,
  labelHidden = false,
  value,
  onChange,
  error,
  hint,
  describedBy,
  disabled,
  rows = 3,
  inputRef,
  onSubmitShortcut,
  max = MESSAGE_MAX,
  trailing,
}: {
  id: string;
  label: string;
  /** Keeps the label for assistive tech only (the context names the field visibly). */
  labelHidden?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string;
  /** Ids of other text that explains the field (read after the error and hint). */
  describedBy?: string;
  disabled?: boolean;
  rows?: number;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** Ctrl/Cmd+Enter. Enter alone always adds a line break. */
  onSubmitShortcut?: () => void;
  max?: number;
  /** Beside the box, bottom-aligned (the composer's Send button). */
  trailing?: ReactNode;
}) {
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const errorId = `${id}-error`;
  const length = messageLength(value);
  const over = length > max;
  const describedByIds = [error ? errorId : null, hint ? hintId : null, describedBy ?? null, countId]
    .filter(Boolean)
    .join(" ");

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (onSubmitShortcut && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmitShortcut();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className={labelHidden ? "sr-only" : "eyebrow text-muted"}>
          {label}
        </label>
        <p
          id={countId}
          className={`ml-auto shrink-0 text-xs tabular-nums ${over ? "text-danger" : "text-muted"}`}
        >
          <span aria-hidden="true">
            {length}/{max}
          </span>
          <span className="sr-only">
            {length} of {max} characters
          </span>
        </p>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          id={id}
          name={id}
          rows={rows}
          className={`${fieldClass} min-w-0 flex-1 resize-y`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds}
        />
        {trailing}
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
