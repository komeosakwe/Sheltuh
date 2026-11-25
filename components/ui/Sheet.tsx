"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { useModalDialog } from "@/components/ui/useModalDialog";

interface SheetProps {
  open: boolean;
  /** Called when it closes: Escape, the ✕, the dismiss button or a press on the scrim. */
  onClose: () => void;
  title: string;
  /** The line under the title (Body/S, text/secondary). */
  subtitle?: ReactNode;
  /** The phone sheet's last button: "Cancel" for a choice of actions, "Close" for something to read (as the frames). */
  dismissLabel?: "Cancel" | "Close";
  children: ReactNode;
}

/**
 * A modal for a short list of actions or a few lines to read (Latte's 1120
 * frames: Add to calendar, Directions, Order, Manage order).
 *
 * - **Below 768: a bottom sheet.** Full width, pinned to the bottom of the
 *   screen, its height hugging the content (it scrolls inside once it would
 *   pass the screen), top corners 16, padding 24, a 40×4 handle, the title in
 *   Heading/H4, and a full-width outline dismiss button last. Scrim 50%.
 * - **From 768: a dialog.** 480 wide, centred, radius 16, padding 32, the
 *   title in Bold 20/28 with a ✕ on its right. Scrim 40%.
 *
 * A native `<dialog>` shown with `showModal()`: the browser keeps focus
 * inside it, makes the page behind inert, closes it on Escape and returns
 * focus to what opened it. A press on the scrim (one that starts and ends
 * there, so not a drag either way between it and the sheet) closes it too. The content is
 * mounted only while it's open, so each opening starts fresh. The page behind
 * doesn't scroll while it's open.
 */
export default function Sheet({ open, onClose, title, subtitle, dismissLabel = "Close", children }: SheetProps) {
  const { ref, scrimProps, close } = useModalDialog(open);
  const titleId = useId();

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      {...scrimProps}
      className="m-0 mt-auto max-h-dvh w-full max-w-none overflow-y-auto rounded-t-sheet bg-card p-0 text-foreground backdrop:bg-ink/50 md:m-auto md:w-120 md:rounded-sheet md:backdrop:bg-ink/40 motion-safe:open:transition-transform motion-safe:open:duration-200 motion-safe:open:ease-out motion-safe:starting:open:translate-y-8"
    >
      {open && (
        <div className="flex flex-col gap-4 p-6 md:p-8">
          <span aria-hidden="true" className="h-1 w-10 self-center rounded-full bg-foreground md:hidden" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id={titleId} className="text-xl leading-7 font-semibold break-words text-foreground md:font-bold">
                {title}
              </h2>
              {subtitle && <p className="body-s break-words text-muted">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mt-2 -mr-3 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-foreground hover:bg-surface max-md:hidden"
            >
              <CloseIcon />
            </button>
          </div>
          {children}
          <button type="button" onClick={close} className={buttonClass("outline", "md", "w-full md:hidden")}>
            {dismissLabel}
          </button>
        </div>
      )}
    </dialog>
  );
}

export function CloseIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className={className}>
      <path d="M4 4l12 12M16 4 4 16" />
    </svg>
  );
}

/** The rows of a sheet: no dividers, each row 16px of padding above and below (as the frames). */
export function SheetRows({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col">{children}</ul>;
}

interface SheetRowProps {
  title: string;
  /** A second line under the title (Body/S, text/secondary). */
  sub?: string;
  /** The mark on the right: "›" goes somewhere on this site or acts here, "↗" leaves it. None for a plain action (Copy address). */
  mark?: "›" | "↗";
  /** A link when set; otherwise a button calling `onClick`. */
  href?: string;
  /** Opens in a new tab, and says so to screen readers. */
  newTab?: boolean;
  /** Saves the file under this name instead of opening it. */
  download?: string;
  onClick?: () => void;
}

const rowClass =
  "flex w-full items-center justify-between gap-4 rounded-control px-3 py-4 text-left text-foreground hover:bg-surface";

/** One row of a sheet: a link (a row that navigates) or a button (a row that acts). Its hover fill reaches 12px past the text. */
export function SheetRow({ title, sub, mark, href, newTab = false, download, onClick }: SheetRowProps) {
  const body = (
    <>
      <span className="flex min-w-0 flex-col">
        <span className="label-button break-words">
          {title}
          {newTab && <> <span className="sr-only">(opens in a new tab)</span></>}
        </span>
        {/* The space is for the row's accessible name ("Apple Calendar Downloads an .ics file"); it takes no room. */}
        {sub && <> <span className="body-s break-words text-muted">{sub}</span></>}
      </span>
      {mark && (
        <span aria-hidden="true" className="label-button shrink-0">
          {mark}
        </span>
      )}
    </>
  );
  if (href === undefined) {
    return (
      <li className="-mx-3">
        <button type="button" onClick={onClick} className={rowClass}>
          {body}
        </button>
      </li>
    );
  }
  const internal = href.startsWith("/") && !newTab && download === undefined;
  return (
    <li className="-mx-3">
      {internal ? (
        <Link href={href} onClick={onClick} className={rowClass}>
          {body}
        </Link>
      ) : (
        <a
          href={href}
          onClick={onClick}
          download={download}
          {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className={rowClass}
        >
          {body}
        </a>
      )}
    </li>
  );
}
