"use client";

import { useCallback, useState } from "react";
import type { GetToken } from "@/lib/api/client";
import { sameAccount, type AccountRef } from "./account";
import { SessionExpiredError, useAuth } from "./AuthContext";

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
  /**
   * A token getter bound to `owner`: it reads the session when it's called
   * (AuthContext's `getAccessTokenFor`), and rejects with
   * `SessionExpiredError` if that's anyone else's (or there's none, or no
   * owner yet). `otherAccount` only knows what React last rendered; this
   * covers an account change after the form's check, mid-save. Pass it to
   * every request a save makes, instead of the plain `getToken`.
   */
  getOwnerToken: GetToken;
}

/**
 * Captures the owner of a draft while they're signed in, so a session-expiry
 * recovery shown later (once the live session is gone, or is someone else's)
 * still knows whose draft it is, and requests are only ever made as them.
 * Call it in the component that holds the draft, which is mounted while
 * signed in, not in the recovery message.
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

  const ownerId = current?.userId;
  const ownerEmail = current?.email;
  const { getAccessTokenFor } = auth;
  const getOwnerToken = useCallback<GetToken>(
    () =>
      ownerId || ownerEmail
        ? getAccessTokenFor({ userId: ownerId, email: ownerEmail })
        : Promise.reject(new SessionExpiredError()),
    [ownerId, ownerEmail, getAccessTokenFor],
  );

  return { owner: current, otherAccount: Boolean(current && live && !sameAccount(live, current)), getOwnerToken };
}
