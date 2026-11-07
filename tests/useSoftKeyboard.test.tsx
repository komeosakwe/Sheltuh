// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissKeyboardOnEnter, isTextEntry, SOFT_KEYBOARD_MIN_PX, useSoftKeyboardOpen } from "@/lib/use-soft-keyboard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "visualViewport");
});

function stubViewport(height: number) {
  const listeners = new Set<() => void>();
  const viewport = {
    height,
    scale: 1,
    addEventListener: vi.fn((_: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_: string, listener: () => void) => listeners.delete(listener)),
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  return { viewport, listeners };
}

describe("useSoftKeyboardOpen", () => {
  it("lets go of every listener it added when the component unmounts", () => {
    const { viewport, listeners } = stubViewport(window.innerHeight);
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useSoftKeyboardOpen());
    expect(listeners.size).toBe(1);
    const focusTypes = (calls: ReadonlyArray<readonly [string, ...unknown[]]>) =>
      calls.map(([type]) => type).filter((type) => type.startsWith("focus")).sort();
    expect(focusTypes(add.mock.calls)).toEqual(["focusin", "focusout"]);
    unmount();
    expect(viewport.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(listeners.size).toBe(0);
    expect(focusTypes(remove.mock.calls)).toEqual(["focusin", "focusout"]);
    // The very functions it added.
    for (const type of ["focusin", "focusout"]) {
      const added = add.mock.calls.find(([t]) => t === type)?.[1];
      const removed = remove.mock.calls.find(([t]) => t === type)?.[1];
      expect(removed).toBe(added);
    }
  });

  it("is true only with a text field focused and a viewport shrunk by a keyboard's worth", () => {
    const { viewport, listeners } = stubViewport(window.innerHeight);
    const { result } = renderHook(() => useSoftKeyboardOpen());
    const { getByLabelText } = render(<label>Name<input /></label>);
    act(() => getByLabelText("Name").focus());
    expect(result.current).toBe(false);
    act(() => {
      viewport.height = window.innerHeight - SOFT_KEYBOARD_MIN_PX - 1;
      listeners.forEach((listener) => listener());
    });
    expect(result.current).toBe(true);
    act(() => getByLabelText("Name").blur());
    expect(result.current).toBe(false);
  });

  it("is always false without visualViewport", () => {
    const { result } = renderHook(() => useSoftKeyboardOpen());
    expect(result.current).toBe(false);
  });
});

describe("isTextEntry", () => {
  it("is for fields you type into, not buttons or checkboxes", () => {
    const make = (tag: string, type?: string) => {
      const el = document.createElement(tag);
      if (type) (el as HTMLInputElement).type = type;
      return el;
    };
    expect(isTextEntry(make("input", "text"))).toBe(true);
    expect(isTextEntry(make("input", "email"))).toBe(true);
    expect(isTextEntry(make("textarea"))).toBe(true);
    expect(isTextEntry(make("input", "checkbox"))).toBe(false);
    expect(isTextEntry(make("button"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe("dismissKeyboardOnEnter", () => {
  function field() {
    const { getByLabelText } = render(<label>Name<input onKeyDown={dismissKeyboardOnEnter} /></label>);
    const input = getByLabelText("Name");
    input.focus();
    return input;
  }

  it("blurs on Enter only with a coarse pointer, and never while composing", () => {
    const input = field();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveFocus(); // no matchMedia in this DOM: not a phone
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: fine)" }));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveFocus(); // a fine pointer
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" }));
    fireEvent.keyDown(input, { key: "a" });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).not.toHaveFocus();
  });
});
