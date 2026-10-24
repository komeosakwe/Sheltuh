// @vitest-environment jsdom
import { AuthApiError, type AuthChangeEvent, type Session } from "@supabase/supabase-js";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth, type AuthContextValue } from "@/lib/auth/AuthContext";

// A stand-in for the Supabase browser client: only what AuthProvider calls.
let listener: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
const signInWithOAuth = vi.fn();
const exchangeCodeForSession = vi.fn();
const client = {
  auth: {
    onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    getSession: async () => ({ data: { session: null } }),
    signInWithOAuth,
    exchangeCodeForSession,
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

  it("rejects with Supabase's own AuthError, keeping its code", async () => {
    const error = new AuthApiError("Flow state has expired", 403, "flow_state_expired");
    exchangeCodeForSession.mockResolvedValue({ data: { session: null, user: null }, error });
    await expect(current().completeOAuthSignIn("abc")).rejects.toBe(error);
    await expect(current().completeOAuthSignIn("abc")).rejects.toMatchObject({ code: "flow_state_expired" });
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
