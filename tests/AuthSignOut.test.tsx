// @vitest-environment jsdom
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, SessionExpiredError, useAuth, type AuthContextValue } from "@/lib/auth/AuthContext";
import { announceUserSignOut, endsSession, lastUserSignOut, onUserSignOut } from "@/lib/auth/sign-out-signal";

// A stand-in for the Supabase browser client: only what AuthProvider calls.
let listener: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
let stored: Session | null = null;
const signOut = vi.fn().mockResolvedValue({ error: null });
const client = {
  auth: {
    onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    // What's in storage right now (shared by every tab): read when called.
    getSession: async () => ({ data: { session: stored } }),
    signOut,
  },
};
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/supabase/browser", () => ({ getSupabaseBrowserClient: () => client }));

function session(userId: string, lastSignInAt = "2026-10-25T09:00:00Z"): Session {
  const value: Pick<Session, "access_token" | "refresh_token" | "expires_in" | "token_type"> & {
    user: Pick<Session["user"], "id" | "email" | "last_sign_in_at" | "app_metadata" | "user_metadata" | "aud" | "created_at">;
  } = {
    access_token: `${userId}-token`,
    refresh_token: "r",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: userId,
      email: `${userId}@example.com`,
      last_sign_in_at: lastSignInAt,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    },
  };
  return value as Session;
}

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

/** Supabase telling this tab about a session (or its end), as it does for every tab. */
function supabaseSays(next: Session | null) {
  stored = next;
  act(() => listener?.(next ? "SIGNED_IN" : "SIGNED_OUT", next));
}

beforeEach(() => {
  localStorage.clear();
  stored = null;
  signOut.mockClear();
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
  vi.unstubAllGlobals();
});

describe("AuthProvider: signedOutBy (was it the person's own Sign out?)", () => {
  it("the person's own Sign out (global, the default): recorded for every tab before Supabase is asked, and 'user'", () => {
    supabaseSays(session("user-a"));
    signOut.mockImplementationOnce(async () => {
      // Recorded first, so other tabs can already tell when Supabase's sign-out reaches them.
      expect(lastUserSignOut()).toMatchObject({ userId: "user-a" });
      return { error: null };
    });
    act(() => current().signOut());
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(current()).toMatchObject({ status: "signed-out", signedOutBy: "user" });
    // Supabase's own sign-out event arriving afterwards doesn't change that.
    supabaseSays(null);
    expect(current().signedOutBy).toBe("user");
  });

  it("a local sign-out (refusing a wrong-account sign-in) isn't the person's own: 'session', and nothing is recorded", () => {
    supabaseSays(session("user-a"));
    act(() => current().signOut("local"));
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(current().signedOutBy).toBe("session");
    expect(lastUserSignOut()).toBeNull();
  });

  it("a session that ends by itself (expiry, a revoked refresh token) is 'session'", () => {
    supabaseSays(session("user-a"));
    supabaseSays(null);
    expect(current()).toMatchObject({ status: "signed-out", signedOutBy: "session" });
  });

  it("another tab's Sign out, recorded before Supabase's sign-out reaches this tab, is 'user' here too", () => {
    supabaseSays(session("user-a"));
    announceUserSignOut("user-a");
    supabaseSays(null);
    expect(current().signedOutBy).toBe("user");
  });

  it("another tab's Sign out heard after Supabase's sign-out (BroadcastChannel) turns 'session' into 'user'", async () => {
    supabaseSays(session("user-a"));
    // Simulate Supabase's event winning the race: nothing recorded yet.
    supabaseSays(null);
    expect(current().signedOutBy).toBe("session");
    // The other tab's message (no storage write this time, as if storage were unavailable there).
    const channel = new BroadcastChannel("sheltuh-auth");
    channel.postMessage({ userId: "user-a", at: Date.now() });
    channel.close();
    await waitFor(() => expect(current().signedOutBy).toBe("user"));
  });

  it("a Sign out recorded before this session began (signed out, then in again) doesn't explain its later expiry", () => {
    announceUserSignOut("user-a", Date.now() - 60_000);
    supabaseSays(session("user-a", "2026-10-25T10:00:00Z"));
    supabaseSays(null);
    expect(current().signedOutBy).toBe("session");
  });

  it("another account's recorded Sign out doesn't count for this one", () => {
    supabaseSays(session("user-a"));
    announceUserSignOut("user-b");
    supabaseSays(null);
    expect(current().signedOutBy).toBe("session");
  });
});

describe("AuthProvider: getAccessTokenFor reads the session when it's called", () => {
  it("resolves the token only while the stored session is that account's, whatever React last rendered", async () => {
    supabaseSays(session("user-a"));
    await expect(current().getAccessTokenFor({ userId: "user-a" })).resolves.toBe("user-a-token");
    // Another tab signs in as B: storage has B's session before this tab's state says so.
    stored = session("user-b");
    expect(current().userId).toBe("user-a");
    await expect(current().getAccessTokenFor({ userId: "user-a" })).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(current().getAccessTokenFor({ userId: "user-b" })).resolves.toBe("user-b-token");
    stored = null;
    await expect(current().getAccessTokenFor({ userId: "user-a" })).rejects.toBeInstanceOf(SessionExpiredError);
  });
});

describe("sign-out-signal", () => {
  it("endsSession: the same account, recorded at or after the session was first seen", () => {
    expect(endsSession({ userId: "a", at: 100 }, "a", 100)).toBe(true);
    expect(endsSession({ userId: "a", at: 99 }, "a", 100)).toBe(false);
    expect(endsSession({ userId: "b", at: 200 }, "a", 100)).toBe(false);
    expect(endsSession(null, "a", 100)).toBe(false);
    expect(endsSession({ userId: "a", at: 200 }, undefined, 100)).toBe(false);
  });

  it("ignores a damaged or foreign stored value", () => {
    localStorage.setItem("sheltuh:user-sign-out", "{not json");
    expect(lastUserSignOut()).toBeNull();
    localStorage.setItem("sheltuh:user-sign-out", JSON.stringify({ userId: 1, at: "x" }));
    expect(lastUserSignOut()).toBeNull();
  });

  it("without BroadcastChannel, another tab's sign-out arrives by the storage event", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const heard = vi.fn();
    const stop = onUserSignOut(heard);
    announceUserSignOut("user-a", 5);
    // A storage event only reaches *other* tabs: dispatch the one they'd get.
    window.dispatchEvent(
      new StorageEvent("storage", { key: "sheltuh:user-sign-out", newValue: localStorage.getItem("sheltuh:user-sign-out") }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "something-else", newValue: "{}" }));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith({ userId: "user-a", at: 5 });
    stop();
  });
});
