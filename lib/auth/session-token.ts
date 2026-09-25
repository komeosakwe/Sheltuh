/**
 * Framework-agnostic core of "get a currently-valid access token", kept
 * separate from AuthContext.tsx so it can be unit-tested without React or a
 * real Supabase project — see tests/session-token.test.ts.
 */

export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has expired. Sign in again to continue — your changes here haven't been lost.");
    this.name = "SessionExpiredError";
  }
}

export interface SessionLike {
  access_token: string;
}

/**
 * Builds a `getAccessToken`-style function that:
 *  - resolves the current session via `getSession` — for Supabase,
 *    `auth.getSession()` itself swaps an expired access token (valid for an
 *    hour) for a new one using the stored refresh token, so nothing is
 *    reimplemented here;
 *  - rejects with `SessionExpiredError` if there's no session, or the
 *    refresh failed (e.g. the refresh token was revoked by signing out
 *    elsewhere);
 *  - de-dupes concurrent callers into a single in-flight request, so a
 *    burst of calls — or a failure — never turns into a stampede or a retry
 *    loop.
 */
export function createAccessTokenResolver(getSession: () => Promise<SessionLike | null>): () => Promise<string> {
  let inFlight: Promise<string> | null = null;

  return function getAccessToken(): Promise<string> {
    if (inFlight) return inFlight;

    const promise = getSession()
      .catch(() => null)
      .then((session) => {
        if (!session?.access_token) throw new SessionExpiredError();
        return session.access_token;
      })
      .finally(() => {
        inFlight = null;
      });

    inFlight = promise;
    return promise;
  };
}
