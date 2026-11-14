// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTopOverlay } from "@/lib/mobile/close-overlay";

/** An open <dialog> with React-style cancel/close listeners, as ReportDialog and SeatDialog have. */
function openDialog(parent: HTMLElement = document.body) {
  const dialog = parent.appendChild(document.createElement("dialog"));
  dialog.setAttribute("open", "");
  const onCancel = vi.fn();
  const onClose = vi.fn();
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("close", onClose);
  // jsdom's close() may not fire "close": make it behave like a browser's.
  dialog.close = vi.fn(() => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  });
  return { dialog, onCancel, onClose };
}

/** A popover the browser reports as open (jsdom has no popover support: `:popover-open` is stubbed). */
function openPopover(parent: HTMLElement = document.body) {
  const popover = parent.appendChild(document.createElement("div"));
  popover.setAttribute("popover", "auto");
  let open = true;
  const hidePopover = vi.fn(() => {
    open = false;
  });
  Object.assign(popover, { hidePopover });
  const matches = popover.matches.bind(popover);
  popover.matches = (selector: string) => (selector === ":popover-open" ? open : matches(selector));
  return { popover, hidePopover };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("closeTopOverlay (Android Back inside the phone app)", () => {
  it("returns false when nothing is open, so Back goes back a page", () => {
    document.body.appendChild(document.createElement("dialog"));
    const closed = document.body.appendChild(document.createElement("div"));
    closed.setAttribute("popover", "auto");
    expect(closeTopOverlay(document)).toBe(false);
  });

  it("closes an open dialog as Escape would: cancel, then close, so its handlers update React state", () => {
    const { dialog, onCancel, onClose } = openDialog();
    expect(closeTopOverlay(document)).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(false);
  });

  it("uses requestClose() where the WebView has it", () => {
    const { dialog } = openDialog();
    const requestClose = vi.fn();
    Object.assign(dialog, { requestClose });
    expect(closeTopOverlay(document)).toBe(true);
    expect(requestClose).toHaveBeenCalledTimes(1);
    expect(dialog.close).not.toHaveBeenCalled();
  });

  it("leaves a dialog open when its cancel handler refuses (busy), but still uses up Back", () => {
    const { dialog, onClose } = openDialog();
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    expect(closeTopOverlay(document)).toBe(true);
    expect(dialog.close).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes only the last-opened (innermost) dialog", () => {
    const outer = openDialog();
    const inner = openDialog(outer.dialog);
    closeTopOverlay(document);
    expect(inner.dialog.close).toHaveBeenCalledTimes(1);
    expect(outer.dialog.close).not.toHaveBeenCalled();
  });

  it("hides an open popover (the phone menu)", () => {
    const { hidePopover } = openPopover();
    expect(closeTopOverlay(document)).toBe(true);
    expect(hidePopover).toHaveBeenCalledTimes(1);
  });

  it("closes a popover opened inside the dialog before the dialog", () => {
    const { dialog } = openDialog();
    const { hidePopover } = openPopover(dialog);
    closeTopOverlay(document);
    expect(hidePopover).toHaveBeenCalledTimes(1);
    expect(dialog.close).not.toHaveBeenCalled();
  });

  it("closes a modal dialog before a popover outside it", () => {
    const { hidePopover } = openPopover();
    const { dialog } = openDialog();
    closeTopOverlay(document);
    expect(dialog.close).toHaveBeenCalledTimes(1);
    expect(hidePopover).not.toHaveBeenCalled();
  });
});
