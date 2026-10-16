import { SOCIAL_HANDLE_FIELDS, type SocialHandleField, type SocialHandleValues } from "@/lib/organiser-profile";

/**
 * The four optional social-handle inputs (Instagram, TikTok, Facebook page,
 * X), each with a visual prefix ("@", "facebook.com/"), a hint, and its error
 * wired up with aria-invalid / aria-describedby. Used by the organiser
 * application form and the dashboard's public profile form. The caller
 * supplies the surrounding <fieldset> and legend.
 */
export default function SocialHandleFields({
  values,
  errors,
  onChange,
  idPrefix,
  inputClassName,
}: {
  values: SocialHandleValues;
  errors: Partial<Record<string, string>>;
  onChange: (field: SocialHandleField, value: string) => void;
  /** Keeps ids unique if two forms are ever on one page. */
  idPrefix: string;
  inputClassName: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      {SOCIAL_HANDLE_FIELDS.map(({ field, label, prefix, hint }) => {
        const id = `${idPrefix}-${field}`;
        const hintId = `${id}-hint`;
        const errorId = `${id}-error`;
        const error = errors[field];
        return (
          <div key={field} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-medium text-foreground">
              {label}
            </label>
            <div className="flex items-stretch">
              <span
                aria-hidden="true"
                className="flex shrink-0 items-center border border-r-0 border-foreground bg-surface px-3 text-sm text-muted"
              >
                {prefix}
              </span>
              <input
                id={id}
                name={field}
                value={values[field]}
                onChange={(e) => onChange(field, e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                className={`min-w-0 flex-1 ${inputClassName}`}
              />
            </div>
            <p id={hintId} className="text-xs text-muted">
              {hint}
            </p>
            {error && (
              <p id={errorId} className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
