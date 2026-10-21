"use client";

import { useSyncExternalStore } from "react";
import DoorIcon from "./DoorIcon";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Whether the browser says it's online (it can be wrong, so scans are still attempted). True on the server. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * §5.A5: shown while the browser reports being offline. The status region is
 * always mounted (empty while online), so going offline is announced: a live
 * region that appears together with its text often isn't.
 */
export default function OfflineBanner({ online }: { online: boolean }) {
  return (
    <div role="status" className="sticky top-0 z-10">
      {!online && (
        <div className="flex min-h-11 items-center gap-2 bg-door-hold px-4 py-3 text-sm font-semibold text-door-hold-foreground">
          <DoorIcon name="alert" className="size-5" />
          You&rsquo;re offline. Scans can&rsquo;t be checked until you reconnect.
        </div>
      )}
    </div>
  );
}
