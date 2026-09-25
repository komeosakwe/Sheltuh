import { vi } from "vitest";
import { AuthContext, type AuthContextValue } from "@/lib/auth/AuthContext";

/** A fully-controllable signed-in auth value for mounting components without a real Cognito user pool. */
export function fakeAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: "signed-in",
    email: "organiser@example.com",
    idToken: "fake-id-token",
    groups: [],
    configured: true,
    isAdmin: false,
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(undefined),
    confirmSignUp: vi.fn().mockResolvedValue(undefined),
    resendConfirmationCode: vi.fn().mockResolvedValue(undefined),
    forgotPassword: vi.fn().mockResolvedValue(undefined),
    confirmForgotPassword: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    getValidIdToken: vi.fn().mockResolvedValue("fake-id-token"),
    ...overrides,
  };
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
