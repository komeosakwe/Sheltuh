/**
 * Whether this page is running inside the Sheltüh phone app (the Capacitor
 * shell, docs/mobile-app.md) rather than a browser.
 *
 * Capacitor's native side puts `window.Capacitor` on the page before any of
 * the site's scripts run, and its `isNativePlatform()` answers true only
 * there. Reading it directly (instead of importing @capacitor/core) keeps the
 * check free for every website visitor: the Capacitor code itself is only
 * downloaded inside the app (components/mobile/NativeAppShell.tsx).
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

export function isNativeApp(win: Window | undefined = typeof window === "undefined" ? undefined : window): boolean {
  const capacitor = (win as (Window & { Capacitor?: CapacitorGlobal }) | undefined)?.Capacitor;
  if (typeof capacitor?.isNativePlatform !== "function") return false;
  try {
    return capacitor.isNativePlatform() === true;
  } catch {
    return false;
  }
}
