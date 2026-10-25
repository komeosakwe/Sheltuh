import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from "@/lib/safe-next-path";
import { parseAuthProviders, type OAuthProvider } from "./oauth-providers";

/**
 * Signing in with Google or Apple: Supabase Auth's hosted OAuth, a full-page
 * redirect with PKCE that comes back to /auth/callback (components/auth/
 * OAuthCallback.tsx), which exchanges the code for a session once.
 */

export {
  isOAuthProvider,
  missingOAuthLogos,
  OAUTH_LOGO_FILES,
  OAUTH_LOGO_PATH,
  OAUTH_PROVIDERS,
  parseAuthProviders,
  type OAuthProvider,
} from "./oauth-providers";

/** Where Supabase Auth sends the browser back to after the provider. */
export const OAUTH_CALLBACK_PATH = "/auth/callback";

/** The id of /login's email form wrapper, which /auth/callback's "Use email instead" links to (`#email-sign-in`). */
export const EMAIL_SIGN_IN_ID = "email-sign-in";

/** Where a completed sign-in goes when there's no (safe) `next`: as LoginForm and VerifyForm. */
export const OAUTH_DEFAULT_NEXT = DEFAULT_AFTER_SIGN_IN;

/**
 * The providers turned on with NEXT_PUBLIC_AUTH_PROVIDERS (.env.example),
 * e.g. "google,apple". It must list only providers enabled in the Supabase
 * project, or Supabase answers the redirect with a raw error page. This is
 * the flag alone: the buttons also need Supabase configured (demo mode shows
 * none).
 *
 * A literal `process.env.NEXT_PUBLIC_…` reference, read when called: Next
 * inlines it at build time (redeploy after changing it), and tests can stub it.
 */
export function enabledOAuthProviders(): OAuthProvider[] {
  return parseAuthProviders(process.env.NEXT_PUBLIC_AUTH_PROVIDERS);
}

/** How each provider is named in copy. */
export const OAUTH_PROVIDER_NAMES: Record<OAuthProvider, string> = { apple: "Apple", google: "Google" };

/**
 * The order the buttons stack in, whatever the flag's order
 * (docs/design/social-sign-in.md §3): Apple, then Google.
 */
const BUTTON_ORDER: readonly OAuthProvider[] = ["apple", "google"];

/**
 * The providers to offer on this page, in button order: the flag's, but
 * none at all unless Supabase is configured (demo mode shows no buttons).
 * Pass `useAuth().configured`.
 */
export function offeredOAuthProviders(configured: boolean): OAuthProvider[] {
  if (!configured) return [];
  const enabled = enabledOAuthProviders();
  return BUTTON_ORDER.filter((provider) => enabled.includes(provider));
}

/**
 * "Apple or Google", "Google or Apple", or just the one: the offered
 * providers' names for a line of copy, in `order` (the spec's copy names
 * Apple first beside the buttons, Google first elsewhere).
 */
export function oauthProviderNames(providers: readonly OAuthProvider[], order: readonly OAuthProvider[]): string {
  return order
    .filter((provider) => providers.includes(provider))
    .map((provider) => OAUTH_PROVIDER_NAMES[provider])
    .join(" or ");
}

/** How /account names each way of signing in (Supabase's `app_metadata.providers`), in display order. */
const SIGN_IN_METHOD_NAMES: readonly [string, string][] = [
  ["email", "Email and password"],
  ["google", "Google"],
  ["apple", "Apple"],
];

/**
 * The sign-in methods line on /account: "Email and password, Google". Only
 * the methods named above, in that order; null when none is known.
 */
export function signInMethodsLabel(providers: readonly string[] | undefined): string | null {
  if (!providers) return null;
  const names = SIGN_IN_METHOD_NAMES.filter(([id]) => providers.includes(id)).map(([, name]) => name);
  return names.length > 0 ? names.join(", ") : null;
}

/**
 * The return path to carry through an OAuth sign-in: `safeNextPath`, and
 * never an /auth page (going "next" to the callback would only fail again).
 */
export function oauthReturnPath(next: unknown): string | null {
  const safe = safeNextPath(next);
  if (!safe) return null;
  const pathname = new URL(safe, "https://sheltuh.invalid").pathname.toLowerCase();
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return null;
  return safe;
}

/**
 * The `redirectTo` for `signInWithOAuth`: this origin's /auth/callback, with
 * a safe `next` as a query parameter (encoded, so a "#whos-going" in it
 * survives). It must be this tab's own origin: the PKCE verifier is kept in
 * this origin's storage.
 */
export function oauthCallbackUrl(origin: string, next?: unknown): string {
  const url = new URL(OAUTH_CALLBACK_PATH, origin);
  const safe = oauthReturnPath(next);
  if (safe) url.searchParams.set("next", safe);
  return url.toString();
}

/**
 * Extra query parameters for the provider's authorisation page. Google gets
 * `prompt=select_account`: signing out of Sheltüh doesn't sign anyone out of
 * Google, so on a shared device "Continue with Google" would otherwise reuse
 * the last person's account without asking.
 */
export function oauthQueryParams(provider: OAuthProvider): Record<string, string> | undefined {
  return provider === "google" ? { prompt: "select_account" } : undefined;
}

/** What went wrong, in our own terms. The copy for each is OAUTH_ERROR_COPY. */
export type OAuthErrorKind =
  | "cancelled"
  | "banned"
  | "signups-disabled"
  | "email-unverified"
  | "other-browser"
  | "expired"
  | "network"
  | "missing"
  | "unknown";

/** Supabase Auth's `error_code`s (in the callback URL or from the code exchange) that we explain. */
const ERROR_CODE_KINDS: Record<string, OAuthErrorKind> = {
  user_banned: "banned",
  signup_disabled: "signups-disabled",
  provider_email_needs_verification: "email-unverified",
  pkce_code_verifier_not_found: "other-browser",
  flow_state_expired: "expired",
  flow_state_not_found: "expired",
  bad_code_verifier: "expired",
};

/** OAuth `error` values: the person said no (Google's access_denied, Apple's user_cancelled_authorize). */
const ERROR_KINDS: Record<string, OAuthErrorKind> = {
  access_denied: "cancelled",
  user_cancelled_authorize: "cancelled",
};

/**
 * The kind for an `error_code` / `error` pair. A known `error_code` wins:
 * Supabase sends a banned user back with `error=access_denied` and
 * `error_code=user_banned`. An unknown `error_code` is "unknown" rather than
 * read through its `error`, which for Supabase's own refusals is just the
 * HTTP status's OAuth name.
 */
export function oauthErrorKind(errorCode: string | null | undefined, error: string | null | undefined): OAuthErrorKind {
  if (errorCode) return Object.hasOwn(ERROR_CODE_KINDS, errorCode) ? ERROR_CODE_KINDS[errorCode] : "unknown";
  if (error) return Object.hasOwn(ERROR_KINDS, error) ? ERROR_KINDS[error] : "unknown";
  return "unknown";
}

/** The kind for a failed code exchange (what `completeOAuthSignIn` rejects with). */
export function oauthExchangeErrorKind(err: unknown): OAuthErrorKind {
  if (isAuthRetryableFetchError(err)) return "network";
  if (isAuthError(err) && err.code) return oauthErrorKind(err.code, null);
  return "unknown";
}

export type OAuthCallback =
  | { kind: "code"; code: string; flowId: string | null; next: string | null }
  | { kind: "error"; error: OAuthErrorKind; next: string | null };

// Supabase's auth codes are UUIDs; this only bounds what's passed on.
const CODE_PATTERN = /^[A-Za-z0-9._~-]{1,512}$/;
// Supabase's own check for a PKCE flow id (auth-js validatePKCEFlowId).
const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * What the callback URL says: a code to exchange, or an error. Supabase puts
 * errors in both the query and the fragment; either is read, the query
 * first. `error_description` is never used: anyone can put any text in a
 * URL, so the page shows only our own copy. No code and no error is
 * "missing". With a code, an `sb_flow_id` (which PKCE flow it belongs to) is
 * kept if it's well-formed. auth-js adds one only with its experimental
 * `appendPkceFlowIdToRedirects` option, which we don't turn on, so it's
 * normally absent.
 */
export function parseOAuthCallback(search: string, hash: string): OAuthCallback {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const next = oauthReturnPath(query.get("next"));

  const error = query.get("error") ?? fragment.get("error");
  const errorCode = query.get("error_code") ?? fragment.get("error_code");
  if (error || errorCode) return { kind: "error", error: oauthErrorKind(errorCode, error), next };

  const code = query.get("code");
  const flowId = query.get("sb_flow_id");
  if (code && CODE_PATTERN.test(code)) {
    return { kind: "code", code, flowId: flowId && FLOW_ID_PATTERN.test(flowId) ? flowId : null, next };
  }
  return { kind: "error", error: "missing", next };
}

export const SUPPORT_EMAIL = "support@sheltuh.com.au";

/**
 * The copy for each kind (docs/design/social-sign-in.md §5, /auth/callback).
 * Never includes anything from the URL or from Supabase's error message.
 * `banned`'s message names SUPPORT_EMAIL, which the page renders as a link.
 */
export const OAUTH_ERROR_COPY: Record<OAuthErrorKind, { title: string; message: string }> = {
  cancelled: {
    title: "Sign-in cancelled",
    message: "Nothing has changed. Try again, or sign in with your email.",
  },
  banned: {
    title: "This account can’t sign in",
    message: `If you think this is a mistake, email ${SUPPORT_EMAIL}.`,
  },
  "signups-disabled": {
    title: "New accounts are paused",
    message: "We’re not taking new sign-ups right now. If you already have an account, sign in the way you did before.",
  },
  "email-unverified": {
    title: "Verify your email first",
    message:
      "Your Google or Apple account’s email isn’t verified yet. Verify it with them, then try again, or sign in with your email.",
  },
  "other-browser": {
    title: "Start again in this browser",
    message:
      "Sign-in started in a different browser or app, so we can’t finish it here. Go back to sign in and choose Apple or Google again.",
  },
  expired: {
    title: "This sign-in has expired",
    message: "It took too long, or it was already used. Go back to sign in and try again.",
  },
  network: {
    title: "Couldn’t reach Sheltüh",
    message: "Check your connection, then go back to sign in and try again.",
  },
  missing: {
    title: "This sign-in link didn’t work",
    message: "Go back to sign in and choose how you’d like to continue.",
  },
  unknown: {
    title: "Something went wrong signing in",
    message: "Go back to sign in and try again.",
  },
};
