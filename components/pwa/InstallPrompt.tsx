"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import {
  detectInstallPlatform,
  getInstallDismissed,
  installPromptAllowedOn,
  isBeforeInstallPromptEvent,
  rememberInstallDismissed,
  subscribeInstallDismissed,
  type BeforeInstallPromptEvent,
  type InstallPlatform,
} from "@/lib/pwa/install";

const STANDALONE_QUERY = "(display-mode: standalone)";

function subscribePlatform(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(STANDALONE_QUERY);
  list.addEventListener?.("change", onChange);
  return () => list.removeEventListener?.("change", onChange);
}
const getPlatform = (): InstallPlatform => detectInstallPlatform(window);
const getServerPlatform = (): InstallPlatform => "standalone";

const dismissButtonClass =
  "min-h-11 px-2 text-sm font-semibold text-background underline underline-offset-4 hover:no-underline focus-visible:outline-background";

/**
 * "Add Sheltüh to your home screen", at the top of the footer on browsing
 * pages (see lib/pwa/install.ts for where). Android/desktop Chrome: only
 * once the browser says the app is installable (beforeinstallprompt), with
 * an Install button. iOS Safari: the Add to Home Screen steps. Never when
 * already installed, and "No thanks" is remembered. No animation.
 */
export default function InstallPrompt() {
  const pathname = usePathname();
  const platform = useSyncExternalStore(subscribePlatform, getPlatform, getServerPlatform);
  const storedDismissal = useSyncExternalStore(subscribeInstallDismissed, getInstallDismissed, () => true);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [prompting, setPrompting] = useState(false);
  // Where "No thanks" was chosen: the confirmation shows there, so focus has somewhere to go.
  const [dismissedOn, setDismissedOn] = useState<string | null>(null);
  const confirmationRef = useRef<HTMLParagraphElement>(null);
  const titleId = useId();

  useEffect(() => {
    function handleBeforeInstall(event: Event) {
      if (!isBeforeInstallPromptEvent(event)) return;
      // Keep Chrome's own mini-infobar from popping up over the page (checkout included).
      event.preventDefault();
      setDeferred(event);
    }
    function handleInstalled() {
      setInstalled(true);
      setDeferred(null);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (dismissedOn !== null) confirmationRef.current?.focus();
  }, [dismissedOn]);

  if (!installPromptAllowedOn(pathname) || platform === "standalone" || installed) return null;

  if (dismissedOn !== null) {
    return dismissedOn === pathname ? (
      <p
        ref={confirmationRef}
        tabIndex={-1}
        role="status"
        className="mb-10 text-sm text-background/70 focus:outline-none"
      >
        Okay, we won&rsquo;t suggest this again. You can still add Sheltüh from your browser&rsquo;s menu.
      </p>
    ) : null;
  }
  if (storedDismissal) return null;

  const mode = deferred ? "prompt" : platform === "ios-safari" ? "ios" : null;
  if (!mode) return null;

  function dismiss() {
    rememberInstallDismissed();
    setDeferred(null);
    setDismissedOn(pathname);
  }

  async function install() {
    if (!deferred) return;
    setPrompting(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      else dismiss();
    } catch (error) {
      console.warn("Install prompt failed:", error instanceof Error ? error.message : error);
    } finally {
      // A prompt event can only be used once, whatever happened.
      setPrompting(false);
      setDeferred(null);
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      data-install-prompt={mode}
      className="mb-10 flex flex-col gap-4 border border-background/30 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
    >
      <div className="min-w-0 max-w-xl">
        <p id={titleId} className="text-base font-semibold">
          {mode === "prompt" ? "Get Sheltüh on your home screen" : "Add Sheltüh to your Home Screen"}
        </p>
        {mode === "prompt" ? (
          <p className="mt-1 text-sm text-background/70">It opens full screen, like an app. No app store needed.</p>
        ) : (
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-background/70">
            <li>
              Tap the Share button
              <ShareIcon />
              in Safari. If you can&rsquo;t see it, tap the &middot;&middot;&middot; button first.
            </li>
            <li>
              Choose <span className="font-semibold text-background">Add to Home Screen</span>.
            </li>
            <li>
              Tap <span className="font-semibold text-background">Add</span>.
            </li>
          </ol>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {mode === "prompt" && (
          <Button variant="light" size="lg" busy={prompting} onClick={install} className="focus-visible:outline-background">
            Install
          </Button>
        )}
        <button type="button" onClick={dismiss} className={dismissButtonClass}>
          No thanks
        </button>
      </div>
    </div>
  );
}

/** The iOS share glyph (a box with an arrow out of the top). Decorative: the text names it. */
function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mx-1 inline-block h-4 w-4 -translate-y-px align-middle text-background"
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}
