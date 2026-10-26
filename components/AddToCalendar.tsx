"use client";

import { useEffect, useId, useRef, useState } from "react";
import { googleCalendarUrl, icsFilename, outlookCalendarUrl, type CalendarEvent } from "@/lib/calendar";
import { eventCalendarPath, publicEventUrl } from "@/lib/event-url";

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

type Links = { google: string; outlook: string };

/**
 * "Add to calendar" (docs/design/brand-direction-one.md §6.7): a disclosure
 * with plain links.
 *
 * - **Apple Calendar** goes to the event's `.ics` URL on this site
 *   (`/events/{slug}/calendar.ics`, served inline as text/calendar), so
 *   iPhone Safari opens its own "Add to Calendar" sheet and a desktop browser
 *   hands the file to the calendar app. No `download` attribute or Blob: a
 *   phone treats those as a file to save. Not `webcal://`, which subscribes
 *   to a calendar feed rather than adding one event.
 * - **Google Calendar** and **Outlook** open their own "new event" pages,
 *   prefilled, in a new tab.
 * - **Download .ics** is the same file, saved, for any other calendar app.
 *
 * Android lists Google first, everything else Apple. That's read from the
 * browser when the menu opens (it's never in the server render, so it can't
 * mismatch hydration), as is the page's origin for the Google and Outlook
 * links. If the event's date can't be read, there's nothing to add, and a
 * short message says so instead.
 */
export default function AddToCalendar({
  event,
  className = "",
  menuFromParent = false,
}: {
  event: CalendarEvent;
  className?: string;
  /**
   * Set where the button sits inline, after other text: the menu then opens
   * from the nearest positioned ancestor (the caller makes one, e.g. the
   * column), so it starts at that edge and stays on screen, rather than from
   * the button.
   */
  menuFromParent?: boolean;
}) {
  const [links, setLinks] = useState<Links | null>(null);
  const [android, setAndroid] = useState(false);
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

  function toggle() {
    if (open) {
      setLinks(null);
      return;
    }
    const url = publicEventUrl(event.slug, window.location.origin);
    const google = googleCalendarUrl(event, url);
    const outlook = outlookCalendarUrl(event, url);
    if (google === null || outlook === null) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    setAndroid(/Android/i.test(navigator.userAgent));
    setLinks({ google, outlook });
  }

  function close() {
    setLinks(null);
    buttonRef.current?.focus();
  }

  const ics = eventCalendarPath(event.slug);
  const apple = (
    <li key="apple">
      <a href={ics} className={itemClass}>
        Apple Calendar
      </a>
    </li>
  );
  const google = links && (
    <li key="google">
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
  );

  return (
    <div
      ref={rootRef}
      className={`${menuFromParent ? "" : "relative "}w-fit ${className}`.trim()}
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
          {android ? [google, apple] : [apple, google]}
          <li>
            <a
              href={links.outlook}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Outlook (opens in a new tab)"
              className={itemClass}
            >
              Outlook
            </a>
          </li>
          <li>
            <a href={ics} download={icsFilename(event)} className={itemClass}>
              Download .ics (other apps)
            </a>
          </li>
        </ul>
      )}
    </div>
  );
}
