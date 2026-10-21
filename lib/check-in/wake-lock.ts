/**
 * Keeps the screen on while the door scanner's camera is live
 * (docs/design/check-in.md §5.A3). Fails silently: no Wake Lock API, a
 * refusal (low battery, page hidden) or an error just means the phone may
 * dim as usual.
 */
export interface ScreenWakeLock {
  release(): Promise<void>;
}

export async function requestScreenWakeLock(): Promise<ScreenWakeLock | null> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator) || !navigator.wakeLock) return null;
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    return {
      release: async () => {
        try {
          if (!sentinel.released) await sentinel.release();
        } catch {
          // Already released by the browser (page hidden): nothing to do.
        }
      },
    };
  } catch {
    return null;
  }
}
