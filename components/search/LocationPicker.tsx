"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  NEAR_MAX_LENGTH,
  clearStoredNear,
  readStoredNear,
  readStoredNearState,
  subscribeStoredNear,
  writeStoredNear,
} from "@/lib/near-storage";
// The suburb table loads only when someone opens the menu or asks for their location.
import { loadLocation, type LocationModule } from "@/lib/location-loader";
import { GEOLOCATION_OPTIONS, hasGeolocation } from "@/lib/geolocation";
import { currentInAppLocationHelp } from "@/lib/in-app-browser";
import { placeName } from "@/lib/place";
import type { StateCode } from "@/lib/time-zones";

const noSubscribe = () => () => {};
const serverEmpty = () => "";
const serverNull = () => null;
const serverFalse = () => false;

type PanelStatus = { tone: "info" | "danger"; text: string; link?: { label: string; href: string } } | null;

/** The rules' location menu: the popular places under "Suggested", with their states. */
const SUGGESTED: { name: string; state: StateCode }[] = [
  { name: "Melbourne", state: "VIC" },
  { name: "Sydney", state: "NSW" },
  { name: "Brisbane", state: "QLD" },
  { name: "Perth", state: "WA" },
];

/** The menu's widest, from 640px; below that it's the bar's width. */
const PANEL_WIDTH = 360;

/** Same suburb, as typed: case and outer spaces aside. */
const sameNear = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const iconBox = "flex size-8 shrink-0 items-center justify-center rounded-control bg-surface";
/** A menu row (the rules' Overlays board): 48px, a muted fill on hover, never orange. */
const rowClass =
  "flex min-h-12 w-full items-center gap-3 rounded-control px-2 text-left text-sm leading-5 font-semibold hover:bg-surface";

function Icon({ children, className = "size-4" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

const PIN = (
  <>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </>
);

/**
 * The search bar's Where segment (components/SearchBar.tsx): a mono "WHERE" over the chosen
 * place, white, cream on hover, cream with the black stroke while open (the rules' Search board;
 * no orange focus ring). It opens the location menu, under the bar: "Use my location" and "All of
 * Australia", a typed suburb, then Recent (the remembered suburb) and Suggested (Melbourne,
 * Sydney, Brisbane, Perth). Radius 8, the 1.5px stroke, 48px rows, no shadow.
 *
 * One location, set once and used everywhere: choosing a place (or Use my location) remembers it
 * in this browser at once (lib/near-storage.ts), so the next page, the home and Nearby all start
 * from it; All of Australia forgets it. A typed suburb is remembered when the search is sent.
 * Nothing submits by itself (WCAG 3.2.2): the visitor presses Search.
 *
 * Privacy (docs/architecture.md, "Location"): the browser's position is asked for only when "Use
 * my location" is pressed, never on load; it's turned into the suburb it's in (anywhere in
 * Australia, from the ABS table in lib/localities.ts) here and dropped. Only the suburb's name
 * (and its state) is kept (localStorage, `{suburb, state}`) and the name submitted
 * (`/search?near=`); coordinates never reach storage, the URL or the API.
 *
 * `near`: when the address has one (/search?near=…), the bar mirrors it; otherwise (undefined:
 * other pages, and /search without `near`) it starts from the remembered suburb, after the page
 * has mounted. An empty `near` is left out of the address, and searching with no location forgets
 * the remembered suburb, so the next /search doesn't bring it back.
 *
 * `appliedNear` (/search only): the suburb the results are ordered by ("" for none). While the
 * bar's location differs from it, a hint under the bar says to press Search.
 *
 * After "All of Australia" the segment says so rather than the "Your suburb" prompt, for this page
 * view only (storage holds a suburb or nothing), so after the next page load the prompt is back.
 */
export default function LocationPicker({ near, appliedNear }: { near?: string; appliedNear?: string }) {
  const popoverId = useId();
  const titleId = useId();
  const inputId = useId();
  const listId = useId();
  const statusId = useId();
  const recentId = useId();
  const suggestedId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const moduleRef = useRef<LocationModule | null>(null);
  // The same module, for rendering the suggestions once it has loaded.
  const [table, setTable] = useState<LocationModule | null>(null);
  const locatingRef = useRef(false);

  const stored = useSyncExternalStore(subscribeStoredNear, readStoredNear, serverEmpty);
  const storedState = useSyncExternalStore(subscribeStoredNear, readStoredNearState, serverNull);
  const canLocate = useSyncExternalStore(noSubscribe, hasGeolocation, serverFalse);
  // What the visitor has typed or chosen here; until then, the address's or the remembered suburb.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? near ?? stored;
  const [anywhere, setAnywhere] = useState(false);
  const [open, setOpen] = useState(false);
  const [panelStatus, setPanelStatus] = useState<PanelStatus>(null);
  // Announced outside the menu, which has closed by the time it changes.
  const [announcement, setAnnouncement] = useState("");
  const [locating, setLocating] = useState(false);

  const label = value.trim();
  const shown = label || (anywhere ? "All of Australia" : "Your suburb");
  const outOfDate = appliedNear !== undefined && !sameNear(label, appliedNear);
  // Suburbs starting with what's typed (two letters or more), as "Suburb, STATE" (owner decision D4:
  // "Richmond, VIC" beside "Richmond, NSW"; each finds its own again); none until the table has loaded.
  const suggestions = table ? table.suggestLocalities(label).map((place) => placeName(place.name, place.state)) : [];
  /** The table's own name for a place ("Brisbane" is Brisbane City), once the table has loaded. */
  const tableName = (name: string) => table?.findLocality(name)?.name ?? name;
  const isCurrent = (name: string) => label !== "" && (sameNear(label, name) || sameNear(label, tableName(name)));
  const recent = stored.trim();
  const suggested = SUGGESTED.filter(
    (place) => !recent || !(sameNear(recent, place.name) || sameNear(recent, tableName(place.name))),
  );

  // Place the menu under the bar: the bar's full width on phones; from 640px, 360px under
  // this segment, kept within the bar's edges.
  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    function place() {
      const button = buttonRef.current;
      const bar = button?.closest("[data-search-bar]");
      if (!popover || !button || !bar) return;
      const barBox = bar.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth;
      const width = viewport < 640 ? barBox.width : Math.min(PANEL_WIDTH, viewport - 16);
      const left =
        viewport < 640
          ? barBox.left
          : Math.max(barBox.left, Math.min(button.getBoundingClientRect().left, barBox.right - width));
      const top = barBox.bottom + 8;
      Object.assign(popover.style, {
        margin: "0",
        top: `${top}px`,
        left: `${left}px`,
        right: "auto",
        bottom: "auto",
        width: `${width}px`,
        maxHeight: `${Math.max(160, window.innerHeight - top - 8)}px`,
      });
    }
    // On opening: if the whole menu won't fit below the bar, scroll the page up by the
    // difference first (not past the bar, which stays below the sticky site header).
    function reveal() {
      const bar = buttonRef.current?.closest("[data-search-bar]");
      if (!popover || !bar) return;
      const barBox = bar.getBoundingClientRect();
      const siteHeader = document.querySelector("header");
      const headerBottom = siteHeader ? Math.max(0, siteHeader.getBoundingClientRect().bottom) : 0;
      const height = popover.scrollHeight + popover.offsetHeight - popover.clientHeight;
      const overflow = barBox.bottom + 8 + height + 8 - window.innerHeight;
      const by = Math.min(overflow, barBox.top - headerBottom - 8);
      if (by > 0) window.scrollBy({ top: by, behavior: "instant" });
      place();
    }
    function handleBeforeToggle(event: Event) {
      if ((event as ToggleEvent).newState === "open") place();
    }
    function handleToggle(event: Event) {
      const opened = (event as ToggleEvent).newState === "open";
      setOpen(opened);
      if (!opened) {
        window.removeEventListener("scroll", place);
        window.removeEventListener("resize", place);
        return;
      }
      // A message from an earlier opening is stale now; "Finding your location…" isn't.
      if (!locatingRef.current) setPanelStatus(null);
      reveal();
      window.addEventListener("scroll", place, { passive: true });
      window.addEventListener("resize", place);
      popover?.querySelector<HTMLElement>("button, input")?.focus();
      loadLocation()
        .then((loaded) => {
          moduleRef.current = loaded;
          setTable(loaded);
        })
        // The suggestions are a convenience: typing still works without them.
        .catch(() => setTable(null));
    }
    // Tabbing out of the menu closes it, as clicking outside does (popover="auto").
    // Only when focus lands somewhere else. A press on the menu moves focus to the nearest
    // focusable element around it, an ancestor: <main tabIndex={-1}> (app/layout.tsx, the skip
    // link's target). That's a press on the menu's text anywhere, and in Safari and every iOS
    // browser (WebKit doesn't focus a pressed button or link) a press on its buttons and link
    // too: closing then hid the button before its click landed, so "Use my location"
    // did nothing on an iPhone. A press outside the menu is light dismiss's to close.
    function handleFocusOut(event: FocusEvent) {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !popover || next.contains(popover) || popover.contains(next)) return;
      if (buttonRef.current?.contains(next)) return;
      popover?.hidePopover?.();
    }
    popover.addEventListener("beforetoggle", handleBeforeToggle);
    popover.addEventListener("toggle", handleToggle);
    popover.addEventListener("focusout", handleFocusOut);
    return () => {
      popover.removeEventListener("beforetoggle", handleBeforeToggle);
      popover.removeEventListener("toggle", handleToggle);
      popover.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, []);

  // On submit: leave an empty `near` out of the address (so /search?q=jazz stays clean) and
  // forget the remembered suburb; remember a suburb the table knows, by its own name, with its state.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    function handleFormData(event: FormDataEvent) {
      const raw = event.formData.get("near");
      const typed = typeof raw === "string" ? raw.trim() : "";
      if (!typed) {
        event.formData.delete("near");
        clearStoredNear();
        return;
      }
      event.formData.set("near", typed);
      const place = moduleRef.current?.findLocality(typed);
      if (place) writeStoredNear(place.name, place.state);
    }
    form.addEventListener("formdata", handleFormData);
    return () => form.removeEventListener("formdata", handleFormData);
  }, []);

  function closeAndReturn(message: string) {
    popoverRef.current?.hidePopover?.();
    buttonRef.current?.focus();
    setAnnouncement(message);
  }

  /** A failed "Use my location": say why, and move to the suburb field (described by the message). */
  function failLocating(text: string, inAppBrowserCause = true) {
    // In an in-app browser (Instagram, Facebook…) location usually can't work: say so, and offer the
    // real browser. Not for a position that was read fine but isn't in Australia.
    const inApp = inAppBrowserCause ? currentInAppLocationHelp() : null;
    setPanelStatus(
      inApp ? { tone: "danger", text: inApp.text, link: inApp.link ?? undefined } : { tone: "danger", text },
    );
    inputRef.current?.focus();
  }

  function finishLocating() {
    locatingRef.current = false;
    setLocating(false);
  }

  /** Shows and remembers a suburb (the table's own name, and its state), and closes the menu. */
  function setPlace(suburb: string, state: StateCode | null) {
    setDraft(suburb);
    setAnywhere(false);
    writeStoredNear(suburb, state);
    setPanelStatus(null);
    closeAndReturn(`Location set: ${placeName(suburb, state)}`);
  }

  /** A Recent or Suggested place, by the table's own name and state when it knows it ("Brisbane" is Brisbane City). */
  function choose(name: string, state: StateCode | null) {
    const place = moduleRef.current?.findLocality(name);
    setPlace(place?.name ?? name, place?.state ?? state);
  }

  function locateMe() {
    const geolocation = typeof navigator === "undefined" ? undefined : navigator.geolocation;
    if (!geolocation || locatingRef.current) return;
    locatingRef.current = true;
    setLocating(true);
    setPanelStatus({ tone: "info", text: "Finding your location…" });
    setAnnouncement("");
    geolocation.getCurrentPosition(
      (position) => {
        // The position lives only in this callback: it's matched to a suburb, then dropped.
        const here = { lat: position.coords.latitude, lng: position.coords.longitude };
        loadLocation()
          .then((loaded) => {
            moduleRef.current = loaded;
            setTable(loaded);
            const result = loaded.nearestLocality(here);
            if (result.kind === "outside") {
              failLocating("We couldn’t match your location to an Australian suburb. Type your suburb instead.", false);
              return;
            }
            // Its name says the state when the suburb's name alone is another one's ("Richmond NSW").
            const { name: suburb, state } = result.locality;
            setPlace(suburb, state);
          })
          .catch(() => failLocating("Couldn’t find your location. Type your suburb instead."))
          .finally(finishLocating);
      },
      (error) => {
        finishLocating();
        failLocating(
          error.code === error.PERMISSION_DENIED
            ? "Location is off for this site. Type your suburb instead."
            : "Couldn’t find your location. Type your suburb instead.",
        );
      },
      GEOLOCATION_OPTIONS,
    );
  }

  function clearLocation() {
    setDraft("");
    setAnywhere(true);
    clearStoredNear();
    setPanelStatus(null);
    closeAndReturn("Location cleared: all of Australia");
  }

  const danger = panelStatus?.tone === "danger";

  function placeRow(name: string, sub: string, state: StateCode | null) {
    const current = isCurrent(name);
    return (
      <button type="button" onClick={() => choose(name, state)} aria-current={current || undefined} className={rowClass}>
        <span className={iconBox}>
          <Icon>{PIN}</Icon>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{name}</span>
          <span className="block text-xs leading-4 font-normal text-muted">{sub}</span>
        </span>
        {current && (
          <Icon className="size-5 text-signal">
            <path d="m5 12 5 5 9-10" />
          </Icon>
        )}
      </button>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={popoverId}
        data-location-button=""
        data-open={open || undefined}
        // Its visible words, "Where" and the place, are its name (WCAG 2.5.3).
        aria-label={`Where: ${shown}`}
        className="flex min-h-12 max-w-1/3 min-w-0 shrink-0 items-center gap-2 rounded-control border-control border-transparent px-2 text-left hover:bg-hover focus-visible:-outline-offset-2! data-open:border-foreground data-open:bg-hover sm:max-w-2/5 sm:px-3"
      >
        <Icon className="hidden size-5 sm:block">{PIN}</Icon>
        <span className="flex min-w-0 flex-col">
          <span aria-hidden="true" className="eyebrow text-muted">
            Where
          </span>
          <span
            data-location-label=""
            className={`truncate text-sm leading-5 font-semibold ${label || anywhere ? "text-foreground" : "font-normal text-muted"}`}
          >
            {shown}
          </span>
        </span>
        <Icon className={`hidden size-4 sm:block motion-safe:transition-transform motion-safe:duration-200 ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </Icon>
      </button>
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {appliedNear !== undefined && (
        // Under the bar (the form is `relative`), in the space the page leaves below it.
        <p aria-live="polite" data-near-hint="" className="absolute top-full left-4 mt-2 text-sm leading-5 text-muted">
          {outOfDate ? "Press Search to update results." : ""}
        </p>
      )}

      <div
        id={popoverId}
        ref={popoverRef}
        popover="auto"
        role="dialog"
        aria-labelledby={titleId}
        data-location-panel=""
        className="max-w-full overflow-y-auto rounded-control border-control border-foreground bg-card p-2 text-left text-foreground"
      >
        <p id={titleId} className="sr-only">
          Find events near you
        </p>
        <div className="flex flex-wrap gap-x-2">
          {canLocate && (
            <button
              type="button"
              onClick={locateMe}
              aria-disabled={locating || undefined}
              className={`${rowClass} w-auto flex-1 basis-40 whitespace-nowrap`}
            >
              <span className={iconBox}>
                <Icon>
                  <circle cx="12" cy="12" r="7" />
                  <circle cx="12" cy="12" r="2" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </Icon>
              </span>
              Use my location
            </button>
          )}
          <button type="button" onClick={clearLocation} className={`${rowClass} w-auto flex-1 basis-40 whitespace-nowrap`}>
            <span className={iconBox}>
              <Icon>
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
              </Icon>
            </span>
            All of Australia
          </button>
        </div>
        {/* Right under the button it answers. */}
        <p
          id={statusId}
          role="status"
          data-location-status=""
          className={`px-2 text-sm leading-5 ${panelStatus ? "mt-1 mb-2" : ""} ${danger ? "text-danger" : "text-muted"}`}
        >
          {panelStatus?.text ?? ""}
          {panelStatus?.link && (
            <a
              href={panelStatus.link.href}
              className="mt-1 flex min-h-12 items-center font-semibold text-foreground underline underline-offset-4"
            >
              {panelStatus.link.label}
            </a>
          )}
        </p>
        <div className="mt-2 border-t border-surface-border px-2 pt-3">
          {/* "Suburb", not "Your suburb": names the field without asking for it as personal data
              (no autofill purpose). */}
          <label htmlFor={inputId} className="eyebrow block text-muted">
            Suburb
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            name="near"
            value={value}
            onChange={(event) => {
              setDraft(event.target.value);
              setAnywhere(false);
              if (!locatingRef.current) setPanelStatus(null);
            }}
            aria-describedby={danger ? statusId : undefined}
            list={listId}
            maxLength={NEAR_MAX_LENGTH}
            autoComplete="off"
            enterKeyHint="search"
            className="mt-1 min-h-12 w-full px-3 text-base text-foreground placeholder:text-muted focus-visible:outline-offset-0!"
          />
          <datalist id={listId}>
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        {recent && (
          <div role="group" aria-labelledby={recentId} className="mt-3">
            <p id={recentId} className="eyebrow px-2 pb-1 text-muted">
              Recent
            </p>
            {placeRow(recent, [storedState, isCurrent(recent) ? "current" : ""].filter(Boolean).join(" · "), storedState)}
          </div>
        )}
        <div role="group" aria-labelledby={suggestedId} className="mt-3">
          <p id={suggestedId} className="eyebrow px-2 pb-1 text-muted">
            Suggested
          </p>
          <ul>
            {suggested.map((place) => (
              <li key={place.name}>{placeRow(place.name, `${place.state}, Australia`, place.state)}</li>
            ))}
          </ul>
        </div>
        {/* Also there when the browser can't locate. */}
        <p className="mt-2 border-t border-surface-border px-2 pt-2 text-sm leading-5">
          <Link href="/privacy#location" className="inline-flex min-h-12 items-center text-foreground underline underline-offset-4">
            How we use your location
          </Link>
        </p>
      </div>
    </>
  );
}
