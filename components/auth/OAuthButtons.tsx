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
const [GOOGLE_LIGHT_2X, GOOGLE_LIGHT_4X, GOOGLE_DARK_2X, GOOGLE_DARK_4X] = OAUTH_LOGO_FILES.google;

/**
 * The vendors' own artwork, served from public/auth/ (docs/auth-logos.md;
 * next.config.ts fails the build without it). Shown as files, unmodified
 * and uncropped, and hidden from assistive tech: the button's title (for
 * Google, the words in its image, as screen-reader text) is its name.
 */
function Logo({ file, className }: { file: string; className: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the vendor's SVG, unmodified at its own proportions; next/image would need SVG optimisation off and fixed dimensions
    <img src={`${OAUTH_LOGO_PATH}/${file}`} alt="" aria-hidden="true" draggable={false} className={className} />
  );
}

/**
 * Google's own "Sign in with Google" button image, unmodified, at its native
 * CSS size (180×40) from the 2x or 4x file, whichever suits the screen.
 */
function GoogleArtwork({ x2, x4, className }: { x2: string; x4: string; className: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Google's button artwork, served as-is: next/image would re-encode it
    <img
      src={`${OAUTH_LOGO_PATH}/${x2}`}
      srcSet={`${OAUTH_LOGO_PATH}/${x2} 2x, ${OAUTH_LOGO_PATH}/${x4} 4x`}
      width={180}
      height={40}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
    />
  );
}

/**
 * Continue with Apple / Sign in with Google (docs/design/social-sign-in.md
 * §3 to §5), above the email form on /login and /signup. Only the
 * providers NEXT_PUBLIC_AUTH_PROVIDERS lists, Apple first; nothing at all
 * in demo mode or with none listed.
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
export default function OAuthButtons({ next }: { next?: string }) {
  const auth = useAuth();
  const providers = offeredOAuthProviders(auth.configured);
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState<OAuthProvider | null>(null);
  const reannounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = status?.kind === "busy";

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      clearTimeout(reannounce.current);
      setStatus(null);
    }
    window.addEventListener("pageshow", onPageShow);
    const timer = reannounce;
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      clearTimeout(timer.current);
    };
  }, []);

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
    setStatus({ kind: "busy", provider });
    try {
      await auth.signInWithProvider(provider, oauthReturnPath(next) ?? undefined);
      // The page is on its way to the provider: stay busy until it's gone.
    } catch {
      // What went wrong is the connection or the service, not anything to fix here.
      setStatus(null);
      setFailed(provider);
    }
  }

  return (
    <div className={`${roboto.variable} flex flex-col gap-8`}>
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
              {/* Google's whole button: Light on the White theme, Dark on the Dark theme. Its name is the image's text. */}
              <GoogleArtwork x2={GOOGLE_LIGHT_2X} x4={GOOGLE_LIGHT_4X} className="block dark:hidden" />
              <GoogleArtwork x2={GOOGLE_DARK_2X} x4={GOOGLE_DARK_4X} className="hidden dark:block" />
              <span className="sr-only">Sign in with Google</span>
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

      <LegalNote
        lead={`Continuing with ${oauthProviderNames(providers, ["apple", "google"])} signs you in, or creates an account if you’re new. How we handle your details:`}
      />

      <div className="flex items-center gap-4">
        <span aria-hidden="true" className="h-px flex-1 bg-surface-border" />
        <span className="eyebrow text-muted">or</span>
        <span aria-hidden="true" className="h-px flex-1 bg-surface-border" />
      </div>
    </div>
  );
}
