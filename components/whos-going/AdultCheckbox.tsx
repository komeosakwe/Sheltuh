"use client";

import type { Ref } from "react";

export const ADULT_ERROR = "Confirm you're 18 or older to be shown.";

/** The "I'm 18 or older" self-attestation, needed to create a Who's Going profile, with an announced error. */
export default function AdultCheckbox({
  id,
  checked,
  onChange,
  error,
  inputRef,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          ref={inputRef}
          id={id}
          type="checkbox"
          name="adultConfirmed"
          className="size-5 shrink-0"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        I&rsquo;m 18 or older
      </label>
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
