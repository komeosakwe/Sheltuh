"use client";

import { useState } from "react";
import { sameAccount, type AccountRef } from "./account";
import { useAuth } from "./AuthContext";

export interface AccountOwner {
  /**
   * The account that was signed in when this component first saw one, kept
   * from then on: whatever is typed here is that account's. Undefined until
   * someone has been signed in.
   */
  owner: AccountRef | undefined;
  /**
   * Signed in right now as an account other than `owner` (for instance after
   * someone else signed in in another tab). Submitting would act as them, so
   * a host form refuses to and opens its session-expired recovery instead.
   */
  otherAccount: boolean;
}

/**
 * Captures the owner of a draft while they're signed in, so a session-expiry
 * recovery shown later (once the live session is gone, or is someone else's)
 * still knows whose draft it is. Call it in the component that holds the
 * draft, which is mounted while signed in, not in the recovery message.
 */
export function useAccountOwner(): AccountOwner {
  const auth = useAuth();
  const live: AccountRef | undefined =
    auth.status === "signed-in" && (auth.userId || auth.email) ? { userId: auth.userId, email: auth.email } : undefined;
  const [owner, setOwner] = useState<AccountRef | undefined>(live);
  // The first account seen, if none was signed in at mount (still loading).
  // Set while rendering, React's pattern for state that follows a prop; it
  // runs at most once, as `owner` is then set.
  if (!owner && live) setOwner(live);
  const current = owner ?? live;
  return { owner: current, otherAccount: Boolean(current && live && !sameAccount(live, current)) };
}
