"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { withNext } from "@/lib/safe-next-path";
import type { SaveTarget } from "./favourites-store";

export type FavouritesNoticeState =
  | { kind: "returned"; event: SaveTarget }
  | { kind: "failed"; event: SaveTarget; intent: boolean; reason: "network" | "gone" }
  | { kind: "cap" }
  | { kind: "session" }
  | { kind: "load-error" };

/** The words for a notice: shown on the bar and announced by the provider's live region. */
export function noticeMessage(notice: FavouritesNoticeState): string {
  switch (notice.kind) {
    case "returned":
      return `Saved ${notice.event.title}.`;
    case "failed": {
      const what = notice.intent ? `save ${notice.event.title}` : `remove ${notice.event.title} from saved`;
      return notice.reason === "gone"
        ? `Couldn't ${what}. It's no longer listed.`
        : `Couldn't ${what}. Check your connection and try again.`;
    }
    case "cap":
      return "You've saved 500 events, the most you can. Remove some to save more.";
    case "session":
      return "Your session has ended. Sign in to keep saving.";
    case "load-error":
      return "Couldn't load your saved events. Check your connection and try again.";
  }
}

const actionClass =
  "inline-flex min-h-11 items-center px-2 font-semibold underline underline-offset-4 focus-visible:outline-background";

/**
 * The favourites feedback band: a black bar across the bottom, like the
 * event page's buy bar (never a toast card). It never takes focus; the
 * provider announces its text. Errors start with "Couldn't" and carry a red
 * top rule, so colour is never the only signal.
 */
export default function FavouritesNotice({
  notice,
  returnTo,
  onDismiss,
  onUndo,
  onRetry,
}: {
  notice: FavouritesNoticeState;
  /** The current path, for the Sign in link's return. */
  returnTo: string;
  onDismiss: () => void;
  onUndo: () => void;
  onRetry: () => void;
}) {
  const isError = notice.kind !== "returned";
  let actions: ReactNode = null;
  if (notice.kind === "returned") {
    actions = (
      <>
        <Link href="/saved" className={actionClass} onClick={onDismiss}>
          View saved
        </Link>
        <button type="button" className={actionClass} onClick={onUndo}>
          Undo
        </button>
      </>
    );
  } else if ((notice.kind === "failed" && notice.reason === "network") || notice.kind === "load-error") {
    actions = (
      <button type="button" className={actionClass} onClick={onRetry}>
        Try again
      </button>
    );
  } else if (notice.kind === "cap") {
    actions = (
      <Link href="/saved" className={actionClass} onClick={onDismiss}>
        Manage saved
      </Link>
    );
  } else if (notice.kind === "session") {
    actions = (
      <Link href={withNext("/login", returnTo)} className={actionClass} onClick={onDismiss}>
        Sign in
      </Link>
    );
  }

  return (
    <div
      data-favourites-notice=""
      className={`fixed inset-x-0 bottom-0 z-40 bg-foreground px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-background sm:px-8 ${
        isError ? "border-t-2 border-danger" : ""
      }`}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm leading-5">
        <p className="min-w-0 flex-1 basis-48">{noticeMessage(notice)}</p>
        <div className="-mr-2 flex shrink-0 items-center gap-2">
          {actions}
          <button type="button" className={actionClass} onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
