"use client";

import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref } from "react";

/**
 * A labelled sign-in/sign-up field with its own error line. When the field is
 * invalid it's `aria-invalid`, and `aria-describedby` reads its error (or the
 * form's error, `invalidBy`, for a server error about it) before any hint.
 */
export default function AuthField({
  id,
  label,
  error,
  invalidBy,
  hint,
  labelAside,
  inputAside,
  describedBy: extraDescribedBy,
  compact = false,
  ref,
  className = "",
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "aria-invalid" | "aria-describedby"> & {
  id: string;
  label: string;
  /** This field's own problem ("Enter your email"), shown under it. */
  error?: string;
  /** The id of a form-level error that is about this field too (a server error). */
  invalidBy?: string;
  hint?: string;
  /** Beside the label, e.g. "Forgot password?". */
  labelAside?: ReactNode;
  /** Inside the input's right edge, e.g. a show/hide button (the input leaves room for it). */
  inputAside?: ReactNode;
  /** Ids of other elements that describe the field (read after its error and hint). */
  describedBy?: string;
  /** Smaller text and padding, for sign-in inside another message (InlineReauth). */
  compact?: boolean;
  ref?: Ref<HTMLInputElement>;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, invalidBy ?? null, hint ? hintId : null, extraDescribedBy ?? null].filter(Boolean).join(" ");
  const labelEl = (
    <label htmlFor={id} className="eyebrow text-muted">
      {label}
    </label>
  );
  const inputEl = (
    <input
      ref={ref}
      id={id}
      aria-invalid={error || invalidBy ? true : undefined}
      aria-describedby={describedBy || undefined}
      className={`border border-foreground bg-transparent px-3 text-foreground ${compact ? "py-1.5 text-sm" : "py-2"} ${inputAside ? "min-h-11 w-full pr-12" : ""} ${className}`.trim()}
      {...input}
    />
  );
  return (
    <div className="flex flex-col gap-1">
      {labelAside ? (
        <div className="flex items-center justify-between gap-3">
          {labelEl}
          {labelAside}
        </div>
      ) : (
        labelEl
      )}
      {inputAside ? (
        <div className="relative">
          {inputEl}
          {inputAside}
        </div>
      ) : (
        inputEl
      )}
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Focus a field once the render that marks it invalid has happened, so a
 * screen reader hears it with its error (aria-invalid, aria-describedby)
 * rather than before them.
 */
export function useFocusAfterRender(): (element: HTMLElement | null) => void {
  const target = useRef<HTMLElement | null>(null);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    if (request === 0) return;
    target.current?.focus();
    target.current = null;
  }, [request]);
  return useCallback((element: HTMLElement | null) => {
    target.current = element;
    setRequest((n) => n + 1);
  }, []);
}

/** Which of a form's fields an auth service error is about, so they're marked invalid with it. */
export type AuthErrorField = "email" | "password" | "code";

/**
 * Supabase Auth's messages name what's wrong ("Invalid login credentials",
 * "Token has expired or is invalid", "Password should be…"). A connection or
 * rate-limit failure is about no field. `fallback` is the form's own guess
 * for anything else.
 */
export function fieldsForAuthError(message: string, fallback: AuthErrorField[]): AuthErrorField[] {
  const text = message.toLowerCase();
  if (/fetch|network|timed? ?out|rate limit|too many|configured/.test(text)) return [];
  if (/credential/.test(text)) return ["email", "password"];
  if (/password/.test(text)) return ["password"];
  if (/token|otp|code/.test(text)) return ["code"];
  if (/email|user/.test(text)) return ["email"];
  return fallback;
}
