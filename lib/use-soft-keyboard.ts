"use client";

import { useEffect, useState, type KeyboardEvent } from "react";

/** The visual viewport must be at least this much shorter than the layout viewport to count as a keyboard. */
export const SOFT_KEYBOARD_MIN_PX = 120;

/** Whether `target` is something you type into (so the on-screen keyboard comes up for it). */
export function isTextEntry(target: EventTarget | Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target.isContentEditable) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"].includes(target.type);
}

/**
 * True while an on-screen keyboard is probably up over a text field: a text
 * field has focus AND the visual viewport (what's left above the keyboard) is
 * clearly shorter than the layout viewport. iOS Safari and Chrome on Android
 * both shrink only the visual viewport, so a bar stuck to the bottom of the
 * layout viewport can end up over the field being typed in; the caller hides
 * it while this is true. A hardware keyboard shrinks nothing, so tabbing
 * through the page still reaches the bar, and a pinch-zoomed page (scale above
 * 1) is never mistaken for a keyboard. Without `visualViewport` it's always false.
 */
export function useSoftKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let textFocused = isTextEntry(document.activeElement);
    const update = () => {
      const shrunk = window.innerHeight - viewport.height > SOFT_KEYBOARD_MIN_PX && viewport.scale <= 1.01;
      setOpen(textFocused && shrunk);
    };
    const onFocusIn = (event: FocusEvent) => {
      textFocused = isTextEntry(event.target);
      update();
    };
    // While focus moves between fields `relatedTarget` is the next one: the keyboard stays up.
    const onFocusOut = (event: FocusEvent) => {
      textFocused = isTextEntry(event.relatedTarget);
      update();
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    viewport.addEventListener("resize", update);
    update();
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      viewport.removeEventListener("resize", update);
    };
  }, []);

  return open;
}

/**
 * `onKeyDown` for a one-line field that isn't in a form: Enter closes the on-screen keyboard (the keyboard's
 * own key reads "Done"), which brings the page's sticky buy bar back. Only on a touch device (a coarse
 * pointer: on a desktop Enter leaves focus where it is), and never while an IME is composing (Enter then
 * confirms the candidate, e.g. Japanese or Chinese input, and must not blur the field).
 */
export function dismissKeyboardOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
  if (typeof window.matchMedia !== "function" || !window.matchMedia("(pointer: coarse)").matches) return;
  event.currentTarget.blur();
}
