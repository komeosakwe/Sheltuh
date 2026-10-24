// @vitest-environment jsdom
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real supabase-js client from lib/supabase/browser.ts, against a fake
// Supabase Auth (fetch stubbed): PKCE for Google/Apple, and the email flows
// (sign-up, confirm, password reset) still working with it.

const SUPABASE = "https://ref.supabase.test";
const USER = { id: "u1", aud: "authenticated", email: "a@example.com", app_metadata: {}, user_metadata: {}, created_at: "" };
const SESSION = { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer", user: USER };

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
let calls: Call[] = [];
let respond: (url: URL) => { status: number; json: unknown } = () => ({ status: 200, json: {} });

async function freshClient(): Promise<SupabaseClient> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  const { getSupabaseBrowserClient } = await import("@/lib/supabase/browser");
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("expected a client");
  return client;
}

beforeEach(() => {
  localStorage.clear();
  calls = [];
  respond = () => ({ status: 200, json: {} });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ url: url.pathname + url.search, method: init?.method ?? "GET", body });
    const { status, json } = respond(url);
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// The fixed key a code exchange reads when the callback URL carries no flow id
// (ours never does: auth-js's experimental appendPkceFlowIdToRedirects is off).
// auth-js also keeps a per-flow copy and an index of them, which it caps.
const LEGACY_VERIFIER_KEY = "sb-ref-auth-token-code-verifier";

describe("Supabase browser client: PKCE", () => {
  it("starts an OAuth sign-in with an S256 code challenge, keeping the verifier in this browser", async () => {
    const client = await freshClient();
    const redirectTo = "https://app.sheltuh.test/auth/callback?next=%2Faccount";
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { prompt: "select_account" }, skipBrowserRedirect: true },
    });
    expect(error).toBeNull();
    const url = new URL(data.url ?? "");
    expect(url.origin + url.pathname).toBe(`${SUPABASE}/auth/v1/authorize`);
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe(redirectTo);
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(localStorage.getItem(LEGACY_VERIFIER_KEY)).toBeTruthy();
  });

  it("exchanges the code with that verifier, saves the session, and removes the verifier", async () => {
    const client = await freshClient();
    await client.auth.signInWithOAuth({ provider: "apple", options: { skipBrowserRedirect: true } });
    const stored = localStorage.getItem(LEGACY_VERIFIER_KEY) ?? "";
    respond = (url) => (url.pathname === "/auth/v1/token" ? { status: 200, json: SESSION } : { status: 200, json: {} });

    const { data, error } = await client.auth.exchangeCodeForSession("3f1c2b9e");
    expect(error).toBeNull();
    expect(data.session?.access_token).toBe("at");
    const exchange = calls.find((c) => c.url === "/auth/v1/token?grant_type=pkce");
    expect(exchange?.body).toEqual({ auth_code: "3f1c2b9e", code_verifier: JSON.parse(stored).split("/")[0] });
    expect(localStorage.getItem(LEGACY_VERIFIER_KEY)).toBeNull();
    expect((await client.auth.getSession()).data.session?.access_token).toBe("at");
  });

  it("can't exchange a code without the verifier (started in another browser), and calls nothing", async () => {
    const client = await freshClient();
    const { error } = await client.auth.exchangeCodeForSession("3f1c2b9e");
    expect(error?.code).toBe("pkce_code_verifier_not_found");
    expect(calls.some((c) => c.url.startsWith("/auth/v1/token"))).toBe(false);
  });
});

describe("Supabase browser client: email flows under PKCE", () => {
  it("sign-up then confirming with the emailed code signs in (verifyOtp, no verifier needed)", async () => {
    const client = await freshClient();
    respond = (url) => (url.pathname === "/auth/v1/signup" ? { status: 200, json: { ...USER, confirmation_sent_at: "" } } : { status: 200, json: {} });
    const signUp = await client.auth.signUp({ email: "a@example.com", password: "a-long-password" });
    expect(signUp.error).toBeNull();
    // PKCE's side effect: a code challenge is sent too.
    expect(calls.find((c) => c.url.startsWith("/auth/v1/signup"))?.body).toMatchObject({ code_challenge_method: "s256" });

    // Confirming doesn't need the verifier: as when the email is opened on another device.
    localStorage.clear();
    respond = (url) => (url.pathname === "/auth/v1/verify" ? { status: 200, json: SESSION } : { status: 200, json: {} });
    const verified = await client.auth.verifyOtp({ email: "a@example.com", token: "123456", type: "signup" });
    expect(verified.error).toBeNull();
    expect(verified.data.session?.access_token).toBe("at");
    expect(calls.find((c) => c.url === "/auth/v1/verify")?.body).toMatchObject({ email: "a@example.com", token: "123456", type: "signup" });
  });

  it("password reset: request, then the recovery code signs in", async () => {
    const client = await freshClient();
    const reset = await client.auth.resetPasswordForEmail("a@example.com");
    expect(reset.error).toBeNull();
    expect(calls.find((c) => c.url.startsWith("/auth/v1/recover"))?.body).toMatchObject({ email: "a@example.com" });

    respond = (url) => (url.pathname === "/auth/v1/verify" ? { status: 200, json: SESSION } : { status: 200, json: {} });
    const verified = await client.auth.verifyOtp({ email: "a@example.com", token: "654321", type: "recovery" });
    expect(verified.error).toBeNull();
    expect(verified.data.session?.access_token).toBe("at");
  });
});
