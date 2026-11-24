"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";

/** "Dash / Field"'s control: 48px, the 1.5px foreground stroke, radius 8, px 16, Body/M. */
export const dashInputClass =
  "body-m w-full min-h-12 rounded-control border-control border-foreground bg-card px-4 py-3 text-foreground placeholder:text-disabled focus-visible:outline-offset-0";

interface FrameProps {
  label: string;
  /** A line under the control (Label/Tag, text/secondary). */
  hint?: ReactNode;
  /** The field's error, shown under it in the danger colour and read with it (aria-describedby). */
  error?: string;
  /**
   * The label's look: `settings` Mono/S text/secondary (Dash / Field, the Settings cards), `dialog`
   * Body/S Strong in black (the dialogs' fields: Edit ticket type, Message attendees).
   */
  labelStyle?: "settings" | "dialog";
}

/**
 * The label over the control, 8px apart, with an optional hint and error under it. A Settings
 * label is Mono/S in text/secondary as drawn (Instrument Sans 12/16 here: the owner's 13 Nov 2026
 * decision keeps Plex Mono for machine codes only), 8px over the control; a dialog's is Body/S
 * Strong, 4px over it (as the Edit ticket type frame measures). The error says what's wrong in words, next to the
 * field, and marks the control aria-invalid.
 */
function FieldFrame({
  id,
  label,
  labelStyle = "settings",
  hint,
  error,
  hintId,
  errorId,
  children,
}: FrameProps & { id: string; hintId: string; errorId: string; children: ReactNode }) {
  return (
    <div data-dash-field="" className={`flex min-w-0 flex-col ${labelStyle === "dialog" ? "gap-1" : "gap-2"}`}>
      <label htmlFor={id} className={labelStyle === "dialog" ? "body-s font-semibold" : "mono-s text-muted"}>
        {label}
      </label>
      {children}
      {hint && (
        <p id={hintId} className="label-tag text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="body-s text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(own: string | undefined, hint: boolean, hintId: string, error: boolean, errorId: string) {
  const ids = [own, error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");
  return ids || undefined;
}

/**
 * "Dash / Field" (Latte's dashboard Components 465:7337; Settings' Name and Handle): a labelled
 * text input.
 */
export function DashField({
  label,
  labelStyle,
  hint,
  error,
  id: givenId,
  className = "",
  ref,
  ...props
}: FrameProps & Omit<InputHTMLAttributes<HTMLInputElement>, "children"> & { ref?: Ref<HTMLInputElement> }) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <FieldFrame id={id} label={label} labelStyle={labelStyle} hint={hint} error={error} hintId={hintId} errorId={errorId}>
      <input
        {...props}
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(props["aria-describedby"], Boolean(hint), hintId, Boolean(error), errorId)}
        className={`${dashInputClass} ${className}`.trim()}
      />
    </FieldFrame>
  );
}

/**
 * The same field for longer text (Settings' About): it grows with what's written from three
 * lines (the frames squeeze About into a 48px input: KEY-SPECS §9.5, the evident intent built).
 */
export function DashTextareaField({
  label,
  labelStyle,
  hint,
  error,
  id: givenId,
  className = "",
  rows = 3,
  ref,
  ...props
}: FrameProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "children"> & { ref?: Ref<HTMLTextAreaElement> }) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <FieldFrame id={id} label={label} labelStyle={labelStyle} hint={hint} error={error} hintId={hintId} errorId={errorId}>
      <textarea
        {...props}
        ref={ref}
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(props["aria-describedby"], Boolean(hint), hintId, Boolean(error), errorId)}
        className={`${dashInputClass} field-sizing-content ${className}`.trim()}
      />
    </FieldFrame>
  );
}
