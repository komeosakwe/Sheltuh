import { useSyncExternalStore } from "react";
import { vi } from "vitest";

/**
 * The URL's query as a tiny store, for components that keep a filter in it
 * (useSearchParams + router.replace): replace() changes it and re-renders
 * whoever reads it. Use with
 *
 *   vi.mock("next/navigation", async () => (await import("./test-utils/fakeUrl")).fakeNavigation);
 *
 * and reset it with `fakeUrl.set("")` and `fakeUrl.replace.mockReset()` before each test.
 */
let params = new URLSearchParams();
const listeners = new Set<() => void>();

export const fakeUrl = {
  get: () => params,
  set(query: string) {
    params = new URLSearchParams(query);
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Every router.replace(href, options), for assertions. */
  replace: vi.fn(),
};

export const fakeNavigation = {
  useSearchParams: () => useSyncExternalStore(fakeUrl.subscribe, fakeUrl.get),
  useRouter: () => ({
    replace: (href: string, options?: unknown) => {
      fakeUrl.replace(href, options);
      fakeUrl.set(href.split("?")[1] ?? "");
    },
    push: vi.fn(),
  }),
  usePathname: () => "/admin",
};
