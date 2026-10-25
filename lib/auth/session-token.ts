/**
 * Framework-agnostic core of "get a currently-valid access token", kept
 * separate from AuthContext.tsx so it can be unit-tested without React or a
 * real Supabase project — see tests/session-token.test.ts.
 */

import { sameAccount, type AccountRef } from "./account";

export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has expired. Sign in again to continue — your changes here haven't been lost.");
    this.name = "SessionExpiredError";
  }
}

export interface SessionLike {
  access_token: string;
  /** Whose session it is (Supabase's `session.user`). */
  user?: { id: string; email?: string };
}

/**
 * Builds a "get the current session" function that:
 *  - resolves the current session via `getSession` — for Supabase,
 *    `auth.getSession()` reads the stored session (shared by every tab) at
 *    call time and itself swaps an expired access token (valid for an hour)
 *    for a new one using the stored refresh token, so nothing is
 *    reimplemented here;
 *  - rejects with `SessionExpiredError` if there's no session, or the
 *    refresh failed (e.g. the refresh token was revoked by signing out
 *    elsewhere);
 *  - de-dupes concurrent callers into a single in-flight request, so a
 *    burst of calls — or a failure — never turns into a stampede or a retry
 *    loop.
 */
export function createSessionResolver(getSession: () => Promise<SessionLike | null>): () => Promise<SessionLike> {
  let inFlight: Promise<SessionLike> | null = null;

  return function resolveSession(): Promise<SessionLike> {
    if (inFlight) return inFlight;

    const promise = getSession()
      .catch(() => null)
      .then((session) => {
        if (!session?.access_token) throw new SessionExpiredError();
        return session;
      })
      .finally(() => {
        inFlight = null;
      });

    inFlight = promise;
    return promise;
  };
}

/** A `getAccessToken`-style function over `createSessionResolver`: the current session's access token. */
export function createAccessTokenResolver(getSession: () => Promise<SessionLike | null>): () => Promise<string> {
  const resolveSession = createSessionResolver(getSession);
  return () => resolveSession().then((session) => session.access_token);
}

/**
 * `session`'s access token, only if it's `account`'s session (by user id,
 * lib/auth/account.ts); otherwise `SessionExpiredError`, as for no session at
 * all: a request made with it would act as someone else.
 */
export function accessTokenFor(session: SessionLike, account: AccountRef): string {
  const sessionAccount: AccountRef = { userId: session.user?.id, email: session.user?.email };
  if (!sameAccount(sessionAccount, account)) throw new SessionExpiredError();
  return session.access_token;
}
