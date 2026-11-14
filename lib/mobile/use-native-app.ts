import { useSyncExternalStore } from "react";
import { isNativeApp } from "@/lib/mobile/native";

const noSubscription = () => () => {};

/**
 * Inside the Sheltüh phone app (lib/mobile/native.ts), for rendering.
 * Hydration-safe: false on the server and while hydrating, then the real
 * answer, so a page renders the same as in a browser first.
 */
export function useNativeApp(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => isNativeApp(window),
    () => false,
  );
}
