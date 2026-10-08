"use client";

import { useEffect } from "react";
import { isKillSwitchOn, syncServiceWorker } from "@/lib/pwa/service-worker";

/**
 * Registers the service worker after the page has loaded (production on
 * HTTPS only), or removes it when NEXT_PUBLIC_DISABLE_SERVICE_WORKER is set.
 * Renders nothing. See docs/pwa.md.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    function run() {
      syncServiceWorker({
        production: process.env.NODE_ENV === "production",
        disabled: isKillSwitchOn(process.env.NEXT_PUBLIC_DISABLE_SERVICE_WORKER),
        protocol: window.location.protocol,
        container: "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
        cacheStorage: typeof caches === "undefined" ? undefined : caches,
      }).catch((error: unknown) => {
        // The site works the same without it; leave a trace for debugging.
        console.warn("Service worker setup failed:", error instanceof Error ? error.message : error);
      });
    }

    // Don't compete with the page's own first load.
    if (document.readyState === "complete") {
      run();
      return;
    }
    window.addEventListener("load", run, { once: true });
    return () => window.removeEventListener("load", run);
  }, []);

  return null;
}
