"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

/**
 * A modal dialog for the seat page and editor (brand-direction-one.md
 * §6.14): a native `<dialog>` (focus kept inside, Escape closes), a bottom
 * sheet below `sm`, a 44px close button. Opening focuses `initialFocus`, or
 * the title; closing puts focus back where it was. Content mounts only
 * while open.
 */
export default function SeatDialog({
  open,
  title,
  onClose,
  children,
  initialFocus,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  /** The editor's import dialog: up to 40rem from `sm`. */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      (initialFocus?.current ?? titleRef.current)?.focus();
    }
    if (!open && dialog.open) dialog.close();
    if (!open && returnTo.current) {
      const target = returnTo.current;
      returnTo.current = null;
      if (target.isConnected) target.focus();
    }
  }, [open, initialFocus]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className={`mx-0 mt-auto mb-0 max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-card border-t border-foreground bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-foreground backdrop:bg-foreground/50 sm:m-auto sm:rounded-card sm:border sm:p-8 ${
        wide ? "sm:max-w-2xl" : "sm:max-w-lg"
      }`}
    >
      {open && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <h2 ref={titleRef} id={titleId} tabIndex={-1} className="font-heading text-xl leading-6 outline-offset-2">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-11 shrink-0 items-center justify-center rounded-control border border-foreground bg-card hover:bg-surface"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
