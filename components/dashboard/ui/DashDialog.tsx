"use client";

import { useId, type ReactNode } from "react";
import { useModalDialog } from "@/components/ui/useModalDialog";
import { CloseIcon } from "./icons";

/**
 * The dashboard's dialog (Latte's dashboard frames: Edit ticket type 487:12396, Message attendees
 * 487:12453, Cancel event 487:12502): 480 wide (the screen less 16px a side on a phone), white,
 * radius 16, 32px inside (24 on a phone), 16px between its parts, over a 60% black scrim. The
 * header: the title (Bold 20/28, as the frames render it and the Sheet has it) with a 24px ✕ on
 * its right, a Body/S text/secondary line under it. Then the content (fields: label Body/S Strong over a 48px input) and, last, `action`
 * (the full-width 48px black button: `<DashButton variant="dark" block>`).
 *
 * A native modal `<dialog>` (components/ui/useModalDialog.ts): focus stays inside while it's open
 * (Tab goes round), the page behind is inert and still, Escape, the ✕ and a press on the scrim
 * close it, and focus goes back to what opened it. The content mounts only while it's open, so each opening starts fresh.
 */
export default function DashDialog({
  open,
  onClose,
  title,
  subtitle,
  action,
  children,
}: {
  open: boolean;
  /** Called once it has closed, however it was closed. */
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { ref, scrimProps, close, keepFocusIn } = useModalDialog(open);
  const titleId = useId();
  const subtitleId = useId();

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onClose={onClose}
      {...scrimProps}
      onKeyDown={keepFocusIn}
      data-dash-dialog=""
      className="m-auto max-h-[calc(100dvh-2rem)] w-120 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-card bg-card p-0 text-foreground backdrop:bg-ink/60 motion-safe:open:transition-transform motion-safe:open:duration-200 motion-safe:open:ease-out motion-safe:starting:open:translate-y-4"
    >
      {open && (
        <div className="flex flex-col gap-4 p-6 md:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id={titleId} className="text-xl leading-7 font-bold break-words">
                {title}
              </h2>
              {subtitle && (
                <p id={subtitleId} className="body-s break-words text-muted">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mt-2 -mr-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-foreground hover:bg-surface"
            >
              <CloseIcon />
            </button>
          </div>
          {children}
          {action}
        </div>
      )}
    </dialog>
  );
}
