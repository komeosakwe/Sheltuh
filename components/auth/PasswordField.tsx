"use client";

import { useId, useState, type ComponentProps } from "react";
import AuthField from "@/components/auth/AuthField";
import { PASSWORD_RULES } from "@/lib/auth/password-rules";

type FieldProps = Omit<ComponentProps<typeof AuthField>, "type" | "inputAside" | "describedBy">;

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

function TickIcon({ met }: { met: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
    >
      {met ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <circle cx="12" cy="12" r="4" />}
    </svg>
  );
}

/**
 * A password input with a show/hide button inside its right edge. With
 * `rules`, a checklist of the password rules ticks as they're met: it
 * describes the field (aria-describedby), and a polite status line names
 * what's still missing, changing only when that set changes.
 */
export default function PasswordField({ rules = false, ...field }: FieldProps & { rules?: boolean }) {
  const [shown, setShown] = useState(false);
  const rulesId = useId();
  const value = typeof field.value === "string" ? field.value : "";
  const missing = PASSWORD_RULES.filter((rule) => !rule.met(value));
  const status = !rules || !value ? "" : missing.length === 0 ? "Password meets the requirements" : `Still needed: ${missing.map((r) => r.label.toLowerCase()).join(", ")}`;

  return (
    <div className="flex flex-col gap-2">
      <AuthField
        {...field}
        type={shown ? "text" : "password"}
        describedBy={rules ? rulesId : undefined}
        inputAside={
          <button
            type="button"
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            // The input keeps focus (and the keyboard stays up) on a tap.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShown((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-foreground"
          >
            <EyeIcon off={shown} />
          </button>
        }
      />
      {rules && (
        <>
          <ul id={rulesId} className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {PASSWORD_RULES.map((rule) => {
              const met = rule.met(value);
              return (
                <li key={rule.id} className={`flex items-center gap-1.5 ${met ? "text-foreground" : "text-muted"}`}>
                  <TickIcon met={met} />
                  <span>
                    <span className="sr-only">{met ? "Met: " : "Needed: "}</span>
                    {rule.label}
                  </span>
                </li>
              );
            })}
          </ul>
          <p aria-live="polite" className="sr-only">
            {status}
          </p>
        </>
      )}
    </div>
  );
}
