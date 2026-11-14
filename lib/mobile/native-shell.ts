import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { deepLinkPath } from "@/lib/mobile/deep-link";

/**
 * The phone app's native behaviour (docs/mobile-app.md). Loaded only inside
 * the app, on demand (components/mobile/NativeAppShell.tsx), so the website
 * never downloads Capacitor.
 *
 * - A link that opens the app (App Link / Universal Link) shows that page,
 *   if it's one of ours (lib/mobile/deep-link.ts).
 * - Android's back button/gesture closes an open dialog or menu first; then it
 *   goes back through the pages visited in the app; on the first page it
 *   leaves the app the way Android 12+ does for any app (moved to the
 *   background, not closed).
 */

export interface NativeShellOptions {
  /** The app's own origin: window.location.origin. */
  origin: string;
  /** The page on screen now (path, query and fragment). */
  currentPath(): string;
  /** Show a same-site path (the Next router's push). */
  navigate(path: string): void;
  /** One step back in the app's history (window.history.back). */
  goBack(): void;
  /** Close the dialog or menu on top, if any (lib/mobile/close-overlay.ts); true if one was open. */
  closeOverlay(): boolean;
}

/** Starts listening and resolves to a function that stops it. Nothing happens outside the app. */
export async function startNativeShell(options: NativeShellOptions): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  const pending: Promise<PluginListenerHandle>[] = [
    App.addListener("appUrlOpen", ({ url }) => {
      const path = deepLinkPath(url, options.origin);
      if (path !== null && path !== options.currentPath()) options.navigate(path);
    }),
  ];
  // Without a listener Capacitor's App plugin goes back itself but does nothing on the
  // first page (so Back could never leave the app): handle both here.
  if (Capacitor.getPlatform() === "android") {
    pending.push(
      App.addListener("backButton", ({ canGoBack }) => {
        // An open dialog or menu closes first, as Escape does in a browser.
        if (options.closeOverlay()) return;
        if (canGoBack) {
          options.goBack();
          return;
        }
        App.minimizeApp().catch((error: unknown) => {
          console.warn("Couldn't leave the app:", error instanceof Error ? error.message : error);
        });
      }),
    );
  }

  const handles = await Promise.all(pending);
  return () => {
    for (const handle of handles) {
      handle.remove().catch(() => {
        // Already gone (the page is unloading): nothing to clean up.
      });
    }
  };
}
