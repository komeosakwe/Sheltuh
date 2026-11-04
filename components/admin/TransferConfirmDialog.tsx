"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";

/**
 * A yes/no question before an action that can't be taken back from here
 * (cancel or release a transfer): a native modal `<dialog>` (focus kept
 * inside, Escape closes, focus returns to the button that opened it), a
 * bottom sheet on phones. Mount it only while asking; `onClose` runs on
 * every way out except `onConfirm`, which the parent follows by unmounting.
 */
export default function TransferConfirmDialog({
  titleId,
  title,
  children,
  confirmLabel,
  keepLabel,
  danger,
  onConfirm,
  onClose,
}: {
  titleId: string;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  keepLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const aboutId = `${titleId}-about`;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function confirm() {
    // Closing it first hands focus back to the button that opened it.
    ref.current?.close();
    onConfirm();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={aboutId}
      onClose={onClose}
      className="mx-0 mt-auto mb-0 w-full max-w-none border-t border-foreground bg-background p-5 text-foreground backdrop:bg-ink/50 sm:m-auto sm:max-w-lg sm:border sm:p-8"
    >
      <div className="flex flex-col gap-5">
        <h2 id={titleId} className="display-md !text-2xl">
          {title}
        </h2>
        <div id={aboutId} className="flex flex-col gap-2 text-sm">
          {children}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant={danger ? "danger" : "solid"} size="lg" className="w-full sm:w-auto" onClick={confirm}>
            {confirmLabel}
          </Button>
          <Button variant="outline" size="lg" className="w-full sm:w-auto" autoFocus onClick={onClose}>
            {keepLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
