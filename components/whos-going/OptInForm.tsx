"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { validateDisplayName } from "@/lib/display-name";
import ConsentCopy from "./ConsentCopy";
import DisplayNameField from "./DisplayNameField";
import { GENERIC_MUTATION_ERROR, pillClass } from "./shared";

const ADULT_ERROR = "Confirm you're 18 or older to be shown.";

/** What the parent reports back after trying to save; null = done (the form is about to close). */
export type OptInResult = { fieldErrors?: Record<string, string>; message?: string } | null;

/**
 * First-time opt-in: pick a display name, confirm 18+, read what's shown to
 * whom, then submit. Opened as a disclosure under "Add yourself".
 */
export default function OptInForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (displayName: string) => Promise<OptInResult>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [adult, setAdult] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [adultError, setAdultError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const adultRef = useRef<HTMLInputElement>(null);

  // Opening the form (a user action) moves focus to its first field.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const nextNameError = validateDisplayName(name);
    const nextAdultError = adult ? null : ADULT_ERROR;
    setNameError(nextNameError);
    setAdultError(nextAdultError);
    if (nextNameError || nextAdultError) {
      (nextNameError ? nameRef : adultRef).current?.focus();
      return;
    }

    setBusy(true);
    const result = await onSubmit(name.trim());
    if (!result) return; // Saved: the parent replaces this form.
    setBusy(false);
    const serverName = result.fieldErrors?.displayName ?? null;
    const serverAdult = result.fieldErrors?.adultConfirmed ? ADULT_ERROR : null;
    setNameError(serverName);
    setAdultError(serverAdult);
    setMessage(result.message ?? (serverName || serverAdult ? null : GENERIC_MUTATION_ERROR));
    if (serverName) nameRef.current?.focus();
    else if (serverAdult) adultRef.current?.focus();
  }

  return (
    <form
      id="wg-form"
      aria-labelledby="wg-form-title"
      aria-busy={busy}
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
    >
      <p id="wg-form-title" className="text-sm font-semibold">
        Add yourself to who&rsquo;s going
      </p>

      <DisplayNameField id="wg-name" value={name} onChange={setName} error={nameError} inputRef={nameRef} />

      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            ref={adultRef}
            type="checkbox"
            name="adultConfirmed"
            className="size-5 shrink-0"
            checked={adult}
            onChange={(e) => setAdult(e.target.checked)}
            required
            aria-invalid={adultError ? true : undefined}
            aria-describedby={adultError ? "wg-adult-error" : undefined}
          />
          I&rsquo;m 18 or older
        </label>
        {adultError && (
          <p id="wg-adult-error" className="text-sm text-danger">
            {adultError}
          </p>
        )}
      </div>

      <ConsentCopy id="wg-consent" />

      {message && (
        <Notice tone="danger" role="alert">
          {message}
        </Notice>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" variant="solid" size="lg" disabled={busy} aria-describedby="wg-consent" className={pillClass}>
          {busy ? "Adding you…" : "Show me as going"}
        </Button>
        <Button variant="outline" size="lg" disabled={busy} onClick={onCancel} className={pillClass}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
