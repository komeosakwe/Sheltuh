/**
 * Framework-agnostic core of "get a currently-valid ID token", kept separate
 * from AuthContext.tsx so it can be unit-tested without React or a real
 * Cognito user pool — see tests/session-token.test.ts.
 */

export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has expired. Sign in again to continue — your changes here haven't been lost.");
    this.name = "SessionExpiredError";
  }
}

export interface SessionLike {
  isValid(): boolean;
  getIdToken(): { getJwtToken(): string };
}

export interface CognitoUserLike {
  getSession(callback: (err: Error | null, session: SessionLike | null) => void): void;
}

/**
 * Builds a `getValidIdToken`-style function that:
 *  - resolves the current CognitoUser's session, letting the SDK's own
 *    `getSession()` transparently exchange the stored refresh token for a
 *    new ID token when the cached one has expired (valid for 1 hour) —
 *    this is Cognito's actual session-refresh mechanism, not something
 *    reimplemented here;
 *  - rejects with `SessionExpiredError` if there's no signed-in user, or
 *    the session/refresh has genuinely failed (e.g. the refresh token
 *    itself expired or was revoked);
 *  - de-dupes concurrent callers into a single in-flight request, so a
 *    burst of calls around the same moment — or a failure — never turns
 *    into a stampede or a retry loop. Each call either returns the one
 *    shared in-flight promise or starts exactly one new request.
 */
export function createIdTokenResolver(getCurrentUser: () => CognitoUserLike | null): () => Promise<string> {
  let inFlight: Promise<string> | null = null;

  return function getValidIdToken(): Promise<string> {
    if (inFlight) return inFlight;

    const user = getCurrentUser();
    if (!user) {
      return Promise.reject(new SessionExpiredError());
    }

    const promise = new Promise<string>((resolve, reject) => {
      user.getSession((err, session) => {
        if (err || !session || !session.isValid()) {
          reject(new SessionExpiredError());
          return;
        }
        resolve(session.getIdToken().getJwtToken());
      });
    }).finally(() => {
      inFlight = null;
    });

    inFlight = promise;
    return promise;
  };
}
