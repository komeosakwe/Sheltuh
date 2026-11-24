"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";

export interface ModalDialog {
  ref: RefObject<HTMLDialogElement | null>;
  /** Spread onto the <dialog>: a press that starts and ends on the scrim closes it. */
  scrimProps: {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDialogElement>) => void;
    onClick: (event: MouseEvent<HTMLDialogElement>) => void;
  };
  /**
   * Spread onto the <dialog> too (the dashboard's dialog and drawers): Tab from its last control
   * goes to its first and Shift+Tab from its first to its last (a modal makes the page behind
   * inert, but browsers let Tab step out into their own toolbar), and, while it can't be
   * dismissed, Escape does nothing.
   */
  keyProps: {
    onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => void;
    onCancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
  };
  /** Closes it as Escape would (the dialog's own close event then calls the owner's onClose); nothing while it can't be dismissed. */
  close: () => void;
}

/** What Tab can reach: each kind of control, never one taken out of the order (tabindex="-1"). */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
]
  .map((selector) => `${selector}:not([tabindex="-1"])`)
  .join(", ");

/**
 * The controls Tab stops at inside `root`, in order: shown (laid out), not in an inert subtree,
 * and of a radio group only the checked radio (or the first, when none is checked), as the
 * browser does.
 */
export function tabStops(root: HTMLElement): HTMLElement[] {
  const seenGroups = new Set<string>();
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    if (element.closest("[inert]") || element.getClientRects().length === 0) return false;
    if (element instanceof HTMLInputElement && element.type === "radio" && element.name) {
      const group = element.name;
      const checked = root.querySelector<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(group)}"]:checked`);
      if (checked) return element === checked;
      if (seenGroups.has(group)) return false;
      seenGroups.add(group);
    }
    return true;
  });
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
 *
 * `dismissible: false` (an action is running): Escape, the scrim and `close` do nothing until it's
 * dismissible again; the owner can still close it by setting `open` to false.
 */
export function useModalDialog(open: boolean, { dismissible = true }: { dismissible?: boolean } = {}): ModalDialog {
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
        if (dismissible && down && up && event.target === event.currentTarget) event.currentTarget.close();
      },
    },
    keyProps: {
      onKeyDown(event) {
        if (event.key === "Escape" && !dismissible) {
          event.preventDefault();
          return;
        }
        if (event.key !== "Tab") return;
        const dialog = event.currentTarget;
        const stops = tabStops(dialog);
        if (stops.length === 0) return;
        const first = stops[0];
        const last = stops[stops.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      },
      onCancel(event) {
        if (!dismissible) event.preventDefault();
      },
    },
    close: () => {
      if (dismissible) ref.current?.close();
    },
  };
}
