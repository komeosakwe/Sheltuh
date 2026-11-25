"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a toast stays up (unless the pointer is on it). */
export const TOAST_MS = 6000;

export interface ToastMessage {
  /** Changes with every toast, so the same words twice still restart the timer. */
  id: number;
  text: string;
}

export interface ToastControls {
  toast: ToastMessage | null;
  show: (text: string) => void;
  dismiss: () => void;
  /** The pointer is on it: it stays until the pointer leaves, then gets its full time again. */
  hold: (held: boolean) => void;
}

/**
 * One toast at a time for a page: `show` replaces whatever is up. It goes
 * after TOAST_MS, and stays while the pointer is on it. The words are also on
 * the page in some other form (a toast is a confirmation, never the only
 * place something is said), so it going away loses nothing.
 */
export function useToast(): ToastControls {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [held, setHeld] = useState(false);
  const next = useRef(0);

  useEffect(() => {
    if (!toast || held) return;
    const timer = setTimeout(() => setToast((now) => (now?.id === toast.id ? null : now)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, held]);

  const show = useCallback((text: string) => {
    next.current += 1;
    setToast({ id: next.current, text });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  return { toast, show, dismiss, hold: setHeld };
}

/**
 * Latte's UI / Toast (1120 "Ticket sent (toast)"): 358 wide at most, white,
 * radius 8, padding 16 × 12, an orange ✓ and the words in Body/S Strong,
 * near the top of the screen. The words wrap rather than overrun: the
 * frame's own sentence is 3px wider than its 358 box allows at 16px padding
 * (it's drawn on one line with no wrapping), so on a 390 screen it may take
 * two lines. A 1px border/subtle ring (outside its box, so it takes no room)
 * so it holds on a white page too (the frame draws it over the black
 * full-screen ticket).
 *
 * The polite status region is always there, so the words are read out when
 * they arrive. A page shows one of these; a modal it opens (the full-screen
 * ticket) shows another inside itself, since the page behind a modal is
 * inert and hidden from screen readers. It slides down 8px and fades in over
 * 150ms; with reduced motion it only fades.
 */
export type ToastPlacement = "page" | "screen";

/**
 * `placement`: `page`, 16px from the top; `screen`, over the full-screen ticket, below its top bar (✕, the
 * ticket count and Send stay in reach).
 */
export default function Toast({ controls, placement = "page" }: { controls: Pick<ToastControls, "toast" | "hold">; placement?: ToastPlacement }) {
  const { toast, hold } = controls;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-toast=""
      className={`pointer-events-none fixed inset-x-4 z-50 flex justify-center ${placement === "screen" ? "top-16" : "top-4"}`}
    >
      {toast && (
        <div
          key={toast.id}
          onPointerEnter={() => hold(true)}
          onPointerLeave={() => hold(false)}
          data-surface="paper"
          className="pointer-events-auto flex w-full max-w-89.5 items-center gap-2 rounded-control bg-paper px-4 py-3 ring-1 ring-surface-border text-ink transition-[opacity,translate] duration-150 ease-out starting:opacity-0 motion-safe:starting:-translate-y-2"
        >
          <span aria-hidden="true" className="label-button shrink-0 text-signal">
            ✓
          </span>
          <p className="body-s min-w-0 font-semibold break-words">{toast.text}</p>
        </div>
      )}
    </div>
  );
}
