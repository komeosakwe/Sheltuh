/**
 * Registers public/sw.js, or removes it when the kill switch is on. See
 * docs/pwa.md ("Kill switch").
 */

export const SERVICE_WORKER_URL = "/sw.js";
/** Every cache public/sw.js creates starts with this. */
export const CACHE_PREFIX = "sheltuh-";

export interface ServiceWorkerEnvironment {
  /** process.env.NODE_ENV === "production" */
  production: boolean;
  /** The kill switch (NEXT_PUBLIC_DISABLE_SERVICE_WORKER). */
  disabled: boolean;
  /** window.location.protocol */
  protocol: string;
  container?: Pick<ServiceWorkerContainer, "register" | "getRegistrations">;
  cacheStorage?: Pick<CacheStorage, "keys" | "delete">;
}

export type ServiceWorkerOutcome = "registered" | "removed" | "skipped";

/** "1", "true", "yes" or "on" (any case) turns the service worker off. */
export function isKillSwitchOn(value: string | undefined): boolean {
  return typeof value === "string" && /^(?:1|true|yes|on)$/i.test(value.trim());
}

export async function syncServiceWorker(env: ServiceWorkerEnvironment): Promise<ServiceWorkerOutcome> {
  if (!env.container) return "skipped";

  if (env.disabled) {
    const registrations = await env.container.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if (env.cacheStorage) {
      const keys = await env.cacheStorage.keys();
      await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => env.cacheStorage?.delete(key)));
    }
    return "removed";
  }

  // Production builds served over HTTPS only: never on `next dev`, and never
  // on plain http (where browsers would refuse it anyway, except localhost).
  if (!env.production || env.protocol !== "https:") return "skipped";

  // updateViaCache "none": the browser always revalidates sw.js itself, so a
  // fix (or the emergency kill-switch worker) reaches people on their next visit.
  await env.container.register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" });
  return "registered";
}
