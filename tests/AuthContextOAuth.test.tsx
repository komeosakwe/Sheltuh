// @vitest-environment jsdom
import { AuthApiError, type AuthChangeEvent, type Session } from "@supabase/supabase-js";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, OtherSessionsSignOutError, useAuth, type AuthContextValue } from "@/lib/auth/AuthContext";

// A stand-in for the Supabase browser client: only what AuthProvider calls.
let listener: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
const signInWithOAuth = vi.fn();
const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn().mockResolvedValue({ error: null });
const client = {
  auth: {
    onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    getSession: async () => ({ data: { session: null } }),
    signInWithOAuth,
    exchangeCodeForSession,
    verifyOtp,
    updateUser,
    signOut,
  },
};
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/supabase/browser", () => ({ getSupabaseBrowserClient: () => client }));

// The latest context value, recorded after each render.
const captured: { value?: AuthContextValue } = {};
function Probe() {
  const auth = useAuth();
  useEffect(() => {
    captured.value = auth;
  });
  return null;
}
function current(): AuthContextValue {
  if (!captured.value) throw new Error("AuthProvider didn't render");
  return captured.value;
}

beforeEach(() => {
  signInWithOAuth.mockReset().mockResolvedValue({ data: { provider: "google", url: "https://x", flowId: null }, error: null });
  exchangeCodeForSession.mockReset();
  verifyOtp.mockReset();
  updateUser.mockReset();
  signOut.mockReset().mockResolvedValue({ error: null });
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
});
afterEach(() => {
  cleanup();
  captured.value = undefined;
  listener = undefined;
});

describe("AuthProvider: signInWithProvider", () => {
  it("sends Google back to this origin's /auth/callback with the safe next, and asks which account", async () => {
    await current().signInWithProvider("google", "/events/neon-static#whos-going");
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/events/neon-static#whos-going")}`,
        queryParams: { prompt: "select_account" },
      },
    });
  });

  it("sends Apple without extra parameters, and drops an unsafe next", async () => {
    await current().signInWithProvider("apple", "//evil.example");
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: undefined },
    });
  });

  it("rejects when the sign-in can't be started", async () => {
    signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: null }, error: new AuthApiError("nope", 500, undefined) });
    await expect(current().signInWithProvider("google")).rejects.toThrow("nope");
  });
});

describe("AuthProvider: completeOAuthSignIn", () => {
  it("exchanges the code", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
    await current().completeOAuthSignIn("abc");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it("names the flow when the callback had one (sb_flow_id)", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
    await current().completeOAuthSignIn("abc", "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc", { flowId: "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d" });
  });

  it("rejects with Supabase's own AuthError, keeping its code", async () => {
    const error = new AuthApiError("Flow state has expired", 403, "flow_state_expired");
    exchangeCodeForSession.mockResolvedValue({ data: { session: null, user: null }, error });
    await expect(current().completeOAuthSignIn("abc")).rejects.toBe(error);
    await expect(current().completeOAuthSignIn("abc")).rejects.toMatchObject({ code: "flow_state_expired" });
  });
});

describe("AuthProvider: verifyInvite", () => {
  it("verifies the invite's sign-up token hash (type invite)", async () => {
    verifyOtp.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
    await current().verifyInvite("hashed-token-abc");
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hashed-token-abc", type: "invite" });
  });

  it("rejects with Supabase's own AuthError, keeping its code (otp_expired)", async () => {
    const error = new AuthApiError("Email link is invalid or has expired", 403, "otp_expired");
    verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error });
    await expect(current().verifyInvite("x")).rejects.toBe(error);
    await expect(current().verifyInvite("x")).rejects.toMatchObject({ code: "otp_expired" });
  });
});

describe("AuthProvider: setNewPassword", () => {
  it("sets the password, then signs out every other session (this one stays)", async () => {
    updateUser.mockResolvedValue({ data: { user: {} }, error: null });
    await current().setNewPassword("Secret123");
    expect(updateUser).toHaveBeenCalledWith({ password: "Secret123" });
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(updateUser.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
  });

  it("rejects with the AuthError and signs nothing out when the password is refused", async () => {
    const error = new AuthApiError("Password is too weak", 422, "weak_password");
    updateUser.mockResolvedValue({ data: { user: null }, error });
    await expect(current().setNewPassword("weak")).rejects.toBe(error);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("goes on to the sign-out when the password is already set to it (a retry)", async () => {
    updateUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("Same", 422, "same_password") });
    await current().setNewPassword("Secret123");
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("rejects when signing out the other sessions fails, saying the password itself was saved", async () => {
    updateUser.mockResolvedValue({ data: { user: {} }, error: null });
    const error = new AuthApiError("Server error", 500, "unexpected_failure");
    signOut.mockResolvedValue({ error });
    const rejected = current().setNewPassword("Secret123");
    await expect(rejected).rejects.toBeInstanceOf(OtherSessionsSignOutError);
    await expect(rejected).rejects.toMatchObject({ cause: error });
  });
});

describe("AuthProvider: the account and its sign-in", () => {
  function session(user: Partial<Session["user"]>, accessToken = "token"): Session {
    return {
      access_token: accessToken,
      refresh_token: "refresh",
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "u1", email: "a@example.com", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "", ...user },
    };
  }

  it("exposes the user id and when this session was signed in (a refresh keeps it), none when signed out", () => {
    act(() => listener?.("SIGNED_IN", session({ id: "u1", last_sign_in_at: "2026-10-25T10:00:00Z" })));
    expect(current()).toMatchObject({ userId: "u1", email: "a@example.com", lastSignInAt: "2026-10-25T10:00:00Z" });
    act(() => listener?.("TOKEN_REFRESHED", session({ id: "u1", last_sign_in_at: "2026-10-25T10:00:00Z" }, "token-2")));
    expect(current()).toMatchObject({ accessToken: "token-2", lastSignInAt: "2026-10-25T10:00:00Z" });
    act(() => listener?.("SIGNED_OUT", null));
    expect(current().userId).toBeUndefined();
    expect(current().lastSignInAt).toBeUndefined();
  });
});

describe("AuthProvider: signOut", () => {
  it("ends every session by default (the person's own Sign out), or only this browser's when asked", () => {
    act(() => current().signOut());
    expect(signOut).toHaveBeenLastCalledWith({ scope: "global" });
    act(() => current().signOut("local"));
    expect(signOut).toHaveBeenLastCalledWith({ scope: "local" });
    expect(current().status).toBe("signed-out");
  });
});

describe("AuthProvider: providers", () => {
  function session(appMetadata: Record<string, unknown>): Session {
    return {
      access_token: "token",
      refresh_token: "refresh",
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "u1", email: "a@example.com", app_metadata: appMetadata, user_metadata: {}, aud: "authenticated", created_at: "" },
    };
  }

  it("lists how the account signs in, from app_metadata.providers", () => {
    act(() => listener?.("SIGNED_IN", session({ provider: "email", providers: ["email", "google", 7] })));
    expect(current().status).toBe("signed-in");
    expect(current().providers).toEqual(["email", "google"]);
  });

  it("is absent without the list, and when signed out", () => {
    act(() => listener?.("SIGNED_IN", session({ provider: "email" })));
    expect(current().providers).toBeUndefined();
    act(() => listener?.("SIGNED_OUT", null));
    expect(current().providers).toBeUndefined();
  });
});
