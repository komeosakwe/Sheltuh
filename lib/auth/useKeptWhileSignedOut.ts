"use client";

import { useState } from "react";
import { accountKey } from "./account";
import { useAuth } from "./AuthContext";

/** What a page last showed, and for which account (`accountKey`: key the form by it). */
export interface Kept<T> {
  value: T;
  account: string;
}

/**
 * `value` while `settled` (signed in, with this account's data loaded or
 * failed to load), and the last settled value while not (signed out, or
 * loading again after a sign-in); undefined if it has never settled. Each
 * comes with the account it was settled for.
 *
 * For a page that shows a form someone may be part-way through: when their
 * session runs out (or is replaced from another tab), the page keeps showing
 * the same form, so it stays mounted with what's been typed, and the form's
 * own session-expired recovery (components/auth/InlineReauth.tsx) can sign
 * them in again in place. Swapping it for a "Sign in" card or a loader would
 * throw the draft away. Nothing is fetched for a signed-out visitor: only
 * what was already on screen stays.
 *
 * Not kept (undefined, and forgotten) after the person's own Sign out, in
 * this tab or another (`signedOutBy: "user"`): they meant to leave, so the
 * page shows what it shows anyone signed out. Once a different account has
 * settled, its own value is what's returned, with its own `account`: a page
 * keys the form by `account`, so that account never gets the last one's draft.
 *
 * `value` should be stable between renders (a primitive, or state).
 */
export function useKeptWhileSignedOut<T>(value: T, settled: boolean): Kept<T> | undefined {
  const auth = useAuth();
  const account = accountKey(auth) ?? "";
  const dropped = !settled && auth.status === "signed-out" && auth.signedOutBy === "user";
  const [kept, setKept] = useState<Kept<T> | undefined>(settled ? { value, account } : undefined);
  // Set while rendering (React's pattern for state that follows a prop): only when it has changed.
  if (settled && (!kept || !Object.is(kept.value, value) || kept.account !== account)) setKept({ value, account });
  if (dropped && kept) setKept(undefined);
  if (settled) return { value, account };
  return dropped ? undefined : kept;
}
