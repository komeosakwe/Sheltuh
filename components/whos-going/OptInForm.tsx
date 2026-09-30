"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { validateDisplayName } from "@/lib/display-name";
import ActionErrorNotice from "./ActionErrorNotice";
import AdultCheckbox, { ADULT_ERROR } from "./AdultCheckbox";
import ConsentCopy from "./ConsentCopy";
import DisplayNameField from "./DisplayNameField";
import { GENERIC_MUTATION_ERROR, pillClass } from "./shared";

/** What the parent reports back after trying to save; null = done (the form is about to close). */
export type OptInResult = { fieldErrors?: Record<string, string>; message?: string } | null;

/**
 * First-time opt-in: pick a display name, confirm 18+, read what's shown to
 * whom, then submit. Opened as a disclosure under "Add yourself".
 */
export default function OptInForm({
  onSubmit,
  onCancel,
  returnTo,
}: {
  onSubmit: (displayName: string) => Promise<OptInResult>;
  onCancel: () => void;
  /** Where "Sign in" comes back to if the session has expired. */
  returnTo: string;
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
    if (busy) return;
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

      <AdultCheckbox id="wg-adult" checked={adult} onChange={setAdult} error={adultError} inputRef={adultRef} />

      <ConsentCopy id="wg-consent" />

      {message && <ActionErrorNotice message={message} returnTo={returnTo} />}

      <div className="flex flex-col gap-3 sm:flex-row">
        {/* busy, not disabled, so focus stays put and a failure can be retried from here. */}
        <Button type="submit" variant="solid" size="lg" busy={busy} aria-describedby="wg-consent" className={pillClass}>
          {busy ? "Adding you…" : "Show me as going"}
        </Button>
        <Button variant="outline" size="lg" busy={busy} onClick={onCancel} className={pillClass}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
