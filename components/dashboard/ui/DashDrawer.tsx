"use client";

import { useId, type ReactNode } from "react";
import { useModalDialog } from "@/components/ui/useModalDialog";
import { CloseIcon } from "./icons";

interface DrawerBase {
  open: boolean;
  /** Called once it has closed, however it was closed. */
  onClose: () => void;
  children: ReactNode;
}

/** A panel with its own heading (the Tickets drawer). */
interface TitledDrawer extends DrawerBase {
  side?: "right";
  title: string;
  subtitle?: ReactNode;
  /** The row of buttons at its foot, right-aligned (Cancel · Done). */
  footer?: ReactNode;
}

/** A bare panel whose content draws itself (the organiser nav drawer): name it with `label`. */
interface BareDrawer extends DrawerBase {
  side: "left";
  label: string;
  /** Data attribute for the panel (tests and styling hooks). */
  name?: string;
}

/**
 * The dashboard's drawers, as native modal `<dialog>`s (components/ui/useModalDialog.ts): focus
 * stays inside while open, the page behind is inert and still, Escape and a press on the scrim
 * close it, and focus goes back to what opened it. Full height, sliding in from its side for
 * people who don't prefer reduced motion. The content mounts only while it's open.
 *
 * - `side="right"` (the Tickets drawer, 499:21419): 520 wide (the whole screen on a phone), white,
 *   32px inside (24 on a phone), 16px between parts, over a 40% scrim: the title (Heading/H2) with
 *   a ✕, a Body/S text/secondary line, the content, then `footer`.
 * - `side="left"` (Nav expanded, 495:22558 / 495:22467): 264 wide, black (an ink surface) over a
 *   50% scrim, nothing of its own: the caller draws the sidebar and its own collapse button.
 */
export default function DashDrawer(props: TitledDrawer | BareDrawer) {
  const { open, onClose, children } = props;
  const { ref, scrimProps, close } = useModalDialog(open);
  const titleId = useId();
  const subtitleId = useId();

  if (props.side === "left") {
    return (
      <dialog
        ref={ref}
        aria-label={props.label}
        onClose={onClose}
        {...scrimProps}
        data-surface="ink"
        data-dash-drawer="left"
        {...(props.name ? { [`data-${props.name}`]: "" } : {})}
        className="m-0 h-dvh max-h-none w-66 max-w-full overflow-y-auto p-0 backdrop:bg-ink/50 motion-safe:open:transition-transform motion-safe:open:duration-200 motion-safe:open:ease-out motion-safe:starting:open:-translate-x-8"
      >
        {open && children}
      </dialog>
    );
  }

  const { title, subtitle, footer } = props;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onClose={onClose}
      {...scrimProps}
      data-dash-drawer="right"
      className="m-0 ml-auto h-dvh max-h-none w-130 max-w-full overflow-y-auto bg-card p-0 text-foreground backdrop:bg-ink/40 motion-safe:open:transition-transform motion-safe:open:duration-200 motion-safe:open:ease-out motion-safe:starting:open:translate-x-8"
    >
      {open && (
        <div className="flex min-h-full flex-col gap-4 p-6 md:p-8">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="heading-h2 min-w-0 break-words">
              {title}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-foreground hover:bg-surface"
            >
              <CloseIcon />
            </button>
          </div>
          {subtitle && (
            <p id={subtitleId} className="body-s -mt-2 break-words text-muted">
              {subtitle}
            </p>
          )}
          <div className="flex flex-1 flex-col gap-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
