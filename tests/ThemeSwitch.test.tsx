// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeSwitch from "@/components/theme/ThemeSwitch";
import ThemeSync from "@/components/theme/ThemeSync";
import { APP_THEME_COLOR, DOOR_THEME_COLOR } from "@/lib/pwa/theme";
import { THEME_STORAGE_KEY } from "@/lib/theme";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = "";
});

afterEach(() => {
  cleanup();
  pathname = "/";
  vi.restoreAllMocks();
});

function themeGroup() {
  return screen.getByRole("group", { name: "Theme" });
}

describe("ThemeSwitch (docs/design/theme-white-dark.md §5.6)", () => {
  it("is a group named Theme with Light (pressed by default) and Dark", () => {
    render(<ThemeSwitch />);
    const group = themeGroup();
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Light", "Dark"]);
    expect(within(group).getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "false");
  });

  it("chooses Dark: pressed, set on <html> and stored, with focus left on the button", () => {
    render(<ThemeSwitch />);
    const dark = screen.getByRole("button", { name: "Dark" });
    dark.focus();
    fireEvent.click(dark);
    expect(dark).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(dark).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("does nothing when the pressed option is chosen again (not a toggle-off)", () => {
    render(<ThemeSwitch />);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(setItem).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("reflects a Dark already set by the no-flash script", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ThemeSwitch />);
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps every switch on the page in step", () => {
    render(
      <>
        <ThemeSwitch />
        <ThemeSwitch />
      </>,
    );
    const [first, second] = screen.getAllByRole("group", { name: "Theme" });
    fireEvent.click(within(first).getByRole("button", { name: "Dark" }));
    expect(within(second).getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  });

  it("is Latte's 1120 footer toggle: 40px options in Label/Button, a 56px group with a 1px #595959 border, its selected state drawn from CSS, so it's right before hydration", () => {
    render(<ThemeSwitch />);
    const light = screen.getByRole("button", { name: "Light" });
    const dark = screen.getByRole("button", { name: "Dark" });
    for (const button of [light, dark]) {
      expect(button).toHaveAttribute("type", "button");
      // SemiBold 16/24 with 16 × 8 padding: 40px tall, a target well over 24px (WCAG 2.5.8).
      expect(button).toHaveClass("label-button", "px-4", "py-2", "rounded-badge");
      expect(button.querySelector("[data-selected-dots]")).toBeNull();
    }
    expect(themeGroup()).toHaveClass("h-14", "items-center", "rounded-control", "border", "border-footer-line", "bg-background", "px-2", "gap-2");
    // The chosen option is a white pill with black words; the other, #bfbfbf words. Switched by CSS on <html>.
    expect(light).toHaveClass("bg-foreground", "text-background", "dark:bg-transparent", "dark:text-footer-quiet");
    expect(dark).toHaveClass("text-footer-quiet", "hover:bg-surface", "dark:bg-foreground", "dark:text-background");
    // The "Theme" label: Latte's Mono/S (IBM Plex Mono 12/16) in #999.
    expect(screen.getByText("Theme")).toHaveClass("font-mono", "text-xs", "leading-4", "text-footer-label");
    expect(themeGroup().closest("[data-theme-switch]")).not.toBeNull();
  });
});

describe("ThemeSync (§5.5)", () => {
  function meta(content: string) {
    const el = document.createElement("meta");
    el.name = "theme-color";
    el.content = content;
    document.head.append(el);
    return el;
  }

  it("re-applies a stored Dark that the page lost (React's dev remount resets <html>)", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const colour = meta(APP_THEME_COLOR);
    render(<ThemeSync />);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    // The theme-color is the black header's in both themes: never rewritten.
    expect(colour.content).toBe(APP_THEME_COLOR);
  });

  it("leaves every theme-color alone across navigation and theme changes, the door's included", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const door = meta(DOOR_THEME_COLOR);
    const app = meta(APP_THEME_COLOR);
    const { rerender } = render(<ThemeSync />);
    pathname = "/events";
    rerender(<ThemeSync />);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "light" }));
    });
    await act(async () => {});
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(door.content).toBe(DOOR_THEME_COLOR);
    expect(app.content).toBe(APP_THEME_COLOR);
  });

  it("follows another tab's choice without writing it back", () => {
    render(
      <>
        <ThemeSync />
        <ThemeSwitch />
      </>,
    );
    // The other tab wrote it; this one only hears the event.
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" }));
    });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("catches up on a page restored from the back/forward cache, but not on a normal pageshow", () => {
    render(<ThemeSync />);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
