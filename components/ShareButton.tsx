"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { buttonClass, photoMarkClass, photoMarkLabelClass, photoMarkTargetClass, secondaryActionClass } from "@/components/ui/Button";
import { PHONE_QUERY } from "@/components/ui/useIsPhone";
import { publicEventUrl } from "@/lib/event-url";
import { absoluteUrl } from "@/lib/share-metadata";

const COPIED_FOR_MS = 4000;
/** The popover's gap below the button on phones, matching `sm:mt-2`. */
const POPOVER_GAP_PX = 8;

/** 16px beside a word; on the event page's photo mark, 20px alone below 640px and 16px with its word from 640px. */
const ICON_CLASS = "size-4 shrink-0";
const PHOTO_ICON_CLASS = "size-5 shrink-0 sm:size-4";

function ShareIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

function CopiedIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M3 8.5l3.5 3.5L13 4.5" />
    </svg>
  );
}

/** What's shared: an event (`slug`), or any other page of the site by its `path` ("/organisers/{id}"). */
type ShareTarget = { slug: string; path?: never } | { path: string; slug?: never };

/** The address shared: the origin and the page's path alone, never a query string or fragment. */
function shareUrl(target: ShareTarget, origin: string): string {
  if (target.slug !== undefined) return publicEventUrl(target.slug, origin);
  return absoluteUrl((target.path ?? "/").split(/[?#]/, 1)[0], origin);
}

/**
 * "Share", and "Copied" for a few seconds after a copy: both in one grid cell, the one not showing invisible, so the
 * button is always as wide as the wider ("Copied") and the row it shares never shifts.
 */
function swapLabel(copied: boolean) {
  return (
    <span className="grid justify-items-center">
      <span data-share-label="share" className={`col-start-1 row-start-1 ${copied ? "invisible" : ""}`.trim()}>
        Share
      </span>
      <span data-share-label="copied" className={`col-start-1 row-start-1 ${copied ? "" : "invisible"}`.trim()}>
        Copied
      </span>
    </span>
  );
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Share an event (docs/design/brand-direction-one.md §6.7), or with `path`
 * another page (an organiser's profile): the device's own share sheet where
 * there is one; otherwise the link is copied, with a polite "Link copied";
 * and if the clipboard refuses, a small popover with the link selected, to
 * copy by hand. The link is the page alone, never the address bar's query
 * (so a tracking `?ref=` isn't passed on).
 */
/**
 * How the button looks: the event page's photo mark (`look="photo"`), or the Secondary button, optionally with its
 * own words (`label`) and look (`buttonClassName`) or "Copied" in its label (`copiedInLabel`). One or the other: the
 * photo mark has its own words, look and copied state, so it takes none of those.
 */
type ShareLook =
  | {
      /**
       * The event page's mark on its photo, beside Save (owner, 27 Nov 2026: Option A; components/ui/Button.tsx
       * photoMarkClass). The icon alone below 640px, with "Share" from 640px; after a copy, the check for a few
       * seconds, and "Copied" in place of "Share" from 640px, as `copiedInLabel` does (which it implies). "Link
       * copied" is said, never shown, so nothing is drawn over the photo.
       */
      look: "photo";
      copiedInLabel?: never;
      label?: never;
      buttonClassName?: never;
    }
  | {
      look?: undefined;
      /**
       * After a copy, the button itself reads "Copied" (with a check) for a few seconds, and is named "Copied. Share
       * {title}" meanwhile; "Link copied" is said but not shown. The button is always as wide as "Copied", so a row
       * it shares (the organiser profile's Follow and Share) never changes.
       */
      copiedInLabel?: boolean;
      /**
       * Other words on the button, with no icon and an arrow after them (the organiser Overview's
       * "Share event →" chip): it's then named "{label}: {title}", so the name starts with what's shown.
       */
      label?: string;
      /** The button's look in place of the Secondary button's (with `label`). */
      buttonClassName?: string;
    };

export type ShareButtonProps = ShareTarget &
  ShareLook & {
    title: string;
    /** The copy-by-hand popover's field label. */
    copyLabel?: string;
    /** The share sheet's message, e.g. "{title} · {Sat 24 Oct, 7:00 pm} · {venue}". */
    text?: string;
    className?: string;
  };

export default function ShareButton({
  slug,
  path,
  title,
  text,
  className = "",
  look,
  copyLabel = "Link to this event",
  copiedInLabel = false,
  label,
  buttonClassName,
}: ShareButtonProps) {
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
  const photo = look === "photo";
  const labelSwaps = copiedInLabel || photo;
  const copied = labelSwaps && status !== "";
  const iconClass = photo ? PHOTO_ICON_CLASS : ICON_CLASS;

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
    const url = shareUrl(slug !== undefined ? { slug } : { path: path ?? "/" }, window.location.origin);
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
      className={`relative flex ${photo ? "" : "items-center gap-2"} ${className}`.replace(/\s+/g, " ").trim()}
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
        // While "Copied" shows, the name starts with it too (WCAG 2.5.3, label in name), then says what it does.
        aria-label={copied ? `Copied. Share ${title}` : label ? `${label}: ${title}` : `Share ${title}`}
        aria-expanded={open ? true : undefined}
        aria-controls={open ? popoverId : undefined}
        data-share-look={photo ? "photo" : undefined}
        className={photo ? `group/share ${photoMarkTargetClass}` : (buttonClassName ?? secondaryActionClass)}
      >
        {photo ? (
          <span className={photoMarkClass("share")} data-surface="paper">
            {copied ? <CopiedIcon className={iconClass} /> : <ShareIcon className={iconClass} />}
            <span className={photoMarkLabelClass}>{swapLabel(copied)}</span>
          </span>
        ) : label ? (
          <>
            {label}
            <span aria-hidden="true">→</span>
          </>
        ) : (
          <>
            {copied ? <CopiedIcon className={iconClass} /> : <ShareIcon className={iconClass} />}
            {copiedInLabel ? swapLabel(copied) : <span>Share</span>}
          </>
        )}
      </button>
      {/* Beside the button, and always in the page so the change is announced (said only, when the button shows it). */}
      <p role="status" className={labelSwaps ? "sr-only" : "text-sm whitespace-nowrap"}>
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
            {copyLabel}
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
