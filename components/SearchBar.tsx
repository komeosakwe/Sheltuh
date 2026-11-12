"use client";

import { useEffect, useId, useRef, useState } from "react";
import LocationPicker from "@/components/search/LocationPicker";

/** Whether a popover is showing; false where the selector isn't supported (jsdom, old browsers). */
function isPopoverOpen(element: HTMLElement): boolean {
  try {
    return element.matches(":popover-open");
  } catch {
    return false;
  }
}

function SearchIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/**
 * Site search, one bar (the rules' Search board: "Search once … One bar, one location menu"), as
 * a plain GET form to /search?q=…&near=… that works without JS. In the home's hero and on
 * /search; the header has none (owner decision). When is deferred: /search reads only `q` and
 * `near`. The search landmark and its field are both named "Search events", the words it shows
 * (WCAG 2.5.3); the field is 16px, so iOS doesn't zoom.
 *
 * From `md` (the rules' desktop): one row, "Search events" | Where | an orange Search, radius 8
 * with the 1.5px black stroke on white, 8px inside, 48px targets; focus rings inside the bar are
 * drawn inset so they don't cross its stroke.
 *
 * Below `md` (the rules' Layout board, phones and tablets): one field that opens a full-screen
 * search sheet, a native popover (so it opens before hydration; Escape closes it and focus returns
 * to the field). The sheet holds the same form: the words, Where and Search, stacked and full
 * width, and Where opens the location list as a bottom sheet inside it. Tabbing out closes it. The
 * same element is the inline bar from `md` (`md:contents`), so there's one set of fields.
 *
 * The Where segment and its location menu are components/search/LocationPicker.tsx; the place it
 * sets is the one remembered suburb every page uses.
 */
export default function SearchBar({
  defaultValue = "",
  near,
  appliedNear,
  autoFocus = false,
}: {
  defaultValue?: string;
  /** /search passes its `near` when the address has one, so the bar mirrors it; otherwise the remembered suburb is used. */
  near?: string;
  /**
   * /search only: the suburb its results are ordered by ("" for none). The bar then says
   * "Press Search to update results" while its location differs from it.
   */
  appliedNear?: string;
  autoFocus?: boolean;
}) {
  // Unique per instance: the page can hold more than one bar.
  const inputId = useId();
  const sheetId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    function handleToggle(event: Event) {
      const open = (event as ToggleEvent).newState === "open";
      setSheetOpen(open);
      if (open) sheet?.querySelector<HTMLInputElement>("input[name='q']")?.focus();
    }
    // Tabbing out of the sheet closes it, so focus never lands on the page hidden behind it. Not
    // when focus goes to an ancestor (a press on the sheet's text focuses <main tabIndex={-1}>),
    // or nowhere.
    function handleFocusOut(event: FocusEvent) {
      const next = event.relatedTarget;
      if (!sheet || !isPopoverOpen(sheet) || !(next instanceof Node)) return;
      if (next.contains(sheet) || sheet.contains(next) || triggerRef.current?.contains(next)) return;
      sheet.hidePopover?.();
    }
    // Widened past `md` while open: the sheet is the inline bar there.
    const wide = typeof window.matchMedia === "function" ? window.matchMedia("(width >= 48rem)") : null;
    function handleWide() {
      if (wide?.matches && sheet && isPopoverOpen(sheet)) sheet.hidePopover?.();
    }
    sheet.addEventListener("toggle", handleToggle);
    sheet.addEventListener("focusout", handleFocusOut);
    wide?.addEventListener?.("change", handleWide);
    // Tapped open before hydration: the toggle event fired before this listener.
    if (isPopoverOpen(sheet)) setSheetOpen(true);
    return () => {
      sheet.removeEventListener("toggle", handleToggle);
      sheet.removeEventListener("focusout", handleFocusOut);
      wide?.removeEventListener?.("change", handleWide);
    };
  }, []);

  return (
    <form action="/search" method="get" role="search" aria-label="Search events" className="relative w-full">
      <label htmlFor={inputId} className="sr-only">
        Search events
      </label>
      {/* Below md: the one field that opens the sheet. */}
      <button
        ref={triggerRef}
        type="button"
        popoverTarget={sheetId}
        data-search-trigger=""
        // Its words are its name: "Search events", or the query after it.
        aria-label={defaultValue ? `Search events: ${defaultValue}` : undefined}
        className="flex min-h-12 w-full items-center gap-2 rounded-control border-control border-foreground bg-card px-4 text-left text-base text-foreground md:hidden"
      >
        <SearchIcon className="size-5 shrink-0" />
        {defaultValue ? (
          <span className="truncate">{defaultValue}</span>
        ) : (
          <span className="text-muted">Search events</span>
        )}
      </button>
      <div
        id={sheetId}
        ref={sheetRef}
        popover="auto"
        // A dialog only while it's the open sheet; from md the same element is the inline bar.
        role={sheetOpen ? "dialog" : undefined}
        aria-label={sheetOpen ? "Search events" : undefined}
        data-search-sheet=""
        className="m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto border-0 bg-background p-4 pt-[calc(1rem+env(safe-area-inset-top))] text-foreground md:contents"
      >
        <div className="mb-4 flex justify-end md:hidden">
          <button
            type="button"
            popoverTarget={sheetId}
            popoverTargetAction="hide"
            aria-label="Close"
            className="flex size-12 items-center justify-center rounded-control"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-6">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div
          data-search-bar=""
          className="flex flex-col gap-4 text-foreground md:flex-row md:items-center md:gap-2 md:rounded-control md:border-control md:border-foreground md:bg-card md:p-2"
        >
          <div className="relative flex items-center md:min-w-0 md:flex-1">
            <SearchIcon className="pointer-events-none absolute left-4 size-5 md:static md:ml-2 md:shrink-0" />
            <input
              id={inputId}
              type="search"
              name="q"
              defaultValue={defaultValue}
              autoFocus={autoFocus}
              maxLength={100}
              placeholder="Search events"
              autoComplete="off"
              enterKeyHint="search"
              className="h-12 w-full min-w-0 pr-4 pl-12 text-base text-ellipsis text-foreground placeholder:text-muted md:border-0 md:bg-transparent md:px-2 md:py-0 md:focus-visible:-outline-offset-2!"
            />
          </div>
          <span aria-hidden="true" className="hidden h-8 w-px shrink-0 bg-surface-border md:block" />
          <LocationPicker near={near} appliedNear={appliedNear} />
          <button
            type="submit"
            data-search-submit=""
            className="btn btn-signal btn-lg w-full shrink-0 gap-2 md:min-h-12 md:w-auto md:px-4 md:focus-visible:-outline-offset-2!"
          >
            <SearchIcon className="size-5" />
            Search
          </button>
        </div>
      </div>
    </form>
  );
}
