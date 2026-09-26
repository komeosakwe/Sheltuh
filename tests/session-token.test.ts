import { describe, expect, it, vi } from "vitest";
import { createAccessTokenResolver, SessionExpiredError, type SessionLike } from "../lib/auth/session-token";

const session = (token: string): SessionLike => ({ access_token: token });

describe("createAccessTokenResolver", () => {
  it("resolves the current session's access token", async () => {
    const getSession = vi.fn().mockResolvedValue(session("valid-token"));
    const getAccessToken = createAccessTokenResolver(getSession);

    await expect(getAccessToken()).resolves.toBe("valid-token");
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("resolves the freshly-refreshed token when the cached one had expired", async () => {
    // Supabase's getSession() swaps an expired access token for a new one
    // via the refresh token before resolving — from the caller's side that's
    // indistinguishable from "just give me a valid session".
    const getAccessToken = createAccessTokenResolver(vi.fn().mockResolvedValue(session("refreshed-token")));
    await expect(getAccessToken()).resolves.toBe("refreshed-token");
  });

  it("rejects with SessionExpiredError when there is no session", async () => {
    const getAccessToken = createAccessTokenResolver(vi.fn().mockResolvedValue(null));
    await expect(getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("rejects with SessionExpiredError when the refresh itself fails", async () => {
    const getAccessToken = createAccessTokenResolver(vi.fn().mockRejectedValue(new Error("Invalid Refresh Token")));
    await expect(getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("de-dupes concurrent callers into a single in-flight request (no retry stampede)", async () => {
    const getSession = vi.fn(
      () => new Promise<SessionLike>((resolve) => setTimeout(() => resolve(session("shared-token")), 5)),
    );
    const getAccessToken = createAccessTokenResolver(getSession);

    const tokens = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);

    expect(tokens).toEqual(["shared-token", "shared-token", "shared-token"]);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh request after a previous one has settled (no permanent lockout)", async () => {
    const getSession = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(session("second-attempt-token"));
    const getAccessToken = createAccessTokenResolver(getSession);

    await expect(getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    // A later call (e.g. after signing in again) tries again rather than
    // replaying the rejected promise forever.
    await expect(getAccessToken()).resolves.toBe("second-attempt-token");
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("SessionExpiredError carries a clear, actionable message", () => {
    expect(new SessionExpiredError().message).toMatch(/sign in again/i);
  });
});
