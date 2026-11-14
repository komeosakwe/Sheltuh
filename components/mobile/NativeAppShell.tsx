"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { closeTopOverlay } from "@/lib/mobile/close-overlay";
import { isNativeApp } from "@/lib/mobile/native";

/**
 * The phone app's native glue (deep links, Android back button;
 * lib/mobile/native-shell.ts). Renders nothing. In a browser it does nothing
 * and loads nothing: the Capacitor code is a separate chunk, fetched only
 * inside the app. See docs/mobile-app.md.
 */
export default function NativeAppShell() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp(window)) return;
    let stop: (() => void) | undefined;
    let cancelled = false;

    import("@/lib/mobile/native-shell")
      .then(({ startNativeShell }) =>
        startNativeShell({
          origin: window.location.origin,
          currentPath: () => `${window.location.pathname}${window.location.search}${window.location.hash}`,
          navigate: (path) => router.push(path),
          goBack: () => window.history.back(),
          closeOverlay: () => closeTopOverlay(document),
        }),
      )
      .then((stopShell) => {
        if (cancelled) stopShell();
        else stop = stopShell;
      })
      .catch((error: unknown) => {
        // The site still works without it; leave a trace for debugging.
        console.warn("Native app setup failed:", error instanceof Error ? error.message : error);
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [router]);

  return null;
}
