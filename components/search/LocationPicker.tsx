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
  sm: { button: "h-9 px-3 text-sm", icon: "size-4" },
  // The hero and /search: 44px in a 52px bar. 14px is fine on a button (no iOS zoom).
  lg: { button: "h-11 px-3 text-sm", icon: "size-4" },
} as const;

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
 * `near`: on /search the bar mirrors the address (pass the page's `near`,
 * even ""); elsewhere (undefined) it starts from the remembered suburb,
 * after the page has mounted. An empty `near` is left out of the address.
 * Nothing submits by itself (WCAG 3.2.2): the visitor presses Search.
 */
export default function LocationPicker({ near, size }: { near?: string; size: "sm" | "lg" }) {
  const popoverId = useId();
  const titleId = useId();
  const inputId = useId();
  const listId = useId();
  const helpId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const moduleRef = useRef<LocationModule | null>(null);

  const stored = useSyncExternalStore(subscribeStorage, readStoredNear, serverEmpty);
  const canLocate = useSyncExternalStore(noSubscribe, hasGeolocation, serverFalse);
  // What the visitor has typed or chosen here; until then, the address's or the remembered suburb.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? near ?? stored;
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const [panelStatus, setPanelStatus] = useState<PanelStatus>(null);
  // Announced outside the popover, which has closed by the time it changes.
  const [announcement, setAnnouncement] = useState("");
  const [locating, setLocating] = useState(false);

  const label = value.trim();
  const styles = SIZES[size];

  // Place the panel under the bar: the bar's full width on phones, 320px under this segment from 640px.
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
        viewport < 640 ? barBox.left : Math.max(8, Math.min(button.getBoundingClientRect().left, viewport - width - 8));
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
    function handleBeforeToggle(event: Event) {
      if ((event as ToggleEvent).newState === "open") place();
    }
    function handleToggle(event: Event) {
      if ((event as ToggleEvent).newState !== "open") {
        window.removeEventListener("scroll", place);
        window.removeEventListener("resize", place);
        return;
      }
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
    popover.addEventListener("beforetoggle", handleBeforeToggle);
    popover.addEventListener("toggle", handleToggle);
    return () => {
      popover.removeEventListener("beforetoggle", handleBeforeToggle);
      popover.removeEventListener("toggle", handleToggle);
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, []);

  // On submit: leave an empty `near` out of the address (so /search?q=jazz stays clean),
  // and remember a suburb the table knows, by its own name.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    function handleFormData(event: FormDataEvent) {
      const raw = event.formData.get("near");
      const typed = typeof raw === "string" ? raw.trim() : "";
      if (!typed) {
        event.formData.delete("near");
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

  function locateMe() {
    const geolocation = typeof navigator === "undefined" ? undefined : navigator.geolocation;
    if (!geolocation || locating) return;
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
              setPanelStatus({ tone: "danger", text: "You seem to be outside Melbourne. Type a Melbourne suburb instead." });
              return;
            }
            if (result.kind === "unmatched") {
              setPanelStatus({
                tone: "danger",
                text: "We couldn’t match your location to a suburb yet. Type your suburb instead.",
              });
              return;
            }
            const suburb = result.locality.name;
            setDraft(suburb);
            writeStoredNear(suburb);
            setPanelStatus(null);
            closeAndReturn(`Location set: ${suburb}`);
          })
          .catch(() => {
            setPanelStatus({ tone: "danger", text: "Couldn’t find your location. Type your suburb instead." });
          })
          .finally(() => setLocating(false));
      },
      (error) => {
        setLocating(false);
        setPanelStatus({
          tone: "danger",
          text:
            error.code === error.PERMISSION_DENIED
              ? "Location is off for this site. Type your suburb instead."
              : "Couldn’t find your location. Type your suburb instead.",
        });
      },
      GEOLOCATION_OPTIONS,
    );
  }

  function clearLocation() {
    setDraft("");
    clearStoredNear();
    setPanelStatus(null);
    closeAndReturn("Location cleared: anywhere in Melbourne");
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={popoverId}
        data-location-button=""
        // Says what the button is and keeps its visible words in its name (WCAG 2.5.3).
        aria-label={`Location: ${label || "Your suburb"}`}
        className={`flex min-w-0 max-w-2/5 shrink-0 items-center gap-1.5 rounded-full font-semibold focus-visible:-outline-offset-2! ${styles.button}`}
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
        <span className={`truncate ${label ? "text-foreground" : "font-normal text-muted"}`}>{label || "Your suburb"}</span>
      </button>
      <span role="status" className="sr-only">
        {announcement}
      </span>

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
            <p id={helpId} className="mt-2 text-sm leading-5 text-muted">
              Your browser will ask first. We only use it to find your suburb, on this device.{" "}
              <Link href="/privacy#location" className="text-foreground underline underline-offset-4">
                Privacy
              </Link>
            </p>
            <p aria-hidden="true" className="eyebrow mt-3 text-center text-muted">
              or
            </p>
          </>
        )}
        <label htmlFor={inputId} className={`block text-sm leading-5 font-semibold ${canLocate ? "mt-1" : "mt-3"}`}>
          Your suburb
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          name="near"
          value={value}
          onChange={(event) => setDraft(event.target.value)}
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
        <p role="status" className={`text-sm leading-5 ${panelStatus?.tone === "danger" ? "text-danger" : "text-muted"}`}>
          {panelStatus?.text ?? ""}
        </p>
      </div>
    </>
  );
}
