import { describe, expect, it, vi } from "vitest";
import { createIdTokenResolver, SessionExpiredError, type CognitoUserLike, type SessionLike } from "../lib/auth/session-token";

function fakeSession(token: string, valid = true): SessionLike {
  return {
    isValid: () => valid,
    getIdToken: () => ({ getJwtToken: () => token }),
  };
}

describe("createIdTokenResolver", () => {
  it("resolves the current token when the cached session is still valid (no refresh needed)", async () => {
    const getSession = vi.fn((cb: (err: Error | null, session: SessionLike | null) => void) =>
      cb(null, fakeSession("valid-token")),
    );
    const user: CognitoUserLike = { getSession };
    const getValidIdToken = createIdTokenResolver(() => user);

    await expect(getValidIdToken()).resolves.toBe("valid-token");
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("resolves the freshly-refreshed token when the cached one had expired", async () => {
    // amazon-cognito-identity-js's own getSession() transparently exchanges
    // an expired ID token for a new one via the refresh token before ever
    // calling back — from the caller's side that's indistinguishable from
    // "just give me a valid session", which is exactly what's mocked here.
    const getSession = vi.fn((cb: (err: Error | null, session: SessionLike | null) => void) =>
      cb(null, fakeSession("refreshed-token")),
    );
    const user: CognitoUserLike = { getSession };
    const getValidIdToken = createIdTokenResolver(() => user);

    await expect(getValidIdToken()).resolves.toBe("refreshed-token");
  });

  it("rejects with SessionExpiredError when the refresh token itself has expired", async () => {
    const getSession = vi.fn((cb: (err: Error | null, session: SessionLike | null) => void) =>
      cb(new Error("Refresh Token has expired"), null),
    );
    const user: CognitoUserLike = { getSession };
    const getValidIdToken = createIdTokenResolver(() => user);

    await expect(getValidIdToken()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("rejects with SessionExpiredError when getSession returns an invalid session without an error", async () => {
    const getSession = vi.fn((cb: (err: Error | null, session: SessionLike | null) => void) =>
      cb(null, fakeSession("stale-token", false)),
    );
    const user: CognitoUserLike = { getSession };
    const getValidIdToken = createIdTokenResolver(() => user);

    await expect(getValidIdToken()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("rejects with SessionExpiredError when there is no signed-in user at all", async () => {
    const getValidIdToken = createIdTokenResolver(() => null);
    await expect(getValidIdToken()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("de-dupes concurrent callers into a single in-flight request (no retry stampede)", async () => {
    const getSession = vi.fn((cb: (err: Error | null, session: SessionLike | null) => void) => {
      // Simulate an async network round-trip so overlapping calls are possible.
      setTimeout(() => cb(null, fakeSession("shared-token")), 5);
    });
    const user: CognitoUserLike = { getSession };
    const getValidIdToken = createIdTokenResolver(() => user);

    const [a, b, c] = await Promise.all([getValidIdToken(), getValidIdToken(), getValidIdToken()]);

    expect(a).toBe("shared-token");
    expect(b).toBe("shared-token");
    expect(c).toBe("shared-token");
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh request after a previous one has settled (no infinite loop, but no permanent lockout either)", async () => {
    const getSession = vi
      .fn<CognitoUserLike["getSession"]>()
      .mockImplementationOnce((cb) => cb(new Error("expired"), null))
      .mockImplementationOnce((cb) => cb(null, fakeSession("second-attempt-token")));
    const user: CognitoUserLike = { getSession };
    const getValidIdToken = createIdTokenResolver(() => user);

    await expect(getValidIdToken()).rejects.toBeInstanceOf(SessionExpiredError);
    // A second, later call (e.g. after the user signs in again) tries again
    // rather than replaying the same rejected in-flight promise forever.
    await expect(getValidIdToken()).resolves.toBe("second-attempt-token");
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("SessionExpiredError carries a clear, actionable message", () => {
    const error = new SessionExpiredError();
    expect(error.message).toMatch(/sign in again/i);
  });
});
