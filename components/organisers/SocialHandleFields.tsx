import {
  handleFromProfileUrl,
  SOCIAL_HANDLE_FIELDS,
  type SocialHandleField,
  type SocialHandleValues,
} from "@/lib/organiser-profile";

/**
 * The four optional social-handle inputs (Instagram, TikTok, Facebook page,
 * X), each with a visual prefix ("@", "facebook.com/"), a hint, and its error
 * wired up with aria-invalid / aria-describedby. Used by the organiser
 * application form and the dashboard's public profile form. The caller
 * supplies the surrounding <fieldset> and legend.
 *
 * A profile URL for the field's own network (pasted over the whole value, or
 * left there on blur) is cut down to the handle when that's unambiguous;
 * anything else is kept exactly as typed for the server to judge.
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
                onPaste={(e) => {
                  const input = e.currentTarget;
                  // Only a paste that replaces the whole value: never splice into what's there.
                  if (input.selectionStart !== 0 || input.selectionEnd !== input.value.length) return;
                  const handle = handleFromProfileUrl(field, e.clipboardData.getData("text"));
                  if (handle === null) return;
                  e.preventDefault();
                  onChange(field, handle);
                }}
                onBlur={(e) => {
                  const handle = handleFromProfileUrl(field, e.currentTarget.value);
                  if (handle !== null) onChange(field, handle);
                }}
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
