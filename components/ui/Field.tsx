import type { ReactNode } from "react";

/** Shared class for text-like controls (inputs, selects, textareas). */
export const fieldClass =
  "w-full px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus-visible:outline-offset-0";

/** Labelled field wrapper: small caps label above, optional hint below. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="eyebrow text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
