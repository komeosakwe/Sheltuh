/**
 * Android's back button in the phone app closes what's open over the page
 * before it goes back a page (lib/mobile/native-shell.ts), as Escape does in
 * a browser:
 *
 * - an open `<dialog>` (ReportDialog, SendHolderMessageDialog, SeatDialog and
 *   the other modals): `requestClose()` where the WebView has it, which fires
 *   `cancel` and then `close` exactly as Escape does; otherwise a cancelable
 *   `cancel` event and, unless a handler prevents it (a dialog that's busy
 *   saving), `close()`. Either way the dialog's own `onCancel`/`onClose`
 *   handlers run, so React state follows;
 * - an open popover (the phone menu in components/Nav.tsx, the search sheet,
 *   the location menu): `hidePopover()`, which fires the `toggle` event those
 *   components already listen to.
 *
 * Other overlays (share and calendar menus, the fee note) close on Escape
 * through their own key handlers; Back doesn't reach those and goes back a
 * page instead (docs/mobile-app.md).
 *
 * Returns true when something was open (Back is then used up, even if a
 * dialog refused to close), false when the page had nothing open.
 */

type ClosableDialog = HTMLDialogElement & { requestClose?: () => void };

function openPopovers(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>("[popover]")].filter((element) => {
    try {
      return element.matches(":popover-open");
    } catch {
      // A WebView without popover support has none open.
      return false;
    }
  });
}

function closeDialog(dialog: ClosableDialog): void {
  if (typeof dialog.requestClose === "function") {
    dialog.requestClose();
    return;
  }
  const cancel = new Event("cancel", { cancelable: true });
  if (dialog.dispatchEvent(cancel)) dialog.close();
}

export function closeTopOverlay(doc: Document = document): boolean {
  // The last open one in the document: the one opened inside another comes after it.
  const dialog = [...doc.querySelectorAll<ClosableDialog>("dialog[open]")].at(-1);
  const popover = openPopovers(doc).at(-1);
  // A popover opened from inside the dialog sits above it: that goes first.
  if (popover && (!dialog || dialog.contains(popover))) {
    popover.hidePopover();
    return true;
  }
  if (dialog) {
    closeDialog(dialog);
    return true;
  }
  return false;
}
