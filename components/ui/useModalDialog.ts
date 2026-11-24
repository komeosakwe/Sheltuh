"use client";

import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";

export interface ModalDialog {
  ref: RefObject<HTMLDialogElement | null>;
  /** Spread onto the <dialog>: a press that starts and ends on the scrim closes it. */
  scrimProps: {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDialogElement>) => void;
    onClick: (event: MouseEvent<HTMLDialogElement>) => void;
  };
  /** Closes it as Escape would (the dialog's own close event then calls the owner's onClose). */
  close: () => void;
  /**
   * The dialog's onKeyDown: Tab from its last control goes to its first, and Shift+Tab from its
   * first to its last. A modal dialog already makes the page behind inert, but browsers let Tab
   * step out of it into their own toolbar; this keeps focus going round inside it.
   */
  keepFocusIn: (event: KeyboardEvent<HTMLDialogElement>) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function keepFocusIn(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * A native `<dialog>` kept in step with `open` (shown with `showModal()`, so the browser keeps focus
 * inside it, makes the page behind inert, closes it on Escape and gives focus back to what opened
 * it), the page behind held still while it's open, and a press on the scrim closing it. Shared by
 * the Sheet (components/ui/Sheet.tsx) and the dashboard's dialog and drawers
 * (components/dashboard/ui/DashDialog.tsx, DashDrawer.tsx).
 *
 * The scrim press closes it only when it starts and ends there: a drag between the scrim and the
 * panel (a text selection, either way) ends with a click on the dialog, their common ancestor, and
 * mustn't close it. The dialog element itself is only hit outside its padding box, which is the scrim.
 */
export function useModalDialog(open: boolean): ModalDialog {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [open]);

  const press = useRef({ down: false, up: false });

  return {
    ref,
    scrimProps: {
      onPointerDown(event) {
        press.current = { down: event.target === event.currentTarget, up: false };
      },
      onPointerUp(event) {
        press.current = { ...press.current, up: event.target === event.currentTarget };
      },
      onClick(event) {
        const { down, up } = press.current;
        press.current = { down: false, up: false };
        if (down && up && event.target === event.currentTarget) event.currentTarget.close();
      },
    },
    close: () => ref.current?.close(),
    keepFocusIn,
  };
}
