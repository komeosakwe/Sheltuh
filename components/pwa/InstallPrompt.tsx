"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
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

/** Text buttons, 44px tall: the offer is a secondary action, never a banner or a filled button. */
const actionButtonClass =
  "inline-flex min-h-11 items-center text-sm leading-5 font-semibold text-foreground underline underline-offset-4 hover:decoration-2";
const dismissButtonClass =
  "inline-flex min-h-11 items-center text-sm leading-5 text-muted underline underline-offset-4 hover:text-foreground";

/**
 * "Add Sheltüh to your home screen": a quiet line in the footer, under the
 * brand note, on browsing pages (see lib/pwa/install.ts for where). One line
 * of muted text and two text buttons, no box. Android/desktop Chrome: only
 * once the browser says the app is installable (beforeinstallprompt), with
 * Install. iOS Safari (no install API): "Show me how" opens the Add to Home
 * Screen steps. Never when already installed, and "No thanks" is
 * remembered. No animation.
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
  const [stepsOpen, setStepsOpen] = useState(false);
  const titleId = useId();
  const stepsId = useId();

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
        className="mt-3 max-w-sm text-sm leading-5 text-muted focus:outline-none"
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
    if (!deferred || prompting) return;
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
    <div role="group" aria-labelledby={titleId} data-install-prompt={mode} className="mt-3 max-w-sm">
      <div className="flex flex-wrap items-center gap-x-4">
        <p id={titleId} className="text-sm leading-5 text-muted">
          {mode === "prompt" ? "Get Sheltüh on your home screen" : "Add Sheltüh to your Home Screen"}
        </p>
        <div className="flex items-center gap-x-4">
          {mode === "prompt" ? (
            <button type="button" aria-busy={prompting || undefined} onClick={install} className={actionButtonClass}>
              Install
            </button>
          ) : (
            <button
              type="button"
              aria-expanded={stepsOpen}
              aria-controls={stepsOpen ? stepsId : undefined}
              onClick={() => setStepsOpen((open) => !open)}
              className={actionButtonClass}
            >
              Show me how
            </button>
          )}
          <button type="button" onClick={dismiss} className={dismissButtonClass}>
            No thanks
          </button>
        </div>
      </div>
      {mode === "ios" && stepsOpen && (
        <ol id={stepsId} className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-sm leading-5 text-muted">
          <li>
            Tap the Share button
            <ShareIcon />
            in Safari. If you can&rsquo;t see it, tap the &middot;&middot;&middot; button first.
          </li>
          <li>
            Choose <span className="font-semibold text-foreground">Add to Home Screen</span>.
          </li>
          <li>
            Tap <span className="font-semibold text-foreground">Add</span>.
          </li>
        </ol>
      )}
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
      className="mx-1 inline-block h-4 w-4 -translate-y-px align-middle text-foreground"
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}
