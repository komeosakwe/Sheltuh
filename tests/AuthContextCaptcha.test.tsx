// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "@/lib/auth/AuthContext";

/*
 * Cloudflare Turnstile's token reaching Supabase Auth: AuthProvider with the
 * real supabase-js browser client against a fake Supabase Auth (fetch
 * stubbed). The four calls CAPTCHA protection guards (password sign-in,
 * sign-up, password reset request, resend) send it as
 * gotrue_meta_security.captcha_token; without one they're sent as before;
 * and Supabase's captcha_failed becomes HumanCheckError's copy.
 */

const SUPABASE = "https://ref.supabase.test";
const USER = { id: "u1", aud: "authenticated", email: "a@example.com", app_metadata: {}, user_metadata: {}, created_at: "" };
const SESSION = { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer", user: USER };

type Call = { path: string; body: Record<string, unknown> | undefined };
let calls: Call[] = [];
let respond: (url: URL) => { status: number; json: unknown } = () => ({ status: 200, json: {} });

const captured: { value?: AuthContextValue } = {};

async function mountAuth(): Promise<AuthContextValue> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  const { AuthProvider, useAuth } = await import("@/lib/auth/AuthContext");
  function Probe() {
    const auth = useAuth();
    useEffect(() => {
      captured.value = auth;
    });
    return null;
  }
  await act(async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  });
  if (!captured.value) throw new Error("AuthProvider didn't render");
  return captured.value;
}

function bodyOf(prefix: string): Record<string, unknown> | undefined {
  return calls.find((call) => call.path.startsWith(prefix))?.body;
}

beforeEach(() => {
  localStorage.clear();
  calls = [];
  respond = (url) =>
    url.pathname === "/auth/v1/token" || url.pathname === "/auth/v1/signup"
      ? { status: 200, json: url.pathname === "/auth/v1/token" ? SESSION : { ...USER, confirmation_sent_at: "" } }
      : { status: 200, json: {} };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ path: url.pathname + url.search, body });
    const { status, json } = respond(url);
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => {
  cleanup();
  captured.value = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AuthProvider: the CAPTCHA token goes to Supabase Auth", () => {
  it("password sign-in", async () => {
    const auth = await mountAuth();
    await act(() => auth.signIn("a@example.com", "pw-1234567", "cf-token-1"));
    expect(bodyOf("/auth/v1/token?grant_type=password")).toMatchObject({
      email: "a@example.com",
      password: "pw-1234567",
      gotrue_meta_security: { captcha_token: "cf-token-1" },
    });
  });

  it("sign-up", async () => {
    const auth = await mountAuth();
    await act(() => auth.signUp("a@example.com", "pw-1234567", "cf-token-2"));
    expect(bodyOf("/auth/v1/signup")).toMatchObject({ email: "a@example.com", gotrue_meta_security: { captcha_token: "cf-token-2" } });
  });

  it("password reset request", async () => {
    const auth = await mountAuth();
    await act(() => auth.forgotPassword("a@example.com", "cf-token-3"));
    expect(bodyOf("/auth/v1/recover")).toMatchObject({ email: "a@example.com", gotrue_meta_security: { captcha_token: "cf-token-3" } });
  });

  it("resend the sign-up code", async () => {
    const auth = await mountAuth();
    await act(() => auth.resendConfirmationCode("a@example.com", "cf-token-4"));
    expect(bodyOf("/auth/v1/resend")).toMatchObject({
      email: "a@example.com",
      type: "signup",
      gotrue_meta_security: { captcha_token: "cf-token-4" },
    });
  });

  it("without a token (Turnstile off): no captcha_token in any of them", async () => {
    const auth = await mountAuth();
    await act(() => auth.signUp("a@example.com", "pw-1234567"));
    await act(() => auth.forgotPassword("a@example.com"));
    await act(() => auth.resendConfirmationCode("a@example.com"));
    await act(() => auth.signIn("a@example.com", "pw-1234567"));
    for (const prefix of ["/auth/v1/signup", "/auth/v1/recover", "/auth/v1/resend", "/auth/v1/token?grant_type=password"]) {
      const body = bodyOf(prefix);
      expect(body, prefix).toBeDefined();
      const security = (body?.gotrue_meta_security ?? {}) as Record<string, unknown>;
      expect(security.captcha_token, prefix).toBeUndefined();
    }
  });

  it("Supabase refusing the token: rejects with the human-check copy", async () => {
    const auth = await mountAuth();
    respond = () => ({
      status: 400,
      json: { code: 400, error_code: "captcha_failed", msg: "captcha protection: request disallowed (timeout-or-duplicate)" },
    });
    for (const attempt of [
      () => auth.signIn("a@example.com", "pw-1234567", "used"),
      () => auth.signUp("a@example.com", "pw-1234567", "used"),
      () => auth.forgotPassword("a@example.com", "used"),
      () => auth.resendConfirmationCode("a@example.com", "used"),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ name: "HumanCheckError", message: "Couldn’t confirm you’re human. Try again." });
    }
  });

  it("other Supabase errors keep their own message", async () => {
    const auth = await mountAuth();
    respond = () => ({ status: 400, json: { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" } });
    await expect(auth.signIn("a@example.com", "wrong", "cf-token")).rejects.toThrow("Invalid login credentials");
  });

  it("confirming a code (verifyOtp) isn't guarded and sends no token", async () => {
    const auth = await mountAuth();
    respond = (url) => (url.pathname === "/auth/v1/verify" ? { status: 200, json: SESSION } : { status: 200, json: {} });
    await act(() => auth.confirmSignUp("a@example.com", "123456"));
    const security = (bodyOf("/auth/v1/verify")?.gotrue_meta_security ?? {}) as Record<string, unknown>;
    expect(security.captcha_token).toBeUndefined();
  });
});
