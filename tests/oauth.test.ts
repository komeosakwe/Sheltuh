import { AuthApiError, AuthPKCECodeVerifierMissingError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enabledOAuthProviders,
  missingOAuthLogos,
  OAUTH_ERROR_COPY,
  OAUTH_LOGO_FILES,
  oauthProviderNames,
  offeredOAuthProviders,
  signInMethodsLabel,
  oauthCallbackUrl,
  oauthErrorKind,
  oauthExchangeErrorKind,
  oauthQueryParams,
  oauthReturnPath,
  parseAuthProviders,
  parseOAuthCallback,
  type OAuthErrorKind,
} from "@/lib/auth/oauth";

const ORIGIN = "https://app.sheltuh.com.au";

describe("NEXT_PUBLIC_AUTH_PROVIDERS", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off when empty or unset", () => {
    expect(parseAuthProviders(undefined)).toEqual([]);
    expect(parseAuthProviders("")).toEqual([]);
    expect(parseAuthProviders(" , ,")).toEqual([]);
  });

  it("keeps known providers only, in the order given, once each, ignoring case and spaces", () => {
    expect(parseAuthProviders("google")).toEqual(["google"]);
    expect(parseAuthProviders("google,apple")).toEqual(["google", "apple"]);
    expect(parseAuthProviders("apple,google")).toEqual(["apple", "google"]);
    expect(parseAuthProviders(" Google , APPLE ")).toEqual(["google", "apple"]);
    expect(parseAuthProviders("google,google,apple,Google")).toEqual(["google", "apple"]);
    expect(parseAuthProviders("github,facebook,google")).toEqual(["google"]);
    expect(parseAuthProviders("google apple")).toEqual([]);
    expect(parseAuthProviders("toString,__proto__,constructor")).toEqual([]);
  });

  it("is read when called, so a stubbed env takes effect", () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "");
    expect(enabledOAuthProviders()).toEqual([]);
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "apple, google");
    expect(enabledOAuthProviders()).toEqual(["apple", "google"]);
  });
});

describe("oauthCallbackUrl", () => {
  it("is this origin's /auth/callback, with no next when none is given", () => {
    expect(oauthCallbackUrl(ORIGIN)).toBe(`${ORIGIN}/auth/callback`);
    expect(oauthCallbackUrl("http://127.0.0.1:3177", undefined)).toBe("http://127.0.0.1:3177/auth/callback");
  });

  it("keeps a safe next, encoded, so its own query and #fragment survive the round trip", () => {
    const url = oauthCallbackUrl(ORIGIN, "/events/neon-static?tab=info#whos-going");
    expect(url).toBe(`${ORIGIN}/auth/callback?next=%2Fevents%2Fneon-static%3Ftab%3Dinfo%23whos-going`);
    const parsed = new URL(url);
    expect(parsed.hash).toBe("");
    expect(parsed.searchParams.get("next")).toBe("/events/neon-static?tab=info#whos-going");
  });

  it.each([
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "/.//evil.example",
    "javascript:alert(1)",
    "events",
    "/\t/evil.example",
    "",
  ])("drops an unsafe next (%j)", (next) => {
    expect(oauthCallbackUrl(ORIGIN, next)).toBe(`${ORIGIN}/auth/callback`);
  });

  it.each(["/auth/callback", "/auth/callback?code=x", "/auth", "/auth?x=1", "/auth#x", "/AUTH/Callback", "/auth/../auth/callback"])(
    "drops a next that's an /auth page (%j): coming back to the callback would only fail",
    (next) => {
      expect(oauthReturnPath(next)).toBeNull();
      expect(oauthCallbackUrl(ORIGIN, next)).toBe(`${ORIGIN}/auth/callback`);
    },
  );

  it("doesn't mistake other paths that start with /auth for /auth pages", () => {
    expect(oauthReturnPath("/authors")).toBe("/authors");
    expect(oauthReturnPath("/events/auth")).toBe("/events/auth");
  });
});

describe("oauthQueryParams", () => {
  it("makes Google ask which account (a shared device would otherwise reuse the last one), and adds nothing for Apple", () => {
    expect(oauthQueryParams("google")).toEqual({ prompt: "select_account" });
    expect(oauthQueryParams("apple")).toBeUndefined();
  });
});

describe("parseOAuthCallback", () => {
  it("finds the code and a safe next", () => {
    expect(parseOAuthCallback("?next=%2Fevents%2Fx%23whos-going&code=3f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", "")).toEqual({
      kind: "code",
      code: "3f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      flowId: null,
      next: "/events/x#whos-going",
    });
    expect(parseOAuthCallback("?code=abc", "")).toEqual({ kind: "code", code: "abc", flowId: null, next: null });
  });

  it("keeps Supabase's sb_flow_id with the code when it's well-formed (Supabase's own pattern), and only then", () => {
    expect(parseOAuthCallback("?code=abc&sb_flow_id=0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d", "")).toMatchObject({
      kind: "code",
      flowId: "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d",
    });
    for (const bad of ["short", "has%20space", "x".repeat(65), "%3Cscript%3E"]) {
      expect(parseOAuthCallback(`?code=abc&sb_flow_id=${bad}`, "")).toMatchObject({ kind: "code", flowId: null });
    }
  });

  it("drops an unsafe next, the callback itself included", () => {
    expect(parseOAuthCallback("?code=abc&next=%2F%2Fevil.example", "")).toMatchObject({ next: null });
    expect(parseOAuthCallback("?code=abc&next=https%3A%2F%2Fevil.example", "")).toMatchObject({ next: null });
    expect(parseOAuthCallback("?code=abc&next=%2Fauth%2Fcallback", "")).toMatchObject({ next: null });
  });

  it("is 'missing' with no code and no error, or a malformed code", () => {
    expect(parseOAuthCallback("", "")).toEqual({ kind: "error", error: "missing", next: null });
    expect(parseOAuthCallback("?next=%2Faccount", "")).toEqual({ kind: "error", error: "missing", next: "/account" });
    expect(parseOAuthCallback("?code=", "")).toMatchObject({ error: "missing" });
    expect(parseOAuthCallback("?code=a%20b", "")).toMatchObject({ error: "missing" });
    expect(parseOAuthCallback(`?code=${"a".repeat(513)}`, "")).toMatchObject({ error: "missing" });
  });

  it("reads an error from the query or the fragment (Supabase sends both)", () => {
    expect(parseOAuthCallback("?error=access_denied&error_description=x", "")).toMatchObject({ kind: "error", error: "cancelled" });
    expect(parseOAuthCallback("?next=%2Faccount", "#error=access_denied&sb=")).toEqual({
      kind: "error",
      error: "cancelled",
      next: "/account",
    });
    expect(parseOAuthCallback("", "#error=user_cancelled_authorize")).toMatchObject({ error: "cancelled" });
  });

  it("an error wins over a code", () => {
    expect(parseOAuthCallback("?code=abc&error=access_denied", "")).toMatchObject({ kind: "error", error: "cancelled" });
  });

  it("a known error_code wins over its error: Supabase sends a banned user back as access_denied + user_banned", () => {
    expect(parseOAuthCallback("?error=access_denied&error_code=user_banned", "")).toMatchObject({ error: "banned" });
    expect(parseOAuthCallback("", "#error=access_denied&error_code=signup_disabled")).toMatchObject({ error: "signups-disabled" });
    expect(parseOAuthCallback("?error=access_denied&error_code=provider_email_needs_verification", "")).toMatchObject({
      error: "email-unverified",
    });
  });

  it("never returns the error_description", () => {
    const hostile = "Your account is locked. Call +61 400 000 000 now";
    const parsed = parseOAuthCallback(`?error=access_denied&error_description=${encodeURIComponent(hostile)}`, `#error_description=${encodeURIComponent(hostile)}`);
    expect(JSON.stringify(parsed)).not.toContain("locked");
  });
});

describe("oauthErrorKind", () => {
  it.each<[string | null, string | null, OAuthErrorKind]>([
    [null, "access_denied", "cancelled"],
    [null, "user_cancelled_authorize", "cancelled"],
    ["user_banned", "access_denied", "banned"],
    ["signup_disabled", "access_denied", "signups-disabled"],
    ["provider_email_needs_verification", "access_denied", "email-unverified"],
    ["pkce_code_verifier_not_found", null, "other-browser"],
    ["flow_state_expired", null, "expired"],
    ["flow_state_not_found", null, "expired"],
    ["bad_code_verifier", null, "expired"],
    // An unknown error_code isn't read through its `error` (the HTTP status's OAuth name for Supabase's own refusals).
    ["unexpected_failure", "access_denied", "unknown"],
    [null, "server_error", "unknown"],
    [null, "__proto__", "unknown"],
    ["constructor", null, "unknown"],
    [null, null, "unknown"],
  ])("error_code %j, error %j -> %s", (code, error, kind) => {
    expect(oauthErrorKind(code, error)).toBe(kind);
  });
});

describe("oauthExchangeErrorKind", () => {
  it("reads the AuthError's code", () => {
    expect(oauthExchangeErrorKind(new AuthPKCECodeVerifierMissingError())).toBe("other-browser");
    expect(oauthExchangeErrorKind(new AuthApiError("Flow state has expired", 403, "flow_state_expired"))).toBe("expired");
    expect(oauthExchangeErrorKind(new AuthApiError("User is banned", 403, "user_banned"))).toBe("banned");
  });

  it("calls a fetch failure or 5xx a connection problem", () => {
    expect(oauthExchangeErrorKind(new AuthRetryableFetchError("Failed to fetch", 0))).toBe("network");
    expect(oauthExchangeErrorKind(new AuthRetryableFetchError("Bad Gateway", 502))).toBe("network");
  });

  it("is 'unknown' for anything else", () => {
    expect(oauthExchangeErrorKind(new AuthApiError("nope", 400, undefined))).toBe("unknown");
    expect(oauthExchangeErrorKind(new Error("flow_state_expired"))).toBe("unknown");
    expect(oauthExchangeErrorKind({ code: "flow_state_expired" })).toBe("unknown");
    expect(oauthExchangeErrorKind(undefined)).toBe("unknown");
  });
});

describe("OAUTH_ERROR_COPY", () => {
  it("has a title and message for every kind", () => {
    const kinds: OAuthErrorKind[] = [
      "cancelled",
      "banned",
      "signups-disabled",
      "email-unverified",
      "other-browser",
      "expired",
      "network",
      "missing",
      "unknown",
    ];
    expect(Object.keys(OAUTH_ERROR_COPY).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      expect(OAUTH_ERROR_COPY[kind].title.length).toBeGreaterThan(0);
      expect(OAUTH_ERROR_COPY[kind].message.length).toBeGreaterThan(0);
    }
  });

  it("names support for a banned account", () => {
    expect(OAUTH_ERROR_COPY.banned.message).toContain("support@sheltuh.com.au");
  });
});

describe("offeredOAuthProviders and oauthProviderNames: the buttons and the copy around them", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers the flagged providers in button order, Apple first, and none unless Supabase is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "google,apple");
    expect(offeredOAuthProviders(true)).toEqual(["apple", "google"]);
    expect(offeredOAuthProviders(false)).toEqual([]);
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "google");
    expect(offeredOAuthProviders(true)).toEqual(["google"]);
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "");
    expect(offeredOAuthProviders(true)).toEqual([]);
  });

  it("names the offered providers in the order asked, or just the one", () => {
    expect(oauthProviderNames(["apple", "google"], ["apple", "google"])).toBe("Apple or Google");
    expect(oauthProviderNames(["apple", "google"], ["google", "apple"])).toBe("Google or Apple");
    expect(oauthProviderNames(["google"], ["apple", "google"])).toBe("Google");
    expect(oauthProviderNames(["apple"], ["google", "apple"])).toBe("Apple");
  });
});

describe("signInMethodsLabel: /account's sign-in methods line", () => {
  it("names email, Google and Apple in that order, ignoring anything else", () => {
    expect(signInMethodsLabel(["google", "email"])).toBe("Email and password, Google");
    expect(signInMethodsLabel(["apple", "google", "email"])).toBe("Email and password, Google, Apple");
    expect(signInMethodsLabel(["apple"])).toBe("Apple");
    expect(signInMethodsLabel(["github", "email"])).toBe("Email and password");
  });

  it("is null when nothing known is listed", () => {
    expect(signInMethodsLabel(undefined)).toBeNull();
    expect(signInMethodsLabel([])).toBeNull();
    expect(signInMethodsLabel(["github"])).toBeNull();
  });
});

describe("missingOAuthLogos: the official artwork each listed provider needs", () => {
  it("lists Apple's two logo-only files and Google's Light and Dark button images at 2x and 4x", () => {
    expect(OAUTH_LOGO_FILES).toEqual({
      apple: ["apple-logo-white.svg", "apple-logo-black.svg"],
      google: ["google-signin-light@2x.png", "google-signin-light@4x.png", "google-signin-dark@2x.png", "google-signin-dark@4x.png"],
    });
  });

  it("names only the listed providers' missing files", () => {
    const none = () => false;
    expect(missingOAuthLogos(undefined, none)).toEqual([]);
    expect(missingOAuthLogos("", none)).toEqual([]);
    const google = ["google-signin-light@2x.png", "google-signin-light@4x.png", "google-signin-dark@2x.png", "google-signin-dark@4x.png"];
    expect(missingOAuthLogos("google", none)).toEqual(google);
    expect(missingOAuthLogos("google,apple", none)).toEqual([...google, "apple-logo-white.svg", "apple-logo-black.svg"]);
    expect(missingOAuthLogos("apple", (file) => file === "apple-logo-white.svg")).toEqual(["apple-logo-black.svg"]);
    expect(missingOAuthLogos("google", (file) => file !== "google-signin-dark@4x.png")).toEqual(["google-signin-dark@4x.png"]);
    expect(missingOAuthLogos("google,apple", () => true)).toEqual([]);
  });
});
