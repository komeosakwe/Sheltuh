// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeSwitch from "@/components/theme/ThemeSwitch";
import ThemeSync from "@/components/theme/ThemeSync";
import { APP_THEME_COLOR, DARK_THEME_COLOR, DOOR_THEME_COLOR } from "@/lib/pwa/theme";
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

  it("has 44px segments and draws its selected state from CSS, so it's right before hydration", () => {
    render(<ThemeSwitch />);
    const light = screen.getByRole("button", { name: "Light" });
    const dark = screen.getByRole("button", { name: "Dark" });
    for (const button of [light, dark]) {
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveClass("min-h-11");
      expect(button.className).not.toMatch(/\bsm:min-h/);
    }
    expect(light).toHaveClass("bg-foreground", "text-background", "dark:bg-transparent", "dark:text-foreground");
    expect(dark).toHaveClass("text-foreground", "hover:bg-surface", "dark:bg-foreground", "dark:text-background");
    // The orange dots mark the selected option (not colour alone), shown by the same CSS switch.
    expect(light.querySelector("[data-selected-dots]")?.parentElement).toHaveClass("flex", "dark:hidden");
    expect(dark.querySelector("[data-selected-dots]")?.parentElement).toHaveClass("hidden", "dark:flex");
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
    expect(colour.content).toBe(DARK_THEME_COLOR);
  });

  it("re-syncs a theme-color rewritten on navigation, and leaves the door's alone", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const colour = meta(DOOR_THEME_COLOR);
    const { rerender } = render(<ThemeSync />);
    expect(colour.content).toBe(DOOR_THEME_COLOR);
    // Next writes the root layout's colour back when you leave the door.
    colour.content = APP_THEME_COLOR;
    pathname = "/events";
    rerender(<ThemeSync />);
    await act(async () => {});
    expect(colour.content).toBe(DARK_THEME_COLOR);
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
