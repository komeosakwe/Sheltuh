// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

interface ShellOptions {
  origin: string;
  currentPath(): string;
  navigate(path: string): void;
  goBack(): void;
}

const stop = vi.fn<() => void>();
const startNativeShell = vi.fn<(options: ShellOptions) => Promise<() => void>>(async () => stop);
vi.mock("@/lib/mobile/native-shell", () => ({ startNativeShell }));

const { default: NativeAppShell } = await import("@/components/mobile/NativeAppShell");

function inApp(native: boolean) {
  Object.defineProperty(window, "Capacitor", { value: { isNativePlatform: () => native }, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "Capacitor");
});

describe("NativeAppShell", () => {
  it("does nothing in a browser: the Capacitor code isn't even loaded", async () => {
    const { container } = render(<NativeAppShell />);
    expect(container).toBeEmptyDOMElement();
    // Give a dynamic import every chance to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(startNativeShell).not.toHaveBeenCalled();
  });

  it("does nothing under Capacitor's web build (isNativePlatform false)", async () => {
    inApp(false);
    render(<NativeAppShell />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(startNativeShell).not.toHaveBeenCalled();
  });

  it("inside the app, starts the native shell with this page's origin and the router", async () => {
    inApp(true);
    window.history.replaceState(null, "", "/events?when=today#list");
    render(<NativeAppShell />);
    await vi.waitFor(() => expect(startNativeShell).toHaveBeenCalledTimes(1));

    const options = startNativeShell.mock.calls[0][0];
    expect(options.origin).toBe(window.location.origin);
    expect(options.currentPath()).toBe("/events?when=today#list");
    options.navigate("/events/rooftop-jazz");
    expect(push).toHaveBeenCalledWith("/events/rooftop-jazz");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    options.goBack();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("stops the shell on unmount", async () => {
    inApp(true);
    const { unmount } = render(<NativeAppShell />);
    await vi.waitFor(() => expect(startNativeShell).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops it straight away if unmounted before it finished starting", async () => {
    inApp(true);
    let finish: (value: () => void) => void = () => {};
    startNativeShell.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const { unmount } = render(<NativeAppShell />);
    await vi.waitFor(() => expect(startNativeShell).toHaveBeenCalledTimes(1));
    unmount();
    expect(stop).not.toHaveBeenCalled();
    finish(stop);
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });
});
