import type { Page } from "@playwright/test";

/**
 * Safari, and every browser on an iPhone (all WebKit), never focuses a button or link it's
 * pressed on: focus goes to the nearest focusable element around it instead, which for a
 * panel or menu in the page is <main tabIndex={-1}> (app/layout.tsx). The suite runs Chromium only, which does
 * focus a pressed button, so this does what WebKit does on each press. It stands in for
 * WebKit's focus rule only: it isn't Safari or a real device.
 */
export async function pressFocusLikeWebKit(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener(
      "mousedown",
      (event) => {
        const pressed = event.target instanceof Element ? event.target.closest("button, a[href]") : null;
        if (!pressed) return;
        event.preventDefault();
        const around = pressed.parentElement?.closest<HTMLElement>("[tabindex]");
        if (around) around.focus();
        else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      },
      true,
    );
  });
}

/**
 * Safari on an iPhone doesn't scroll the page to a button that script focuses (WebKit leaves the scroll to a focused
 * form control to UIKit, whose keyboard a button never brings up): focus moves, the page stays where it is. Chromium
 * scrolls to it, so this does what the iPhone does: every focus() on a button keeps the page where it is. It stands
 * in for that rule only: it isn't Safari or a real device.
 */
export async function focusWithoutScrollLikeIOS(page: Page) {
  await page.addInitScript(() => {
    const focus = HTMLButtonElement.prototype.focus;
    HTMLButtonElement.prototype.focus = function (this: HTMLButtonElement, options?: FocusOptions) {
      focus.call(this, { ...options, preventScroll: true });
    };
  });
}
