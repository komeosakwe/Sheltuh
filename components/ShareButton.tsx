"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { buttonClass, secondaryActionClass } from "@/components/ui/Button";
import { PHONE_QUERY } from "@/components/ui/useIsPhone";
import { publicEventUrl } from "@/lib/event-url";

const COPIED_FOR_MS = 4000;
/** The popover's gap below the button on phones, matching `sm:mt-2`. */
const POPOVER_GAP_PX = 8;

function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Share an event (docs/design/brand-direction-one.md §6.7): the device's own
 * share sheet where there is one; otherwise the link is copied, with a polite
 * "Link copied"; and if the clipboard refuses, a small popover with the link
 * selected, to copy by hand. The link is the event page alone, never the
 * address bar's query (so a tracking `?ref=` isn't passed on).
 */
export default function ShareButton({
  slug,
  title,
  text,
  className = "",
}: {
  slug: string;
  title: string;
  /** The share sheet's message, e.g. "{title} · {Sat 24 Oct, 7:00 pm} · {venue}". */
  text?: string;
  className?: string;
}) {
  const [status, setStatus] = useState("");
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [manualHint, setManualHint] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popoverId = useId();
  const fieldId = useId();

  useEffect(() => () => clearTimeout(clearTimer.current), []);

  const open = manualUrl !== null;

  // Below sm the popover spans the viewport inside its gutters (`fixed
  // inset-x-5`), just under the button, following it as the page scrolls; a
  // 288px box hung off the button would run off a 320px screen. From sm it
  // hangs from the button's right edge (classes alone).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const popover = popoverRef.current;
      const button = buttonRef.current;
      if (!popover || !button) return;
      popover.style.top = window.matchMedia(PHONE_QUERY).matches
        ? `${button.getBoundingClientRect().bottom + POPOVER_GAP_PX}px`
        : "";
    };
    place();
    // Fixed, so focusing its field won't scroll it into view: if it opens past
    // the bottom of the screen, bring it up (it follows the button).
    const bottom = popoverRef.current?.getBoundingClientRect().bottom ?? 0;
    if (window.matchMedia(PHONE_QUERY).matches && bottom > window.innerHeight) {
      window.scrollBy(0, bottom - window.innerHeight + POPOVER_GAP_PX);
      place();
    }
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // The popover's link is selected as it opens, ready to copy; a tap or click
  // anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    fieldRef.current?.focus();
    fieldRef.current?.select();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setManualUrl(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function announce(message: string) {
    clearTimeout(clearTimer.current);
    setStatus(message);
    clearTimer.current = setTimeout(() => setStatus(""), COPIED_FOR_MS);
  }

  function closePopover() {
    setManualUrl(null);
    buttonRef.current?.focus();
  }

  async function copy(url: string): Promise<boolean> {
    try {
      if (!navigator.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }

  async function share() {
    const url = publicEventUrl(slug, window.location.origin);
    setManualUrl(null);
    setManualHint("");
    if (typeof navigator.share === "function" && navigator.canShare?.({ url }) !== false) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        // Cancelled by the person: nothing to say. Anything else falls back to copying.
        if (isAbort(err)) return;
      }
    }
    if (await copy(url)) {
      announce("Link copied");
      return;
    }
    setManualUrl(url);
  }

  async function copyFromPopover() {
    if (manualUrl === null) return;
    fieldRef.current?.select();
    if (await copy(manualUrl)) {
      setManualUrl(null);
      buttonRef.current?.focus();
      announce("Link copied");
    } else {
      // The browser won't let us copy: the link is selected, so the keyboard shortcut works.
      setManualHint("Couldn’t copy it automatically. The link is selected: copy it from the field.");
      fieldRef.current?.focus();
    }
  }

  return (
    <div
      ref={rootRef}
      className={`relative flex items-center gap-2 ${className}`.trim()}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          closePopover();
        }
      }}
      onBlur={(event) => {
        // Tabbing out of the popover closes it (focus stays where it went). Not when focus goes to an
        // element around it: a press on the popover moves focus to <main tabIndex={-1}>
        // (app/layout.tsx) in Safari and every iOS browser, which don't focus a pressed button, so
        // closing here removed Copy before its click landed. A press outside closes it (pointerdown above).
        const next = event.relatedTarget;
        if (open && next instanceof Node && !event.currentTarget.contains(next) && !next.contains(event.currentTarget)) {
          setManualUrl(null);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={share}
        aria-label={`Share ${title}`}
        aria-expanded={open ? true : undefined}
        aria-controls={open ? popoverId : undefined}
        className={secondaryActionClass}
      >
        <ShareIcon />
        {/* The name "Share {title}" starts with what's shown. */}
        <span>Share</span>
      </button>
      {/* Beside the button, and always in the page so the change is announced. */}
      <p role="status" className="text-sm whitespace-nowrap">
        {status}
      </p>
      {manualUrl !== null && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="group"
          aria-label="Copy the link"
          className="fixed inset-x-5 z-30 flex flex-col gap-2 rounded-control border border-foreground bg-card p-3 text-foreground sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-72"
        >
          <label htmlFor={fieldId} className="eyebrow text-muted">
            Link to this event
          </label>
          <input
            ref={fieldRef}
            id={fieldId}
            type="url"
            readOnly
            value={manualUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-11 w-full rounded-control border border-foreground bg-card px-3 text-base sm:text-sm"
          />
          <p role="status" className="text-xs text-muted">
            {manualHint}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closePopover} className={buttonClass("outline", "sm", "min-h-11")}>
              Close
            </button>
            <button type="button" onClick={copyFromPopover} className={buttonClass("outline", "sm", "min-h-11")}>
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
