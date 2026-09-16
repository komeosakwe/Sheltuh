"use client";

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getUserPool, isAuthConfigured } from "./cognito-config";
import { decodeJwtPayload, getGroupsFromClaims } from "./jwt";

type AuthStatus = "loading" | "signed-out" | "signed-in";

interface AuthState {
  status: AuthStatus;
  email?: string;
  idToken?: string;
  groups: string[];
}

interface AuthContextValue extends AuthState {
  configured: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendConfirmationCode: (email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  confirmForgotPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function sessionToState(session: CognitoUserSession): AuthState {
  const idToken = session.getIdToken().getJwtToken();
  const claims = decodeJwtPayload<Record<string, unknown>>(idToken);
  return {
    status: "signed-in",
    email: typeof claims?.email === "string" ? claims.email : undefined,
    idToken,
    groups: getGroupsFromClaims(claims),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: isAuthConfigured ? "loading" : "signed-out",
    groups: [],
  });

  // Used to re-check the session after an explicit user action (sign in,
  // sign out) — never called directly from an effect body, see below.
  const refresh = useCallback(async () => {
    const pool = getUserPool();
    const cognitoUser = pool?.getCurrentUser();
    if (!pool || !cognitoUser) {
      setState({ status: "signed-out", groups: [] });
      return;
    }
    await new Promise<void>((resolve) => {
      cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          setState({ status: "signed-out", groups: [] });
        } else {
          setState(sessionToState(session));
        }
        resolve();
      });
    });
  }, []);

  // Mount-time session check, written inline (rather than calling `refresh`)
  // so every setState here happens from the SDK's own async callback — the
  // "subscribe to an external system" pattern effects are meant for.
  useEffect(() => {
    if (!isAuthConfigured) return;
    let cancelled = false;

    const pool = getUserPool();
    const cognitoUser = pool?.getCurrentUser();
    if (!pool || !cognitoUser) {
      queueMicrotask(() => {
        if (!cancelled) setState({ status: "signed-out", groups: [] });
      });
      return () => {
        cancelled = true;
      };
    }

    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (cancelled) return;
      if (err || !session || !session.isValid()) {
        setState({ status: "signed-out", groups: [] });
      } else {
        setState(sessionToState(session));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const pool = getUserPool();
      if (!pool) throw new Error("Sign-in isn't configured in this environment.");
      await new Promise<void>((resolve, reject) => {
        const cognitoUser = new CognitoUser({ Username: email, Pool: pool });
        cognitoUser.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
          onSuccess: () => resolve(),
          onFailure: (err) => reject(err),
        });
      });
      await refresh();
    },
    [refresh],
  );

  const signUp = useCallback(async (email: string, password: string) => {
    const pool = getUserPool();
    if (!pool) throw new Error("Sign-up isn't configured in this environment.");
    await new Promise<void>((resolve, reject) => {
      pool.signUp(email, password, [new CognitoUserAttribute({ Name: "email", Value: email })], [], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }, []);

  const confirmSignUp = useCallback(async (email: string, code: string) => {
    const pool = getUserPool();
    if (!pool) throw new Error("Sign-up isn't configured in this environment.");
    await new Promise<void>((resolve, reject) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: pool });
      cognitoUser.confirmRegistration(code, true, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }, []);

  const resendConfirmationCode = useCallback(async (email: string) => {
    const pool = getUserPool();
    if (!pool) throw new Error("Sign-up isn't configured in this environment.");
    await new Promise<void>((resolve, reject) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: pool });
      cognitoUser.resendConfirmationCode((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    const pool = getUserPool();
    if (!pool) throw new Error("Password reset isn't configured in this environment.");
    await new Promise<void>((resolve, reject) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: pool });
      cognitoUser.forgotPassword({ onSuccess: () => resolve(), onFailure: (err) => reject(err) });
    });
  }, []);

  const confirmForgotPassword = useCallback(async (email: string, code: string, newPassword: string) => {
    const pool = getUserPool();
    if (!pool) throw new Error("Password reset isn't configured in this environment.");
    await new Promise<void>((resolve, reject) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: pool });
      cognitoUser.confirmPassword(code, newPassword, { onSuccess: () => resolve(), onFailure: (err) => reject(err) });
    });
  }, []);

  const signOut = useCallback(() => {
    const pool = getUserPool();
    pool?.getCurrentUser()?.signOut();
    setState({ status: "signed-out", groups: [] });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      configured: isAuthConfigured,
      isAdmin: state.groups.includes("admins"),
      signIn,
      signUp,
      confirmSignUp,
      resendConfirmationCode,
      forgotPassword,
      confirmForgotPassword,
      signOut,
      refresh,
    }),
    [state, signIn, signUp, confirmSignUp, resendConfirmationCode, forgotPassword, confirmForgotPassword, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider.");
  return ctx;
}
