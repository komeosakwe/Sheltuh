"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createAccessTokenResolver, SessionExpiredError } from "./session-token";

// Re-exported so components can `import { SessionExpiredError } from
// "@/lib/auth/AuthContext"` alongside `useAuth` without a second import.
export { SessionExpiredError };

type AuthStatus = "loading" | "signed-out" | "signed-in";

interface AuthState {
  status: AuthStatus;
  email?: string;
  accessToken?: string;
  /** UI hint only (e.g. showing the admin nav link) — the API re-checks it on every request. */
  isAdmin: boolean;
}

export interface AuthContextValue extends AuthState {
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  /** Confirms a new account with the code from its confirmation email, which also signs it in. */
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendConfirmationCode: (email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  confirmForgotPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
  /**
   * Resolves a currently-valid access token, refreshing it first if the
   * cached one has expired. Call this immediately before every
   * authenticated request rather than reading `accessToken` from state,
   * which can go stale for anyone who leaves a page open. Rejects with
   * `SessionExpiredError` if there's no session left to refresh.
   */
  getAccessToken: () => Promise<string>;
}

// Exported (in addition to useAuth) so tests can render a component tree
// under a fully-controlled fake auth value via `<AuthContext.Provider>`,
// without a real Supabase project.
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const SIGNED_OUT: AuthState = { status: "signed-out", isAdmin: false };

function sessionToState(session: Session | null): AuthState {
  if (!session) return SIGNED_OUT;
  return {
    status: "signed-in",
    email: session.user.email,
    accessToken: session.access_token,
    isAdmin: session.user.app_metadata?.role === "admin",
  };
}

function requireClient() {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Accounts aren't configured in this environment.");
  return client;
}

/** Supabase reports failures as `{ error }` rather than throwing. */
function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(
    isSupabaseConfigured ? { status: "loading", isAdmin: false } : SIGNED_OUT,
  );

  // Every sign-in, sign-out and token refresh — in this tab or another —
  // arrives through this one subscription, including the initial session.
  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setState(sessionToState(session));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { data } = await client.auth.getSession();
    setState(sessionToState(data.session));
  }, []);

  // Created once so its in-flight de-dup works across renders.
  const [getAccessToken] = useState(() =>
    createAccessTokenResolver(async () => {
      const client = getSupabaseBrowserClient();
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return data.session;
    }),
  );

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await requireClient().auth.signInWithPassword({ email, password });
    throwIfError(error);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await requireClient().auth.signUp({ email, password });
    throwIfError(error);
  }, []);

  const confirmSignUp = useCallback(async (email: string, code: string) => {
    const { error } = await requireClient().auth.verifyOtp({ email, token: code.trim(), type: "signup" });
    throwIfError(error);
  }, []);

  const resendConfirmationCode = useCallback(async (email: string) => {
    const { error } = await requireClient().auth.resend({ type: "signup", email });
    throwIfError(error);
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    const { error } = await requireClient().auth.resetPasswordForEmail(email);
    throwIfError(error);
  }, []);

  // The recovery code signs the user in; the new password is then set on
  // that session, which is ended so they sign in fresh with it.
  const confirmForgotPassword = useCallback(async (email: string, code: string, newPassword: string) => {
    const client = requireClient();
    const verified = await client.auth.verifyOtp({ email, token: code.trim(), type: "recovery" });
    throwIfError(verified.error);
    const updated = await client.auth.updateUser({ password: newPassword });
    throwIfError(updated.error);
    await client.auth.signOut();
  }, []);

  const signOut = useCallback(() => {
    void getSupabaseBrowserClient()?.auth.signOut();
    setState(SIGNED_OUT);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      configured: isSupabaseConfigured,
      signIn,
      signUp,
      confirmSignUp,
      resendConfirmationCode,
      forgotPassword,
      confirmForgotPassword,
      signOut,
      refresh,
      getAccessToken,
    }),
    [
      state,
      signIn,
      signUp,
      confirmSignUp,
      resendConfirmationCode,
      forgotPassword,
      confirmForgotPassword,
      signOut,
      refresh,
      getAccessToken,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider.");
  return ctx;
}
