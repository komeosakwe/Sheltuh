"use client";

import { useState, type FormEvent, type RefObject } from "react";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { normaliseTypedCode } from "@/lib/check-in/manual-code";
import { doorBusyClass } from "./busy-class";
import type { ManualOutcome } from "./useDoorScan";

const ERROR_ID = "door-code-error";
const HINT_ID = "door-code-hint";

/**
 * Typing a code (docs/design/check-in.md §5.A6): always on the page, works
 * with the camera off, denied or unsupported. Results show in the scanner
 * slot; the field clears after a result, and keeps the code when Not
 * verified so submitting it again retries. No placeholder: the hint under
 * the field already shows the format, and a code-shaped placeholder can be
 * misread as a code already typed in.
 */
export default function ManualEntry({
  busy,
  inputRef,
  onSubmit,
  onGesture,
}: {
  /** A request is in flight. The input stays editable. */
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: (code: string) => Promise<ManualOutcome>;
  /** The Check tap (unlocks sound). */
  onGesture: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Bumped per rejected submit, so the same error is put back into the live region and said again. */
  const [attempt, setAttempt] = useState(0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    onGesture();
    const code = normaliseTypedCode(value);
    if (!code) {
      setError("That’s not a ticket code. Codes have 8 letters and numbers, like 7KQM-2HXD.");
      setAttempt((n) => n + 1);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    const outcome = await onSubmit(code);
    if (outcome === "verified") setValue("");
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <label htmlFor="door-code" className="eyebrow text-muted">
          Type a code
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="door-code"
            name="code"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={20}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ERROR_ID} ${HINT_ID}` : HINT_ID}
            className={`${fieldClass} min-w-0 flex-1 font-mono tracking-wider uppercase`}
          />
          <Button type="submit" size="lg" variant="solid" busy={busy} className={doorBusyClass}>
            {busy ? "Checking…" : "Check"}
          </Button>
        </div>
        <div>
          {/* Mounted before any error, so screen readers hear one appear (focus is already in the field). */}
          <div role="status" aria-atomic="true" data-testid="door-code-error-region">
            {error && (
              <p key={attempt} id={ERROR_ID} className="mb-1.5 text-sm text-danger">
                {error}
              </p>
            )}
          </div>
          <p id={HINT_ID} className="text-xs text-muted">
            Like 7KQM-2HXD. Codes never contain O, 0, I or 1.
          </p>
        </div>
      </div>
    </form>
  );
}
