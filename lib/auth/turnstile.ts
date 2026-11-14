/**
 * Cloudflare Turnstile, the CAPTCHA on the email sign-in, sign-up, password
 * reset and "Resend code" forms (docs/architecture.md, "Human check"). The
 * browser gets a single-use token from Cloudflare's widget and hands it to
 * Supabase Auth with the request (`captchaToken`); Supabase checks it with
 * Cloudflare, using the secret key set in its dashboard. This app has no
 * secret and verifies nothing itself.
 *
 * Off unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set: no widget, no script, no
 * token, and the forms call Supabase exactly as without it.
 */

/** Cloudflare's script, in explicit render mode (we call `turnstile.render`). Never self-hosted or proxied. */
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The origin the script and the widget's iframe come from (a CSP would need it in script-src and frame-src). */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** Cloudflare's privacy notice for Turnstile, linked under the widget. */
export const TURNSTILE_PRIVACY_URL = "https://www.cloudflare.com/turnstile-privacy-policy/";

/**
 * The public site key, or undefined (off). A literal `process.env.NEXT_PUBLIC_…`
 * reference read when called: Next inlines it at build time (redeploy after
 * changing it), and tests can stub it.
 */
export function turnstileSiteKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return key ? key : undefined;
}

/** Which form a token is for, shown in Cloudflare's analytics (letters, digits, `-` and `_`, at most 32). */
export type HumanCheckAction = "sign-in" | "sign-up" | "reset-password" | "resend-code" | "reauth";

/** The part of Turnstile's render options this app uses (Cloudflare's client-side rendering docs). */
export interface TurnstileRenderOptions {
  sitekey: string;
  action?: HumanCheckAction;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "flexible" | "compact";
  appearance?: "always" | "execute" | "interaction-only";
  retry?: "auto" | "never";
  "refresh-expired"?: "auto" | "manual" | "never";
  /** False: no hidden `cf-turnstile-response` input in the form (the token goes to Supabase, not with the form). */
  "response-field"?: boolean;
  callback?: (token: string) => void;
  /** Returning true says the error is handled here (Turnstile doesn't log it as unhandled). */
  "error-callback"?: (errorCode: string) => boolean | void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  "before-interactive-callback"?: () => void;
  "after-interactive-callback"?: () => void;
  "unsupported-callback"?: () => void;
}

/** The part of `window.turnstile` this app uses. */
export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | null | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let pending: { promise: Promise<TurnstileApi>; script: HTMLScriptElement } | null = null;

/**
 * Cloudflare's script, added to the page once (a second call while it loads
 * waits for the same one; once loaded, `window.turnstile` is used). Rejects
 * if it can't load (offline, blocked by a content blocker); the failed script
 * is removed, so a later call tries again.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (pending?.script.isConnected) return pending.promise;
  const script = document.createElement("script");
  script.src = TURNSTILE_SCRIPT_URL;
  script.async = true;
  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    const fail = () => {
      if (pending?.script === script) pending = null;
      script.remove();
      reject(new Error("Cloudflare Turnstile couldn't be loaded."));
    };
    script.addEventListener("load", () => {
      if (!window.turnstile) return fail();
      if (pending?.script === script) pending = null;
      resolve(window.turnstile);
    });
    script.addEventListener("error", fail);
  });
  pending = { promise, script };
  document.head.appendChild(script);
  return promise;
}

/** What a form says when Supabase refuses the request's CAPTCHA token (or it had none it needed). */
export const HUMAN_CHECK_FAILED = "Couldn’t confirm you’re human. Try again.";

/** Supabase Auth refused the request's CAPTCHA token: its message is HUMAN_CHECK_FAILED. */
export class HumanCheckError extends Error {
  constructor(cause?: unknown) {
    super(HUMAN_CHECK_FAILED, { cause });
    this.name = "HumanCheckError";
  }
}

/**
 * Supabase Auth's answer when CAPTCHA protection refuses a request (code
 * `captcha_failed`; messages such as "captcha protection: request disallowed
 * (timeout-or-duplicate)").
 */
export function isCaptchaFailure(error: { message: string; code?: string }): boolean {
  return error.code === "captcha_failed" || /captcha/i.test(error.message);
}
