"use client";

import { useState } from "react";

/**
 * `value` while `settled` (signed in, with this account's data loaded), and
 * the last settled value while not (signed out, or loading again after a
 * sign-in); undefined if it has never settled.
 *
 * For a page that shows a form someone may be part-way through: when their
 * session runs out (or is replaced from another tab), the page keeps showing
 * the same form, so it stays mounted with what's been typed, and the form's
 * own session-expired recovery (components/auth/InlineReauth.tsx) can sign
 * them in again in place. Swapping it for a "Sign in" card or a loader would
 * throw the draft away. Nothing is fetched for a signed-out visitor: only
 * what was already on screen stays.
 *
 * `value` should be stable between renders (a primitive, or state).
 */
export function useKeptWhileSignedOut<T>(value: T, settled: boolean): T | undefined {
  const [kept, setKept] = useState<{ value: T } | undefined>(settled ? { value } : undefined);
  // Set while rendering (React's pattern for state that follows a prop): only when it has changed.
  if (settled && (!kept || !Object.is(kept.value, value))) setKept({ value });
  return settled ? value : kept?.value;
}
