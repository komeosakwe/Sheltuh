"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { AccountRef } from "./account";
import { oauthCallbackUrl, oauthQueryParams, type OAuthProvider } from "./oauth";
import { accessTokenFor, createSessionResolver, SessionExpiredError } from "./session-token";
import { announceUserSignOut, endsSession, lastUserSignOut, onUserSignOut } from "./sign-out-signal";

// Re-exported so components can `import { SessionExpiredError } from
// "@/lib/auth/AuthContext"` alongside `useAuth` without a second import.
export { SessionExpiredError };

type AuthStatus = "loading" | "signed-out" | "signed-in";

export type SignOutScope = "global" | "local";

/**
 * How the last session ended: `"user"`, the person's own Sign out (in this
 * tab or another, lib/auth/sign-out-signal.ts); `"session"`, anything else
 * (it expired, its refresh token was revoked, a refused sign-in was signed
 * out locally, or there was never one here).
 */
export type SignedOutBy = "user" | "session";

interface AuthState {
  status: AuthStatus;
  /** Supabase's user id: the stable way to tell one account from another (an email can change). */
  userId?: string;
  email?: string;
  /**
   * When this session was signed in (Supabase's `user.last_sign_in_at`): it
   * changes with each new sign-in and isn't expected to change with a token
   * refresh (Supabase sets it when signing in), so it marks a sign-in
   * boundary (InlineReauth). Absent when signed out.
   */
  lastSignInAt?: string;
  accessToken?: string;
  /** UI hint only (e.g. showing the admin nav link) — the API re-checks it on every request. */
  isAdmin: boolean;
  /**
   * How this account can sign in ("email", "google", "apple"), from
   * Supabase's `app_metadata.providers`. Display only; absent when signed out.
   */
  providers?: string[];
  /**
   * While signed out: whether that was the person's own Sign out (`"user"`:
   * a page clears any form it was keeping on screen) or not (`"session"`: it
   * keeps it, to be finished after signing in again). Absent when signed in.
   */
  signedOutBy?: SignedOutBy;
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
  /**
   * Starts signing in with Google or Apple: the browser leaves for the
   * provider and comes back to /auth/callback, carrying a safe `next`
   * (lib/auth/oauth.ts). Resolves as the page starts to leave; rejects if
   * the sign-in can't be started.
   */
  signInWithProvider: (provider: OAuthProvider, next?: string) => Promise<void>;
  /**
   * Exchanges the code /auth/callback was sent back with for a session (once:
   * a code is single use). Rejects with Supabase's own AuthError, so its
   * `code` (e.g. "flow_state_expired") is kept for lib/auth/oauth.ts to explain.
   * `flowId`: the callback URL's `sb_flow_id`, if it has one (it picks this
   * flow's verifier when several sign-ins were started). auth-js adds it only
   * with its experimental `appendPkceFlowIdToRedirects` option, which we
   * don't turn on, so normally it's absent.
   */
  completeOAuthSignIn: (code: string, flowId?: string) => Promise<void>;
  /**
   * An account invite's "Create account" (components/invites): verifies the
   * sign-up token hash POST /api/invites/account-link returned
   * (`verifyOtp`, type `invite`), which confirms the address and signs the
   * new account in. Rejects with Supabase's own AuthError, so its `code`
   * (e.g. "otp_expired") is kept for the page to explain.
   */
  verifyInvite: (tokenHash: string) => Promise<void>;
  /**
   * Sets the signed-in account's password, then signs out every other
   * session it has (`scope: "others"`; this one stays), so nothing signed in
   * before the password was chosen keeps access. Safe to call again after a
   * failure: a password that's already `password` (Supabase's
   * "same_password") goes on to the sign-out. Rejects with Supabase's own
   * AuthError (e.g. "weak_password").
   */
  setNewPassword: (password: string) => Promise<void>;
  /**
   * Signs out. `"global"` (the default) is the person's own Sign out: it ends
   * every session this account has, on every device, and first tells every
   * tab here that it was deliberate (`signedOutBy: "user"`), so none keeps a
   * form on screen for it. `"local"` ends only this browser's (which every
   * tab here shares), for refusing a sign-in made by mistake without signing
   * the account out elsewhere; that isn't the person's own sign-out
   * (`"session"`), so a form kept for the expected account stays.
   */
  signOut: (scope?: SignOutScope) => void;
  refresh: () => Promise<void>;
  /**
   * Resolves a currently-valid access token, refreshing it first if the
   * cached one has expired. Call this immediately before every
   * authenticated request rather than reading `accessToken` from state,
   * which can go stale for anyone who leaves a page open. Rejects with
   * `SessionExpiredError` if there's no session left to refresh.
   */
  getAccessToken: () => Promise<string>;
  /**
   * `getAccessToken`, for `account` only: the session is read when this is
   * called (not from React state, which lags a sign-in in another tab), and
   * if it's anyone else's this rejects with `SessionExpiredError` rather than
   * hand over their token. lib/auth/useAccountOwner.ts binds it to a form's owner.
   */
  getAccessTokenFor: (account: AccountRef) => Promise<string>;
}

// Exported (in addition to useAuth) so tests can render a component tree
// under a fully-controlled fake auth value via `<AuthContext.Provider>`,
// without a real Supabase project.
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const SIGNED_OUT: AuthState = { status: "signed-out", isAdmin: false, signedOutBy: "session" };

function providersOf(session: Session): string[] | undefined {
  const providers: unknown = session.user.app_metadata?.providers;
  if (!Array.isArray(providers)) return undefined;
  return providers.filter((p): p is string => typeof p === "string");
}

function sessionToState(session: Session | null, signedOutBy: SignedOutBy = "session"): AuthState {
  if (!session) return signedOutBy === "user" ? { ...SIGNED_OUT, signedOutBy } : SIGNED_OUT;
  return {
    status: "signed-in",
    userId: session.user.id,
    email: session.user.email,
    lastSignInAt: session.user.last_sign_in_at,
    accessToken: session.access_token,
    isAdmin: session.user.app_metadata?.role === "admin",
    providers: providersOf(session),
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

  // The session this tab last saw, and when it first saw it (this device's
  // clock): a sign-out recorded since then by its own account is that
  // person signing themselves out (lib/auth/sign-out-signal.ts).
  const seen = useRef<{ key: string; userId: string; since: number } | null>(null);
  // This tab's own Sign out is under way (in case storage is unavailable).
  const signingOut = useRef(false);

  /** The state for `session`: for none, whether the one seen last ended by its owner's own Sign out. */
  const toState = useCallback((session: Session | null): AuthState => {
    if (session) {
      const key = `${session.user.id}\n${session.user.last_sign_in_at ?? ""}`;
      if (seen.current?.key !== key) seen.current = { key, userId: session.user.id, since: Date.now() };
      signingOut.current = false;
      return sessionToState(session);
    }
    const last = seen.current;
    const byUser = signingOut.current || (last !== null && endsSession(lastUserSignOut(), last.userId, last.since));
    return sessionToState(null, byUser ? "user" : "session");
  }, []);

  // Every sign-in, sign-out and token refresh — in this tab or another —
  // arrives through this one subscription, including the initial session.
  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setState(toState(session));
    });
    return () => data.subscription.unsubscribe();
  }, [toState]);

  // Another tab's Sign out, heard after Supabase's sign-out had already reached this one.
  useEffect(
    () =>
      onUserSignOut((signal) => {
        const last = seen.current;
        if (!last || !endsSession(signal, last.userId, last.since)) return;
        setState((prev) => (prev.status === "signed-out" && prev.signedOutBy !== "user" ? { ...prev, signedOutBy: "user" } : prev));
      }),
    [],
  );

  const refresh = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { data } = await client.auth.getSession();
    setState(toState(data.session));
  }, [toState]);

  // Created once so its in-flight de-dup works across renders.
  const [resolveSession] = useState(() =>
    createSessionResolver(async () => {
      const client = getSupabaseBrowserClient();
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return data.session;
    }),
  );
  const getAccessToken = useCallback(() => resolveSession().then((session) => session.access_token), [resolveSession]);
  const getAccessTokenFor = useCallback(
    (account: AccountRef) => resolveSession().then((session) => accessTokenFor(session, account)),
    [resolveSession],
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

  const signInWithProvider = useCallback(async (provider: OAuthProvider, next?: string) => {
    const { error } = await requireClient().auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: oauthCallbackUrl(window.location.origin, next),
        queryParams: oauthQueryParams(provider),
      },
    });
    throwIfError(error);
  }, []);

  // Not throwIfError: that would drop the AuthError's `code`.
  const completeOAuthSignIn = useCallback(async (code: string, flowId?: string) => {
    const client = requireClient();
    const { error } = await (flowId ? client.auth.exchangeCodeForSession(code, { flowId }) : client.auth.exchangeCodeForSession(code));
    if (error) throw error;
  }, []);

  // Not throwIfError: that would drop the AuthError's `code`.
  const verifyInvite = useCallback(async (tokenHash: string) => {
    const { error } = await requireClient().auth.verifyOtp({ token_hash: tokenHash, type: "invite" });
    if (error) throw error;
  }, []);

  const setNewPassword = useCallback(async (password: string) => {
    const client = requireClient();
    const updated = await client.auth.updateUser({ password });
    if (updated.error && updated.error.code !== "same_password") throw updated.error;
    const others = await client.auth.signOut({ scope: "others" });
    if (others.error) throw others.error;
  }, []);

  const signOut = useCallback((scope: SignOutScope = "global") => {
    const byUser = scope === "global";
    if (byUser) {
      // Before Supabase's sign-out reaches the other tabs, so they can tell it was deliberate.
      signingOut.current = true;
      if (seen.current) announceUserSignOut(seen.current.userId);
    }
    void getSupabaseBrowserClient()?.auth.signOut({ scope });
    setState(sessionToState(null, byUser ? "user" : "session"));
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
      signInWithProvider,
      completeOAuthSignIn,
      verifyInvite,
      setNewPassword,
      signOut,
      refresh,
      getAccessToken,
      getAccessTokenFor,
    }),
    [
      state,
      signIn,
      signUp,
      confirmSignUp,
      resendConfirmationCode,
      forgotPassword,
      confirmForgotPassword,
      signInWithProvider,
      completeOAuthSignIn,
      verifyInvite,
      setNewPassword,
      signOut,
      refresh,
      getAccessToken,
      getAccessTokenFor,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider.");
  return ctx;
}
