// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import { INSTALL_DISMISSED_KEY, resetInstallDismissedForTests } from "@/lib/pwa/install";
import { UA } from "./test-utils/user-agents";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

function stubDisplayMode(mode: "browser" | "standalone") {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === `(display-mode: ${mode})`,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function useUserAgent(ua: string, touchPoints = 5) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  // jsdom doesn't define maxTouchPoints.
  Object.defineProperty(navigator, "maxTouchPoints", { value: touchPoints, configurable: true });
}

/** A synthetic beforeinstallprompt, like Chrome's. */
function fireBeforeInstallPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

const group = () => screen.queryByRole("group", { name: /home screen/i });

beforeEach(() => {
  stubDisplayMode("browser");
  useUserAgent(UA.androidChrome);
});

afterEach(() => {
  cleanup();
  pathname = "/";
  resetInstallDismissedForTests();
  window.localStorage.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(navigator, "maxTouchPoints");
});

describe("InstallPrompt on Chrome (beforeinstallprompt)", () => {
  it("shows nothing until the browser says the app is installable", () => {
    render(<InstallPrompt />);
    expect(group()).toBeNull();
  });

  it("then offers Install and No thanks, and stops Chrome's own infobar", () => {
    render(<InstallPrompt />);
    const event = fireBeforeInstallPrompt();
    expect(event.defaultPrevented).toBe(true);
    expect(group()).toHaveTextContent("Get Sheltüh on your home screen");
    const install = screen.getByRole("button", { name: "Install" });
    const noThanks = screen.getByRole("button", { name: "No thanks" });
    // 48px pill and a 44px text button.
    expect(install.className).toContain("btn-lg");
    expect(noThanks.className).toContain("min-h-11");
  });

  it("opens the browser's install dialog and goes away once accepted", async () => {
    render(<InstallPrompt />);
    const event = fireBeforeInstallPrompt("accepted");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(group()).toBeNull();
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBeNull();
  });

  it("treats declining the browser's dialog as No thanks", async () => {
    render(<InstallPrompt />);
    fireBeforeInstallPrompt("dismissed");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
    });
    expect(group()).toBeNull();
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).not.toBeNull();
  });

  it("hides when the app gets installed some other way", () => {
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(group()).toBeNull();
  });
});

describe("InstallPrompt: No thanks", () => {
  it("remembers the choice, confirms it and moves focus to the confirmation", () => {
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(group()).toBeNull();
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).not.toBeNull();
    const confirmation = screen.getByRole("status");
    expect(confirmation).toHaveTextContent("won’t suggest this again");
    expect(confirmation).toHaveFocus();
  });

  it("stays hidden on later visits, even when the browser offers the install again", () => {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, "2026-10-01T00:00:00.000Z");
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    expect(group()).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("still hides when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    expect(group()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(group()).toBeNull();
  });
});

describe("InstallPrompt on iOS", () => {
  it("shows the Add to Home Screen steps in Safari", () => {
    useUserAgent(UA.iphoneSafari);
    render(<InstallPrompt />);
    expect(group()).toHaveTextContent("Add Sheltüh to your Home Screen");
    expect(screen.getByRole("list")).toHaveTextContent("Add to Home Screen");
    // There's no install API on iOS, so no Install button.
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(screen.getByRole("button", { name: "No thanks" })).toBeInTheDocument();
  });

  it.each([
    ["Chrome on iOS", UA.iphoneChrome],
    ["Instagram's in-app browser", UA.iphoneInstagram],
  ])("shows nothing in %s, where the steps would be wrong", (_label, ua) => {
    useUserAgent(ua);
    render(<InstallPrompt />);
    expect(group()).toBeNull();
  });
});

describe("InstallPrompt: where it never appears", () => {
  it("not when already running as an installed app", () => {
    stubDisplayMode("standalone");
    render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    expect(group()).toBeNull();
  });

  it("not in an installed iOS app", () => {
    useUserAgent(UA.iphoneSafari);
    vi.spyOn(window, "navigator", "get").mockReturnValue(
      Object.assign(Object.create(navigator), { standalone: true }) as Navigator,
    );
    render(<InstallPrompt />);
    expect(group()).toBeNull();
  });

  it.each(["/events/rooftop-jazz", "/checkout/success", "/messages", "/messages/abc", "/login", "/account", "/dashboard"])(
    "not on %s (checkout, conversations, forms)",
    (p) => {
      pathname = p;
      render(<InstallPrompt />);
      fireBeforeInstallPrompt();
      expect(group()).toBeNull();
    },
  );

  it("disappears when moving from a browsing page to an event page, and comes back after", () => {
    const { rerender } = render(<InstallPrompt />);
    fireBeforeInstallPrompt();
    expect(group()).not.toBeNull();
    pathname = "/events/rooftop-jazz";
    rerender(<InstallPrompt />);
    expect(group()).toBeNull();
    pathname = "/events";
    rerender(<InstallPrompt />);
    expect(group()).not.toBeNull();
  });

  it("renders nothing on the server, so hydration never mismatches", () => {
    expect(renderToString(<InstallPrompt />)).toBe("");
  });
});
