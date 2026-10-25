"use client";

import { useEffect, useState } from "react";
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

/** What the slot under the buttons shows. */
type Slot =
  | { kind: "busy"; provider: OAuthProvider }
  | { kind: "error"; provider: OAuthProvider }
  | { kind: "in-app"; platform: DevicePlatform; apple: boolean }
  | null;

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
 * The vendors' own artwork, served from public/auth/ (the owner adds it:
 * public/auth/README.md; next.config.ts fails the build without it). Shown
 * as files, unmodified and uncropped, and hidden from assistive tech: the
 * button's title is its name.
 */
function Logo({ file, className }: { file: string; className: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the vendor's SVG, unmodified at its own proportions; next/image would need SVG optimisation off and fixed dimensions
    <img src={`${OAUTH_LOGO_PATH}/${file}`} alt="" aria-hidden="true" draggable={false} className={className} />
  );
}

/**
 * Continue with Apple / Continue with Google (docs/design/social-sign-in.md
 * §3 and §5), above the email form on /login and /signup. Only the
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
 * Real buttons outside any form: they never submit the email form.
 */
export default function OAuthButtons({ next }: { next?: string }) {
  const auth = useAuth();
  const providers = offeredOAuthProviders(auth.configured);
  const [slot, setSlot] = useState<Slot>(null);
  const busy = slot?.kind === "busy";

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setSlot(null);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (providers.length === 0) return null;

  async function start(provider: OAuthProvider) {
    if (busy) return;
    if (provider === "google" && isInAppBrowser(navigator.userAgent)) {
      setSlot({
        kind: "in-app",
        platform: devicePlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0),
        apple: providers.includes("apple"),
      });
      return;
    }
    setSlot({ kind: "busy", provider });
    try {
      await auth.signInWithProvider(provider, oauthReturnPath(next) ?? undefined);
      // The page is on its way to the provider: stay busy until it's gone.
    } catch {
      // What went wrong is the connection or the service, not anything to fix here.
      setSlot({ kind: "error", provider });
    }
  }

  const buttonProps = (provider: OAuthProvider) => ({
    type: "button" as const,
    "aria-disabled": busy ? true : undefined,
    onClick: () => void start(provider),
  });

  return (
    <div className={`${roboto.variable} flex flex-col gap-8`}>
      <div className="flex flex-col gap-3">
        {providers.includes("apple") && (
          <button {...buttonProps("apple")} className="btn-oauth btn-oauth-apple">
            {/* White theme: the black button and white logo; Dark: the white button and black logo. */}
            <Logo file={APPLE_ON_WHITE} className="h-12 w-auto shrink-0 dark:hidden" />
            <Logo file={APPLE_ON_DARK} className="hidden h-12 w-auto shrink-0 dark:block" />
            <span>Continue with Apple</span>
          </button>
        )}
        {providers.includes("google") && (
          <button {...buttonProps("google")} className="btn-oauth btn-oauth-google">
            <Logo file={GOOGLE_G} className="size-6 shrink-0" />
            <span>Continue with Google</span>
          </button>
        )}
      </div>

      <div className="empty:hidden">
        {slot?.kind === "busy" && <DotsLoader announce label={`Opening ${OAUTH_PROVIDER_NAMES[slot.provider]}`} />}
        {slot?.kind === "error" && (
          <Notice tone="danger" role="alert">
            Couldn&rsquo;t open {OAUTH_PROVIDER_NAMES[slot.provider]} sign-in. Check your connection and try again.
          </Notice>
        )}
        {slot?.kind === "in-app" && (
          <Notice role="status">{inAppMessage(slot.platform, slot.apple)}</Notice>
        )}
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
