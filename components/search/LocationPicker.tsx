"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import {
  NEAR_MAX_LENGTH,
  NEAR_STORAGE_KEY,
  clearStoredNear,
  readStoredNear,
  writeStoredNear,
} from "@/lib/near-storage";

type LocationModule = typeof import("@/lib/location");

// The suburb table loads only when someone opens the picker or asks for their location.
let locationModule: Promise<LocationModule> | null = null;
function loadLocation(): Promise<LocationModule> {
  locationModule ??= import("@/lib/location").catch((error: unknown) => {
    locationModule = null;
    throw error;
  });
  return locationModule;
}

function subscribeStorage(onChange: () => void) {
  function handle(event: StorageEvent) {
    if (event.key === null || event.key === NEAR_STORAGE_KEY) onChange();
  }
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}
const noSubscribe = () => () => {};
const serverEmpty = () => "";
const serverFalse = () => false;
const hasGeolocation = () => typeof navigator !== "undefined" && "geolocation" in navigator;

/** Finds the browser's position: coarse, at most 10 seconds, a reading up to 10 minutes old is fine. */
const GEOLOCATION_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 };

type PanelStatus = { tone: "info" | "danger"; text: string } | null;

const SIZES = {
  // The header: a 36px segment in a 44px bar.
  sm: { button: "h-9 px-2 text-sm sm:px-3", icon: "size-4" },
  // The hero and /search: 44px in a 52px bar. 14px is fine on a button (no iOS zoom).
  // Tighter sides below 640px, so the words keep room in a 320–400px bar.
  lg: { button: "h-11 px-2 text-sm sm:px-3", icon: "size-4" },
} as const;

/** Same suburb, as typed: case and outer spaces aside. */
const sameNear = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The search bar's location segment (components/SearchBar.tsx): a button
 * showing the chosen suburb that opens a small "Find events near you"
 * popover with "Use my current location" and a typed suburb (`near`).
 *
 * Privacy (docs/architecture.md, "Location"): the browser's position is
 * asked for only when "Use my current location" is pressed, never on load;
 * it's turned into the nearest known suburb here and dropped. Only the
 * suburb's name is kept (localStorage, `{suburb}`) and submitted
 * (`/search?near=`); coordinates never reach storage, the URL or the API.
 *
 * `near`: when the address has one (/search?near=…), the bar mirrors it;
 * otherwise (undefined: other pages, and /search without `near`) it starts
 * from the remembered suburb, after the page has mounted. An empty `near` is
 * left out of the address, and searching with no location forgets the
 * remembered suburb, so the next /search doesn't bring it back.
 * Nothing submits by itself (WCAG 3.2.2): the visitor presses Search.
 *
 * `appliedNear` (/search only): the suburb the results are ordered by ("" for
 * none). While the bar's location differs from it (a change here, or the
 * remembered suburb on a /search without `near`), a hint under the bar says
 * to press Search.
 *
 * "Anywhere": after "Anywhere in Melbourne" the button reads "Anywhere"
 * rather than the "Your suburb" prompt. It's kept for this page view only
 * (storage holds a suburb or nothing), so after the next page load the
 * prompt is back.
 */
export default function LocationPicker({
  near,
  appliedNear,
  size,
}: {
  near?: string;
  appliedNear?: string;
  size: "sm" | "lg";
}) {
  const popoverId = useId();
  const titleId = useId();
  const inputId = useId();
  const listId = useId();
  const helpId = useId();
  const statusId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const moduleRef = useRef<LocationModule | null>(null);
  const locatingRef = useRef(false);

  const stored = useSyncExternalStore(subscribeStorage, readStoredNear, serverEmpty);
  const canLocate = useSyncExternalStore(noSubscribe, hasGeolocation, serverFalse);
  // What the visitor has typed or chosen here; until then, the address's or the remembered suburb.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? near ?? stored;
  const [anywhere, setAnywhere] = useState(false);
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const [panelStatus, setPanelStatus] = useState<PanelStatus>(null);
  // Announced outside the popover, which has closed by the time it changes.
  const [announcement, setAnnouncement] = useState("");
  const [locating, setLocating] = useState(false);

  const label = value.trim();
  const shown = label || (anywhere ? "Anywhere" : "Your suburb");
  const styles = SIZES[size];
  const outOfDate = appliedNear !== undefined && !sameNear(label, appliedNear);

  // Place the panel under the bar: the bar's full width on phones; from 640px, 320px under
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
      const width = viewport < 640 ? barBox.width : Math.min(320, viewport - 16);
      const left =
        viewport < 640
          ? barBox.left
          : Math.max(barBox.left, Math.min(button.getBoundingClientRect().left, barBox.right - width));
      // In the site header, below its bottom rule rather than over it.
      const top = Math.max(barBox.bottom, bar.closest("header")?.getBoundingClientRect().bottom ?? 0) + 8;
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
    // On opening: if the whole panel won't fit below the bar, scroll the page up by the
    // difference first (not past the bar, and not for the header's bar, which doesn't scroll).
    function reveal() {
      const bar = buttonRef.current?.closest("[data-search-bar]");
      if (!popover || !bar || bar.closest("header")) return;
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
      if ((event as ToggleEvent).newState !== "open") {
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
        .then((location) => {
          moduleRef.current = location;
          setSuggestions(location.MELBOURNE_LOCALITIES.map((place) => place.name));
        })
        // The suggestions are a convenience: typing still works without them.
        .catch(() => setSuggestions([]));
    }
    // Tabbing out of the panel closes it, as clicking outside does (popover="auto").
    // Only when focus lands somewhere else: a click on the panel's own text blurs to nothing.
    function handleFocusOut(event: FocusEvent) {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || popover?.contains(next) || buttonRef.current?.contains(next)) return;
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
  // forget the remembered suburb; remember a suburb the table knows, by its own name.
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
      if (place) writeStoredNear(place.name);
    }
    form.addEventListener("formdata", handleFormData);
    return () => form.removeEventListener("formdata", handleFormData);
  }, []);

  function closeAndReturn(message: string) {
    popoverRef.current?.hidePopover?.();
    buttonRef.current?.focus();
    setAnnouncement(message);
  }

  /** A failed "Use my current location": say why, and move to the suburb field (described by the message). */
  function failLocating(text: string) {
    setPanelStatus({ tone: "danger", text });
    inputRef.current?.focus();
  }

  function finishLocating() {
    locatingRef.current = false;
    setLocating(false);
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
          .then((location) => {
            moduleRef.current = location;
            const result = location.nearestLocality(here);
            if (result.kind === "outside") {
              failLocating("You seem to be outside Melbourne. Type a Melbourne suburb instead.");
              return;
            }
            if (result.kind === "unmatched") {
              failLocating("We couldn’t match your location to a suburb yet. Type your suburb instead.");
              return;
            }
            const suburb = result.locality.name;
            setDraft(suburb);
            setAnywhere(false);
            writeStoredNear(suburb);
            setPanelStatus(null);
            closeAndReturn(`Location set: ${suburb}`);
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
    closeAndReturn("Location cleared: anywhere in Melbourne");
  }

  const danger = panelStatus?.tone === "danger";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={popoverId}
        data-location-button=""
        // Says what the button is and keeps its visible words in its name (WCAG 2.5.3).
        aria-label={`Location: ${shown}`}
        className={`flex min-w-0 max-w-2/5 shrink-0 items-center gap-1 rounded-full font-semibold focus-visible:-outline-offset-2! ${styles.button}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 ${styles.icon}`}
        >
          <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
          <circle cx="12" cy="9.5" r="2.5" />
        </svg>
        <span className={`truncate ${label || anywhere ? "text-foreground" : "font-normal text-muted"}`}>{shown}</span>
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
        className="w-80 max-w-full overflow-y-auto rounded-card border border-foreground bg-card p-4 text-left text-foreground"
      >
        <p id={titleId} className="text-base leading-6 font-semibold">
          Find events near you
        </p>
        {canLocate && (
          <>
            <button
              type="button"
              onClick={locateMe}
              aria-describedby={helpId}
              aria-disabled={locating || undefined}
              className="btn btn-outline mt-3 min-h-11 w-full"
            >
              Use my current location
            </button>
            {/* Right under the button it answers. */}
            <p
              id={statusId}
              role="status"
              data-location-status=""
              className={`text-sm leading-5 ${panelStatus ? "mt-2" : ""} ${danger ? "text-danger" : "text-muted"}`}
            >
              {panelStatus?.text ?? ""}
            </p>
            <p id={helpId} className="mt-2 text-sm leading-5 text-muted">
              Your browser will ask first. We only use it to find your suburb, on this device.
            </p>
            <p aria-hidden="true" className="eyebrow mt-3 text-center text-muted">
              or
            </p>
          </>
        )}
        {/* "Suburb", not "Your suburb": names the field without asking for it as personal data
            (no autofill purpose), and doesn't repeat the location button's prompt. */}
        <label htmlFor={inputId} className={`block text-sm leading-5 font-semibold ${canLocate ? "mt-1" : "mt-3"}`}>
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
          className="mt-1 min-h-11 w-full px-3 text-base text-foreground placeholder:text-muted focus-visible:outline-offset-0!"
        />
        <datalist id={listId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={clearLocation}
          className="mt-2 flex min-h-11 items-center text-sm leading-5 font-semibold underline underline-offset-4"
        >
          Anywhere in Melbourne
        </button>
        {/* Outside the location block: also there when the browser can't locate. */}
        <p className="mt-1 text-sm leading-5 text-muted">
          <Link href="/privacy#location" className="inline-flex min-h-6 items-center text-foreground underline underline-offset-4">
            How we use your location
          </Link>
        </p>
      </div>
    </>
  );
}
