"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { fieldClass } from "@/components/ui/Field";
import { MESSAGE_MAX, messageLength } from "@/lib/message-text";

/** The counter is read out (it's part of the field's description) only from here on. */
const ANNOUNCE_COUNT_FROM = 0.9;

/**
 * A plain-text message box: label, optional hint, a character counter (code
 * points, as the API counts them) and an error tied to the field. No
 * `maxLength`: browsers count UTF-16 units, so an emoji would use up two.
 * The counter turns red past the limit and validation stops the send.
 *
 * `errorAnnounced`: the error is an alert, for when it appears while focus
 * is already in the box (Ctrl/Cmd+Enter). When the form moves focus to the
 * box instead, the error is read as its description, so it isn't an alert
 * as well.
 *
 * `autoGrow`: starts at `rows` and grows with the text up to 10rem, then
 * scrolls (so a sticky composer never takes over a phone screen).
 */
export default function MessageField({
  id,
  label,
  labelHidden = false,
  value,
  onChange,
  error,
  errorAnnounced = false,
  hint,
  describedBy,
  disabled,
  rows = 3,
  autoGrow = false,
  inputRef,
  onSubmitShortcut,
  max = MESSAGE_MAX,
  trailing,
}: {
  id: string;
  label: ReactNode;
  /** Keeps the label for assistive tech only (the context names the field visibly). */
  labelHidden?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  errorAnnounced?: boolean;
  hint?: ReactNode;
  /** Ids of other text that explains the field (read after the error and hint). */
  describedBy?: string;
  disabled?: boolean;
  rows?: number;
  autoGrow?: boolean;
  inputRef?: Ref<HTMLTextAreaElement | null>;
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
  const nearLimit = length >= max * ANNOUNCE_COUNT_FROM;
  const describedByIds = [error ? errorId : null, hint ? hintId : null, describedBy ?? null, nearLimit ? countId : null]
    .filter(Boolean)
    .join(" ");

  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle<HTMLTextAreaElement | null, HTMLTextAreaElement | null>(inputRef, () => boxRef.current, []);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!autoGrow || !box) return;
    box.style.height = "auto";
    const borders = box.offsetHeight - box.clientHeight;
    box.style.height = `${box.scrollHeight + borders}px`;
  }, [autoGrow, value]);

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
          {nearLimit && (
            <span className="sr-only">
              {length} of {max} characters
            </span>
          )}
        </p>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={boxRef}
          id={id}
          name={id}
          rows={rows}
          className={`${fieldClass} min-w-0 flex-1 disabled:cursor-not-allowed disabled:opacity-60 ${
            autoGrow ? "max-h-40 resize-none overflow-y-auto sm:min-h-11!" : "resize-y"
          }`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds || undefined}
        />
        {trailing}
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role={errorAnnounced ? "alert" : undefined} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
