// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_THEME_COLOR, DOOR_THEME_COLOR } from "@/lib/pwa/theme";
import {
  getTheme,
  readStoredTheme,
  setTheme,
  subscribeTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

/** Runs the no-flash script as the browser would, inline. */
function runInitScript() {
  new Function(THEME_INIT_SCRIPT)();
}

function themeColorMeta(content: string) {
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = content;
  document.head.append(meta);
  return meta;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.head.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("THEME_INIT_SCRIPT (docs/design/theme-white-dark.md §5.4)", () => {
  it("is plain inline JavaScript keyed on sheltuh:theme", () => {
    expect(THEME_STORAGE_KEY).toBe("sheltuh:theme");
    expect(THEME_INIT_SCRIPT).toContain('"sheltuh:theme"');
    expect(THEME_INIT_SCRIPT).not.toMatch(/<\/?script/i);
  });

  // The redesign's header is black in both themes, so the theme-color is black for everyone: the
  // script turns Dark on and leaves the meta alone (no swap, no stale copy for React to replace).
  it("turns Dark on from a stored dark, and leaves the black theme-color as it is", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const meta = themeColorMeta(APP_THEME_COLOR);
    runInitScript();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(meta.content).toBe(APP_THEME_COLOR);
    expect(meta).not.toHaveAttribute("data-theme-fixed");
    expect(THEME_INIT_SCRIPT).not.toContain("theme-color");
  });

  it.each([["light"], [null], ["purple"], ["DARK"]])("leaves the page Light for a stored %s", (stored) => {
    if (stored !== null) localStorage.setItem(THEME_STORAGE_KEY, stored);
    const meta = themeColorMeta(APP_THEME_COLOR);
    runInitScript();
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(meta.content).toBe(APP_THEME_COLOR);
  });

  it("leaves the page Light when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => runInitScript()).not.toThrow();
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("never touches the door's own theme colour", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const meta = themeColorMeta(DOOR_THEME_COLOR);
    runInitScript();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(meta.content).toBe(DOOR_THEME_COLOR);
  });
});

describe("setTheme / getTheme", () => {
  it("stores the choice and toggles the attribute; the theme-color stays the header's black", () => {
    const meta = themeColorMeta(APP_THEME_COLOR);
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);

    setTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(getTheme()).toBe("dark");
    expect(meta.content).toBe(APP_THEME_COLOR);

    setTheme("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(getTheme()).toBe("light");
    expect(meta.content).toBe(APP_THEME_COLOR);

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setTheme("dark");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("still applies the theme for the page's life when storage fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => setTheme("dark")).not.toThrow();
    expect(getTheme()).toBe("dark");
  });

  it("reads an unknown or unreadable stored value as Light", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readStoredTheme()).toBe("light");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredTheme()).toBe("dark");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readStoredTheme()).toBe("light");
  });

  it("never touches any theme-color, the door's included", () => {
    const door = themeColorMeta(DOOR_THEME_COLOR);
    const app = themeColorMeta(APP_THEME_COLOR);
    setTheme("light");
    setTheme("dark");
    expect(app.content).toBe(APP_THEME_COLOR);
    expect(door.content).toBe(DOOR_THEME_COLOR);
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(2);
  });
});
