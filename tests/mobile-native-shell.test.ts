import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capacitor's JS, mocked: the native side doesn't exist in tests.
type Listener = (event: Record<string, unknown>) => void;
const listeners = new Map<string, Listener>();
const removed: string[] = [];
const app = {
  addListener: vi.fn(async (event: string, listener: Listener) => {
    listeners.set(event, listener);
    return { remove: vi.fn(async () => void removed.push(event)) };
  }),
  minimizeApp: vi.fn(async () => undefined),
  exitApp: vi.fn(async () => undefined),
};
const capacitor = { isNativePlatform: vi.fn(() => true), getPlatform: vi.fn(() => "android") };
vi.mock("@capacitor/app", () => ({ App: app }));
vi.mock("@capacitor/core", () => ({ Capacitor: capacitor }));

const { startNativeShell } = await import("@/lib/mobile/native-shell");

function options(current = "/") {
  return {
    origin: "https://sheltuh.com.au",
    currentPath: vi.fn(() => current),
    navigate: vi.fn(),
    goBack: vi.fn(),
  };
}

beforeEach(() => {
  listeners.clear();
  removed.length = 0;
  capacitor.isNativePlatform.mockReturnValue(true);
  capacitor.getPlatform.mockReturnValue("android");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("startNativeShell: deep links", () => {
  it("shows the page a link to our site opened the app with", async () => {
    const opts = options();
    await startNativeShell(opts);
    listeners.get("appUrlOpen")?.({ url: "https://sheltuh.com.au/events/rooftop-jazz?ref=ig" });
    expect(opts.navigate).toHaveBeenCalledWith("/events/rooftop-jazz?ref=ig");
  });

  it.each([
    "https://evil.example/events/x",
    "https://sheltuh.com.au.evil.example/events/x",
    "au.com.sheltuh.app://events/x",
    "javascript:alert(1)",
    "https://sheltuh.com.au/.//evil.example",
  ])("ignores %s", async (url) => {
    const opts = options();
    await startNativeShell(opts);
    listeners.get("appUrlOpen")?.({ url });
    expect(opts.navigate).not.toHaveBeenCalled();
  });

  it("doesn't navigate again to the page already on screen", async () => {
    const opts = options("/events/x");
    await startNativeShell(opts);
    listeners.get("appUrlOpen")?.({ url: "https://sheltuh.com.au/events/x" });
    expect(opts.navigate).not.toHaveBeenCalled();
  });
});

describe("startNativeShell: Android back button", () => {
  it("goes back when there's somewhere to go back to", async () => {
    const opts = options();
    await startNativeShell(opts);
    listeners.get("backButton")?.({ canGoBack: true });
    expect(opts.goBack).toHaveBeenCalledTimes(1);
    expect(app.minimizeApp).not.toHaveBeenCalled();
  });

  it("leaves the app (to the background, as Android 12+ does) on the first page", async () => {
    const opts = options();
    await startNativeShell(opts);
    listeners.get("backButton")?.({ canGoBack: false });
    expect(opts.goBack).not.toHaveBeenCalled();
    expect(app.minimizeApp).toHaveBeenCalledTimes(1);
    expect(app.exitApp).not.toHaveBeenCalled();
  });

  it("isn't registered on iOS (no back button; Capacitor's default stays)", async () => {
    capacitor.getPlatform.mockReturnValue("ios");
    await startNativeShell(options());
    expect(listeners.has("appUrlOpen")).toBe(true);
    expect(listeners.has("backButton")).toBe(false);
  });
});

describe("startNativeShell: lifecycle", () => {
  it("does nothing outside the app", async () => {
    capacitor.isNativePlatform.mockReturnValue(false);
    const stop = await startNativeShell(options());
    expect(app.addListener).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it("stops listening when stopped", async () => {
    const stop = await startNativeShell(options());
    stop();
    await vi.waitFor(() => expect(removed.sort()).toEqual(["appUrlOpen", "backButton"]));
  });
});
