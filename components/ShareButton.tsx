"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/Button";
import { publicEventUrl } from "@/lib/event-url";

const COPIED_FOR_MS = 4000;

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
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popoverId = useId();
  const fieldId = useId();

  useEffect(() => () => clearTimeout(clearTimer.current), []);

  // The popover's link is selected as it opens, ready to copy; a tap or click
  // anywhere else closes it.
  const open = manualUrl !== null;
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
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={share}
        aria-label={`Share ${title}`}
        aria-expanded={open ? true : undefined}
        aria-controls={open ? popoverId : undefined}
        className={buttonClass("outline", "sm", "min-h-11 min-w-11 px-3")}
      >
        <ShareIcon />
        {/* Icon-only below 375px; the name "Share {title}" starts with what's shown. */}
        <span className="hidden min-[375px]:inline">Share</span>
      </button>
      {/* Beside the button, and always in the page so the change is announced. */}
      <p role="status" className="text-sm whitespace-nowrap">
        {status}
      </p>
      {manualUrl !== null && (
        <div
          id={popoverId}
          role="group"
          aria-label="Copy the link"
          className="absolute top-full right-0 z-30 mt-2 flex w-72 max-w-[calc(100vw-2.5rem)] flex-col gap-2 rounded-control border border-foreground bg-card p-3 text-foreground"
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
