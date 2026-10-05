import type { ReactNode } from "react";

/**
 * Shared class for text-like controls (inputs, selects, textareas). 16px and
 * 48px tall on phones (iOS Safari zooms the page when a field under 16px takes focus).
 */
export const fieldClass =
  "w-full min-h-12 px-3 py-2.5 text-base text-foreground placeholder:text-muted focus-visible:outline-offset-0 sm:min-h-0 sm:text-sm";

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
