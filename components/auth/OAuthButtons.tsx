"use client";

import { useEffect, useRef, useState } from "react";
import LegalNote from "@/components/auth/LegalNote";
import { DotsLoader } from "@/components/brand/DotsMark";
import { Notice } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth/AuthContext";
import { devicePlatform, isInAppBrowser, type DevicePlatform } from "@/lib/auth/in-app-browser";
import {
  OAUTH_LOGO_FILES,
  OAUTH_LOGO_PATH,
  OAUTH_PROVIDER_NAMES,
  oauthProviderNames,
  oauthReturnPath,
  offeredOAuthProviders,
  type OAuthProvider,
} from "@/lib/auth/oauth";
import { roboto } from "./oauth-font";

/** What the polite status line under the buttons says. */
type Status = { kind: "busy"; provider: OAuthProvider } | { kind: "in-app"; platform: DevicePlatform; apple: boolean };

/**
 * How long the status line stays empty before the in-app message is said
 * again: a live region only speaks when its text changes, so a second tap on
 * Google would otherwise be met with silence.
 */
const REANNOUNCE_DELAY_MS = 100;

const OPEN_IN: Record<DevicePlatform, string> = {
  ios: "Open this page in Safari",
  android: "Open this page in Chrome",
  other: "Open this page in your browser",
};

function inAppMessage(platform: DevicePlatform, apple: boolean): string {
  return `Google sign-in doesn’t work inside this app’s browser. ${OPEN_IN[platform]}, or continue with ${apple ? "Apple or email" : "email"}.`;
}

const [APPLE_ON_WHITE, APPLE_ON_DARK] = OAUTH_LOGO_FILES.apple;
const [GOOGLE_G] = OAUTH_LOGO_FILES.google;

/**
 * The vendors' own artwork, served from public/auth/ (docs/auth-logos.md;
 * next.config.ts fails the build without it). Shown as files, unmodified
 * and uncropped, and hidden from assistive tech: the button's visible title
 * is its name.
 */
function Logo({ file, className }: { file: string; className: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the vendor's SVG, unmodified at its own proportions; next/image would need SVG optimisation off and fixed dimensions
    <img src={`${OAUTH_LOGO_PATH}/${file}`} alt="" aria-hidden="true" draggable={false} className={className} />
  );
}

/**
 * Continue with Apple / Continue with Google (docs/design/social-sign-in.md
 * §3 to §5). Only the providers NEXT_PUBLIC_AUTH_PROVIDERS lists, Apple
 * first; nothing at all in demo mode or with none listed.
 *
 * `placement`: "above" (the default; /signup and the invite) puts the pair,
 * their privacy line and the "or" divider before the email form; "below"
 * (/login, the redesign's sign-in mock) puts the "Or continue with" divider,
 * then the pair and their privacy line, after it.
 *
 * A click leaves for the provider (AuthContext's signInWithProvider), which
 * comes back to /auth/callback with `next`. Until then both buttons are
 * busy: aria-disabled, keeping focus and their colours, ignoring clicks.
 * Coming Back from the provider can restore this page from the back/forward
 * cache, still busy, so `pageshow` resets it. Inside an app's browser,
 * Google would refuse, so its button says how to get out instead.
 *
 * What happens is said in two regions that are always there (a live region
 * added along with its text often isn't read): a polite status ("Opening
 * Google…", the in-app message, emptied and said again on each tap) and,
 * beside it, an alert for a sign-in that couldn't start.
 *
 * Real buttons outside any form: they never submit the email form.
 */
/** Focus or visibility returning this soon after the tap is the tap itself, not a return. */
export const BUSY_RETURN_GRACE_MS = 1500;
/** However the provider's page or sheet went away, the buttons work again after this. */
export const BUSY_TIMEOUT_MS = 20_000;

export default function OAuthButtons({ next, placement = "above" }: { next?: string; placement?: "above" | "below" }) {
  const auth = useAuth();
  const providers = offeredOAuthProviders(auth.configured);
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState<OAuthProvider | null>(null);
  const reannounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Which sign-in attempt owns the busy state and the failure alert. A recovery (below) or a new
  // tap moves it on, so an earlier attempt that fails late can't touch a newer one's state.
  const attempt = useRef(0);
  const busy = status?.kind === "busy";

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      clearTimeout(reannounce.current);
      attempt.current += 1;
      setStatus(null);
    }
    window.addEventListener("pageshow", onPageShow);
    const timer = reannounce;
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      clearTimeout(timer.current);
    };
  }, []);

  // A sign-in that never left the page (iOS shows Sign in with Apple as a sheet over it, and
  // closing the sheet tells the page nothing) must not leave both buttons locked. Once the page
  // is back in front after a moment, or after BUSY_TIMEOUT_MS at the latest, they work again.
  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    function release() {
      if (Date.now() - startedAt < BUSY_RETURN_GRACE_MS) return;
      attempt.current += 1;
      setStatus(null);
    }
    function onVisibility() {
      if (document.visibilityState === "visible") release();
    }
    window.addEventListener("focus", release);
    document.addEventListener("visibilitychange", onVisibility);
    const fallback = setTimeout(() => {
      attempt.current += 1;
      setStatus(null);
    }, BUSY_TIMEOUT_MS);
    return () => {
      window.removeEventListener("focus", release);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(fallback);
    };
  }, [busy]);

  if (providers.length === 0) return null;

  async function start(provider: OAuthProvider) {
    if (busy) return;
    clearTimeout(reannounce.current);
    setFailed(null);
    if (provider === "google" && isInAppBrowser(navigator.userAgent)) {
      const inApp: Status = {
        kind: "in-app",
        platform: devicePlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0),
        apple: providers.includes("apple"),
      };
      // Emptied, then said again a moment later.
      setStatus(null);
      reannounce.current = setTimeout(() => setStatus(inApp), REANNOUNCE_DELAY_MS);
      return;
    }
    const mine = ++attempt.current;
    setStatus({ kind: "busy", provider });
    try {
      await auth.signInWithProvider(provider, oauthReturnPath(next) ?? undefined);
      // The page is on its way to the provider: stay busy until it's gone.
    } catch {
      // A newer attempt (or a recovery) has taken over: this late failure isn't news any more.
      if (attempt.current !== mine) return;
      // What went wrong is the connection or the service, not anything to fix here.
      setStatus(null);
      setFailed(provider);
    }
  }

  const pair = (
    <div>
      <div className="flex flex-col gap-3">
        {providers.includes("apple") && (
          <button
            type="button"
            aria-disabled={busy ? true : undefined}
            onClick={() => void start("apple")}
            className="btn-oauth btn-oauth-apple"
          >
            {/* White theme: the black button and white logo; Dark: the white button and black logo. */}
            <Logo file={APPLE_ON_WHITE} className="h-12 w-auto shrink-0 dark:hidden" />
            <Logo file={APPLE_ON_DARK} className="hidden h-12 w-auto shrink-0 dark:block" />
            <span>Continue with Apple</span>
          </button>
        )}
        {providers.includes("google") && (
          <button
            type="button"
            aria-disabled={busy ? true : undefined}
            onClick={() => void start("google")}
            className="btn-oauth btn-oauth-google"
          >
            {/* Google's G, centred in a square like Apple's 48px logo file (46px: inside Google's 1px border, so the button stays
                48px), with the title beside it as on Apple's; the colours follow the theme. */}
            <span aria-hidden="true" className="flex size-[2.875rem] shrink-0 items-center justify-center">
              <Logo file={GOOGLE_G} className="size-6 shrink-0" />
            </span>
            <span>Continue with Google</span>
          </button>
        )}
      </div>

      {/* Always rendered, empty until there's something to say (its content brings its own spacing). */}
      <div role="status" aria-atomic="true">
        {status?.kind === "busy" && (
          <div className="mt-8">
            <DotsLoader label={`Opening ${OAUTH_PROVIDER_NAMES[status.provider]}`} />
          </div>
        )}
        {status?.kind === "in-app" && (
          <div className="mt-8">
            <Notice>{inAppMessage(status.platform, status.apple)}</Notice>
          </div>
        )}
      </div>
      <div role="alert" aria-atomic="true">
        {failed && (
          <div className="mt-8">
            <Notice tone="danger">
              Couldn&rsquo;t open {OAUTH_PROVIDER_NAMES[failed]} sign-in. Check your connection and try again.
            </Notice>
          </div>
        )}
      </div>
    </div>
  );

  const legal = (
    <LegalNote
      lead={`Continuing with ${oauthProviderNames(providers, ["apple", "google"])} signs you in, or creates an account if you’re new. How we handle your details:`}
    />
  );

  if (placement === "below") {
    return (
      <div className={`${roboto.variable} flex flex-col gap-6`}>
        <Divider label="Or continue with" />
        {pair}
        {legal}
      </div>
    );
  }

  return (
    <div className={`${roboto.variable} flex flex-col gap-8`}>
      {pair}
      {legal}
      <Divider label="or" />
    </div>
  );
}

/** A hairline either side of a short mono label: "or" above the email form, "Or continue with" below it. */
function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4">
      <span aria-hidden="true" className="h-px flex-1 bg-surface-border" />
      <span className="eyebrow text-muted">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-surface-border" />
    </div>
  );
}
