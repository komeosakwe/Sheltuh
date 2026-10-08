// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectInstallPlatform,
  getInstallDismissed,
  INSTALL_DISMISSED_KEY,
  installPromptAllowedOn,
  isIosSafari,
  isStandalone,
  rememberInstallDismissed,
  resetInstallDismissedForTests,
} from "@/lib/pwa/install";
import { CACHE_PREFIX, isKillSwitchOn, syncServiceWorker } from "@/lib/pwa/service-worker";
import { UA } from "./test-utils/user-agents";

afterEach(() => {
  resetInstallDismissedForTests();
  window.localStorage.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("isIosSafari", () => {
  it("is true for Safari on iPhone, and for iPad Safari's desktop-style user agent on a touch screen", () => {
    expect(isIosSafari(UA.iphoneSafari)).toBe(true);
    expect(isIosSafari(UA.ipadDesktopSafari, 5)).toBe(true);
  });

  it.each([
    ["Chrome on iOS", UA.iphoneChrome, 5],
    ["Firefox on iOS", UA.iphoneFirefox, 5],
    ["Instagram's in-app browser", UA.iphoneInstagram, 5],
    ["Facebook's in-app browser", UA.iphoneFacebook, 5],
    ["Chrome on Android", UA.androidChrome, 5],
    ["Safari on a Mac (no touch screen)", UA.macSafari, 0],
  ])("is false for %s", (_label, ua, touchPoints) => {
    expect(isIosSafari(ua, touchPoints)).toBe(false);
  });
});

describe("installPromptAllowedOn", () => {
  it.each(["/", "/events", "/map", "/search", "/about", "/help", "/partners"])("allows browsing page %s", (p) => {
    expect(installPromptAllowedOn(p)).toBe(true);
  });

  it.each([
    "/events/rooftop-jazz",
    "/checkout/success",
    "/messages",
    "/messages/abc",
    "/login",
    "/signup",
    "/verify",
    "/forgot-password",
    "/account",
    "/dashboard",
    "/dashboard/new",
    "/admin",
    "/organisers/apply",
    "/organisers/submit",
    "/privacy",
    null,
    undefined,
  ])("never shows on %s", (p) => {
    expect(installPromptAllowedOn(p)).toBe(false);
  });
});

function stubDisplayMode(mode: "browser" | "standalone" | "fullscreen") {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === `(display-mode: ${mode})`,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("isStandalone / detectInstallPlatform", () => {
  it("is false in a normal browser tab, and without matchMedia", () => {
    expect(isStandalone(window)).toBe(false);
    stubDisplayMode("browser");
    expect(isStandalone(window)).toBe(false);
  });

  it("is true when installed (display-mode) or on iOS's navigator.standalone", () => {
    stubDisplayMode("standalone");
    expect(isStandalone(window)).toBe(true);
    stubDisplayMode("browser");
    vi.spyOn(window, "navigator", "get").mockReturnValue({ ...navigator, standalone: true } as Navigator);
    expect(isStandalone(window)).toBe(true);
  });

  it("puts standalone ahead of the browser check", () => {
    stubDisplayMode("standalone");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(UA.iphoneSafari);
    expect(detectInstallPlatform(window)).toBe("standalone");
    stubDisplayMode("browser");
    expect(detectInstallPlatform(window)).toBe("ios-safari");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(UA.androidChrome);
    expect(detectInstallPlatform(window)).toBe("other");
  });
});

describe("install dismissal", () => {
  it("is remembered in localStorage", () => {
    expect(getInstallDismissed()).toBe(false);
    rememberInstallDismissed();
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).not.toBeNull();
    resetInstallDismissedForTests();
    expect(getInstallDismissed()).toBe(true);
  });

  it("still works for the page view when storage throws (private modes)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "QuotaExceededError");
    });
    expect(getInstallDismissed()).toBe(false);
    expect(() => rememberInstallDismissed()).not.toThrow();
    expect(getInstallDismissed()).toBe(true);
  });
});

/* ------------------------------------------------- service worker registration */

function fakeContainer(registrations: { unregister: () => Promise<boolean> }[] = []) {
  return {
    register: vi.fn(async () => ({}) as ServiceWorkerRegistration),
    getRegistrations: vi.fn(async () => registrations as unknown as ServiceWorkerRegistration[]),
  };
}

function fakeCacheStorage(names: string[]) {
  const store = new Set(names);
  return {
    store,
    keys: vi.fn(async () => [...store]),
    delete: vi.fn(async (name: string) => store.delete(name)),
  };
}

describe("syncServiceWorker", () => {
  it("registers /sw.js at the root scope in a production build on HTTPS", async () => {
    const container = fakeContainer();
    const outcome = await syncServiceWorker({ production: true, disabled: false, protocol: "https:", container });
    expect(outcome).toBe("registered");
    expect(container.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
  });

  it.each([
    ["in development", { production: false, protocol: "https:" }],
    ["on plain http", { production: true, protocol: "http:" }],
  ])("doesn't register %s", async (_label, env) => {
    const container = fakeContainer();
    expect(await syncServiceWorker({ ...env, disabled: false, container })).toBe("skipped");
    expect(container.register).not.toHaveBeenCalled();
  });

  it("does nothing where service workers aren't supported", async () => {
    expect(await syncServiceWorker({ production: true, disabled: false, protocol: "https:" })).toBe("skipped");
  });

  it("with the kill switch on, unregisters every worker and deletes only Sheltüh caches", async () => {
    const unregister = vi.fn(async () => true);
    const container = fakeContainer([{ unregister }, { unregister }]);
    const cacheStorage = fakeCacheStorage([`${CACHE_PREFIX}static-v1`, `${CACHE_PREFIX}shell-v1`, "other-app"]);
    const outcome = await syncServiceWorker({ production: true, disabled: true, protocol: "https:", container, cacheStorage });
    expect(outcome).toBe("removed");
    expect(container.register).not.toHaveBeenCalled();
    expect(unregister).toHaveBeenCalledTimes(2);
    expect([...cacheStorage.store]).toEqual(["other-app"]);
  });

  it.each([
    ["1", true],
    ["true", true],
    [" ON ", true],
    ["yes", true],
    ["0", false],
    ["false", false],
    ["", false],
    [undefined, false],
  ])("reads the kill switch value %j as %s", (value, expected) => {
    expect(isKillSwitchOn(value)).toBe(expected);
  });
});
