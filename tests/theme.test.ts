// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_THEME_COLOR, DARK_THEME_COLOR, DOOR_THEME_COLOR } from "@/lib/pwa/theme";
import {
  getTheme,
  readStoredTheme,
  setTheme,
  subscribeTheme,
  syncThemeColor,
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

  it("turns Dark on from a stored dark, and swaps a white theme-color to black", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const meta = themeColorMeta(APP_THEME_COLOR);
    runInitScript();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(meta.content).toBe(DARK_THEME_COLOR);
  });

  it("fixes a theme-color that arrives later in the head, once the document has parsed", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runInitScript();
    const meta = themeColorMeta(APP_THEME_COLOR);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(meta.content).toBe(DARK_THEME_COLOR);
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
  it("stores the choice, toggles the attribute and syncs theme-color", () => {
    const meta = themeColorMeta(APP_THEME_COLOR);
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);

    setTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(getTheme()).toBe("dark");
    expect(meta.content).toBe(DARK_THEME_COLOR);

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

  it("drops the script's changed theme-color once React has rendered its own, and keeps it otherwise", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const scripted = themeColorMeta(APP_THEME_COLOR);
    runInitScript();
    syncThemeColor("dark");
    expect(scripted.isConnected).toBe(true); // the only one: kept
    // React didn't adopt it (its content changed) and renders its own white one.
    const reacts = themeColorMeta(APP_THEME_COLOR);
    syncThemeColor("dark");
    expect(scripted.isConnected).toBe(false);
    expect([...document.querySelectorAll('meta[name="theme-color"]')]).toEqual([reacts]);
    expect(reacts.content).toBe(DARK_THEME_COLOR);
  });

  it("syncThemeColor only swaps white and black, never another colour", () => {
    const door = themeColorMeta(DOOR_THEME_COLOR);
    const app = themeColorMeta(DARK_THEME_COLOR);
    syncThemeColor("light");
    expect(app.content).toBe(APP_THEME_COLOR);
    expect(door.content).toBe(DOOR_THEME_COLOR);
    syncThemeColor("dark");
    expect(app.content).toBe(DARK_THEME_COLOR);
    expect(door.content).toBe(DOOR_THEME_COLOR);
  });
});
