import { vi } from "vitest";
import { sameAccount, type AccountRef } from "@/lib/auth/account";
import { AuthContext, SessionExpiredError, type AuthContextValue } from "@/lib/auth/AuthContext";

/**
 * A fully-controllable signed-in auth value for mounting components without a real Supabase project.
 * Its `getAccessTokenFor` (unless overridden) is `getAccessToken` for this value's own account,
 * and `SessionExpiredError` for anyone else's (or when signed out), as the real one is.
 */
export function fakeAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const value: AuthContextValue = {
    status: "signed-in",
    email: "organiser@example.com",
    accessToken: "fake-access-token",
    configured: true,
    isAdmin: false,
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(undefined),
    confirmSignUp: vi.fn().mockResolvedValue(undefined),
    resendConfirmationCode: vi.fn().mockResolvedValue(undefined),
    forgotPassword: vi.fn().mockResolvedValue(undefined),
    confirmForgotPassword: vi.fn().mockResolvedValue(undefined),
    signInWithProvider: vi.fn().mockResolvedValue(undefined),
    completeOAuthSignIn: vi.fn().mockResolvedValue(undefined),
    verifyInvite: vi.fn().mockResolvedValue(undefined),
    setNewPassword: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockResolvedValue("fake-access-token"),
    getAccessTokenFor: vi.fn(async (account: AccountRef) => {
      const live: AccountRef | undefined =
        value.status === "signed-in" ? { userId: value.userId, email: value.email } : undefined;
      if (!sameAccount(live, account)) throw new SessionExpiredError();
      return value.getAccessToken();
    }),
    ...overrides,
  };
  return value;
}

export function FakeAuthProvider({
  value,
  children,
}: {
  value: AuthContextValue;
  children: React.ReactNode;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * The stored session, which can change under a form mid-save (someone signs in
 * in another tab) before React re-renders: `getAccessTokenFor` reads it when
 * called, as AuthContext's does. Spread `auth` into fakeAuthValue's overrides.
 */
export function switchableSession(initial: AccountRef | undefined) {
  let live = initial;
  return {
    become(next: AccountRef | undefined) {
      live = next;
    },
    auth: {
      getAccessTokenFor: vi.fn(async (account: AccountRef) => {
        if (!sameAccount(live, account)) throw new SessionExpiredError();
        return `${live?.userId ?? live?.email}-token`;
      }),
    } satisfies Partial<AuthContextValue>,
  };
}

/** A mocked API call that, like the real ones (lib/api/client.ts), gets its token first: its last argument. */
export function callsTokenFirst<T>(result: T) {
  return async (...args: unknown[]): Promise<T> => {
    const getToken = args[args.length - 1];
    if (typeof getToken !== "function") throw new Error("No token getter passed");
    await (getToken as () => Promise<string>)();
    return result;
  };
}
