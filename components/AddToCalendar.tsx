"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buildIcs, googleCalendarUrl, icsFilename, type CalendarEvent } from "@/lib/calendar";
import { publicEventUrl } from "@/lib/event-url";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-4 shrink-0 motion-safe:transition-transform ${open ? "rotate-180" : ""}`.trim()}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

const itemClass =
  "flex min-h-11 w-full items-center px-4 text-sm text-foreground underline-offset-4 hover:bg-surface hover:underline";

/**
 * "Add to calendar" (docs/design/brand-direction-one.md §6.7): a disclosure
 * with two plain links, an `.ics` download (Apple Calendar, Outlook and most
 * others) and Google Calendar. Both are built only when it's opened, in the
 * browser: the file is stamped with the current time and the page's own
 * origin, neither of which the server render could know.
 *
 * The file is a Blob object URL rather than a `data:` URI, which in-app
 * browsers (Instagram's, Facebook's) are likelier to download; it's revoked
 * when the menu closes. If the event's date can't be read, there's nothing to
 * add, and a short message says so instead.
 */
export default function AddToCalendar({ event, className = "" }: { event: CalendarEvent; className?: string }) {
  const [links, setLinks] = useState<{ ics: string; google: string } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const open = links !== null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setLinks(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Each opening makes a fresh file; it's released once the menu closes (or the page goes).
  useEffect(() => {
    if (!links) return;
    return () => URL.revokeObjectURL(links.ics);
  }, [links]);

  function toggle() {
    if (open) {
      setLinks(null);
      return;
    }
    const url = publicEventUrl(event.slug, window.location.origin);
    const ics = buildIcs(event, { url });
    const google = googleCalendarUrl(event, url);
    if (ics === null || google === null) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    setLinks({ ics: URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" })), google });
  }

  function close() {
    setLinks(null);
    buttonRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={`relative w-fit ${className}`.trim()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
      onBlur={(e) => {
        // Tabbing out of the menu closes it (focus stays where it went).
        if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setLinks(null);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="-ml-0.5 inline-flex min-h-11 items-center gap-1 px-0.5 text-sm font-semibold underline underline-offset-4"
      >
        Add to calendar
        <ChevronIcon open={open} />
      </button>
      {/* Always in the page, so the message is announced when it appears. */}
      <p role="status" className="text-sm text-muted empty:hidden">
        {unavailable ? "This event’s date can’t be added to a calendar." : ""}
      </p>
      {links && (
        <ul
          id={menuId}
          className="absolute top-full left-0 z-30 mt-1 w-64 max-w-[calc(100vw-2.5rem)] rounded-control border border-foreground bg-card py-1"
        >
          <li>
            <a href={links.ics} download={icsFilename(event)} className={itemClass}>
              Apple / Outlook (.ics)
            </a>
          </li>
          <li>
            <a
              href={links.google}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Google Calendar (opens in a new tab)"
              className={itemClass}
            >
              Google Calendar
            </a>
          </li>
        </ul>
      )}
    </div>
  );
}
