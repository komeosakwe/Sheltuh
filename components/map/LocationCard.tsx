"use client";

import { useState } from "react";
import { ArrowUpRightIcon, CloseIcon, NavigationIcon } from "@/components/map/MapControlIcons";
import { shareablePageAddress, type LocationPrompt } from "@/lib/in-app-browser";
import { LOCATION_PROMPT_TITLE } from "./useMapLocate";

/** After "Open in Safari" in an in-app browser on iOS: the way out is the app's own menu. */
export const OPEN_EXTERNALLY_STEPS = "Tap ••• at the top, then Open in external browser.";
export const LINK_COPIED_STEPS = `Link copied. ${OPEN_EXTERNALLY_STEPS}`;

/** Copies the page's https address (no fragment); false when there's none or the clipboard refuses. */
async function copyPageAddress(): Promise<boolean> {
  const address = shareablePageAddress(window.location.href);
  if (!address || typeof navigator.clipboard?.writeText !== "function") return false;
  try {
    await navigator.clipboard.writeText(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * The words of the location card, inside the map's always-mounted status (components/map/NearMeButton.tsx),
 * so each change is announced: "Share your location?" and where to allow it, or another failure's own
 * sentence (`text`). After "Open in Safari" (`steps`) the sentence becomes the way out.
 */
export function LocationCardText({
  text,
  prompt,
  steps,
}: {
  text: string;
  prompt?: LocationPrompt;
  steps: "copied" | "steps" | null;
}) {
  const body = steps === "copied" ? LINK_COPIED_STEPS : steps === "steps" ? OPEN_EXTERNALLY_STEPS : text;
  return (
    <>
      {prompt && <span className="block text-2xs font-bold text-foreground">{LOCATION_PROMPT_TITLE}</span>}
      <span className="mt-px block text-3xs text-foreground/75">{body}</span>
    </>
  );
}

/** The location card's look, around its status (the words) and its buttons. */
export const LOCATION_CARD_CLASS =
  "pointer-events-auto relative w-50 max-w-full rounded-control border-control border-foreground bg-background py-2.5 pr-7 pl-11.5";

/** The card's orange arrow on its pale circle. */
export function LocationCardIcon() {
  return (
    <span aria-hidden="true" className="absolute top-2.75 left-3 flex size-6 items-center justify-center rounded-full bg-surface">
      <NavigationIcon className="size-3.5 text-signal" />
    </span>
  );
}

/** The card's ✕. */
export function LocationCardClose({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss location message"
      className="absolute top-0 right-0 flex size-8 items-center justify-center rounded-control text-foreground"
    >
      <CloseIcon className="size-3.5" />
    </button>
  );
}

const ACTION_CLASS =
  "mt-2 inline-flex h-6.5 items-center gap-1.5 rounded-full bg-foreground pr-3 pl-4 text-2xs font-semibold text-background";

/**
 * The card's way out of an in-app browser. Android: "Open in Chrome", a link to the page in Chrome.
 * iOS: "Open in Safari" can't open Safari there (Instagram ignores `x-safari-https:`), so it copies
 * the page's address and the card says where the app's own "Open in external browser" is.
 */
export function LocationCardAction({
  prompt,
  onSteps,
}: {
  prompt?: LocationPrompt;
  onSteps: (steps: "copied" | "steps") => void;
}) {
  const [copying, setCopying] = useState(false);
  if (prompt?.kind === "open-link") {
    return (
      <a href={prompt.href} className={ACTION_CLASS}>
        {prompt.label}
        <ArrowUpRightIcon className="size-3" />
      </a>
    );
  }
  if (prompt?.kind !== "copy-link") return null;
  return (
    <button
      type="button"
      className={ACTION_CLASS}
      aria-busy={copying}
      onClick={async () => {
        if (copying) return;
        setCopying(true);
        const copied = await copyPageAddress();
        setCopying(false);
        onSteps(copied ? "copied" : "steps");
      }}
    >
      Open in {prompt.browser}
      <ArrowUpRightIcon className="size-3" />
    </button>
  );
}
