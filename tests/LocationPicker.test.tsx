// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchBar from "@/components/SearchBar";
import { findLocality } from "@/lib/location";
import { NEAR_STORAGE_KEY } from "@/lib/near-storage";

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

const getCurrentPosition = vi.fn<(success: Success, failure: Failure, options?: PositionOptions) => void>();

function installGeolocation() {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  });
}

function removeGeolocation() {
  // jsdom has none of its own; this undoes installGeolocation.
  Reflect.deleteProperty(navigator, "geolocation");
}

function position(lat: number, lng: number): GeolocationPosition {
  return { coords: { latitude: lat, longitude: lng, accuracy: 1000 }, timestamp: Date.now() } as GeolocationPosition;
}

function positionError(code: 1 | 2 | 3): GeolocationPositionError {
  return { code, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}

/**
 * jsdom has no Popover API (the closed panel is display: none, so it's queried with `hidden: true`)
 * and no `formdata` event: fire the events a browser would (as tests/Nav.test.tsx does).
 */
function openPanel() {
  const panel = document.querySelector<HTMLElement>("[data-location-panel]");
  if (!panel) throw new Error("location panel not rendered");
  act(() => {
    panel.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState: "open", oldState: "closed" }));
    panel.dispatchEvent(Object.assign(new Event("toggle"), { newState: "open", oldState: "closed" }));
  });
  return panel;
}

/** What the form would submit: a browser fires `formdata` on the form while building it. */
function submittedData(form: HTMLFormElement): FormData {
  const formData = new FormData(form);
  form.dispatchEvent(Object.assign(new Event("formdata"), { formData }));
  return formData;
}

function renderBar(near?: string) {
  return render(<SearchBar label="Search events" size="lg" tone="signal" placeholder="Search events" near={near} />);
}

beforeEach(() => {
  getCurrentPosition.mockReset();
  installGeolocation();
});
afterEach(() => {
  cleanup();
  removeGeolocation();
  localStorage.clear();
});

describe("LocationPicker — asking for the browser's position", () => {
  it("never asks on load; asks once per click, coarse, with a timeout", () => {
    renderBar();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    const panel = openPanel();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 });
    expect(within(panel).getByRole("status", { hidden: true })).toHaveTextContent("Finding your location…");
  });

  it("is a labelled dialog that says what it does, with a link to the privacy policy", () => {
    renderBar();
    const panel = openPanel();
    expect(panel).toHaveAttribute("popover", "auto");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-labelledby");
    expect(document.getElementById(panel.getAttribute("aria-labelledby") ?? "")).toHaveTextContent("Find events near you");
    expect(screen.getByRole("button", { name: "Location: Your suburb" })).toHaveAttribute("popovertarget", panel.id);
    const use = within(panel).getByRole("button", { name: "Use my current location", hidden: true });
    expect(use).toHaveAttribute("type", "button");
    expect(use).toHaveAccessibleDescription("Your browser will ask first. We only use it to find your suburb, on this device.");
    expect(within(panel).getByRole("link", { name: "How we use your location", hidden: true })).toHaveAttribute("href", "/privacy#location");
    // "Suburb", not a personal-data prompt, and not the button's "Your suburb" again; still no autofill.
    expect(within(panel).getByLabelText("Suburb")).toHaveAttribute("autocomplete", "off");
    expect(within(panel).queryByLabelText("Your suburb")).toBeNull();
    // Focus moves into the panel when it opens.
    expect(document.activeElement).toBe(use);
  });

  it("on success: shows and remembers the nearest suburb's name and state only, closes and returns focus, and doesn't submit", async () => {
    const submit = vi.fn((event: Event) => event.preventDefault());
    renderBar();
    screen.getByRole("search").addEventListener("submit", submit);
    const panel = openPanel();
    const northcote = findLocality("Northcote");
    if (!northcote) throw new Error("fixture");
    getCurrentPosition.mockImplementation((success) => success(position(northcote.lat + 0.001, northcote.lng)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));

    const button = await screen.findByRole("button", { name: "Location: Northcote" });
    expect(document.activeElement).toBe(button);
    expect(within(panel).getByLabelText("Suburb")).toHaveValue("Northcote");
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Location set: Northcote, VIC")).toBe(true);
    const stored = localStorage.getItem(NEAR_STORAGE_KEY) ?? "";
    expect(JSON.parse(stored)).toEqual({ suburb: "Northcote", state: "VIC" });
    expect(stored).not.toMatch(/lat|lng|-37|144/);
    // Nothing submits by itself (WCAG 3.2.2).
    expect(submit).not.toHaveBeenCalled();
    // No coordinates anywhere in the page either.
    expect(document.body.innerHTML).not.toContain(String(northcote.lat + 0.001));
  });

  /** The status line sits right under "Use my current location"; after a failure, focus is on the suburb field, described by it. */
  function expectFailure(panel: HTMLElement, message: string) {
    const use = within(panel).getByRole("button", { name: "Use my current location", hidden: true });
    const status = within(panel).getByRole("status", { hidden: true });
    expect(use.nextElementSibling).toBe(status);
    expect(status).toHaveTextContent(message);
    const field = within(panel).getByLabelText("Suburb");
    expect(document.activeElement).toBe(field);
    expect(field).toHaveAccessibleDescription(message);
  }

  it.each([
    [1, "Location is off for this site. Type your suburb instead."],
    [2, "Couldn’t find your location. Type your suburb instead."],
    [3, "Couldn’t find your location. Type your suburb instead."],
  ] as const)("error code %i: says so under the button, moves to the suburb field, stores nothing", (code, message) => {
    renderBar();
    const panel = openPanel();
    getCurrentPosition.mockImplementation((_success, failure) => failure(positionError(code)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));
    expectFailure(panel, message);
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Location: Your suburb" })).toBeInTheDocument();
  });

  it("outside Australia (Auckland): says so, moves to the suburb field, and stores nothing", async () => {
    renderBar();
    const panel = openPanel();
    getCurrentPosition.mockImplementation((success) => success(position(-36.8485, 174.7633)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));
    await waitFor(() =>
      expectFailure(panel, "We couldn’t match your location to an Australian suburb. Type your suburb instead."),
    );
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  it.each([
    ["Frankston, outside the old inner-Melbourne table", -38.1425, 145.1257, "Frankston", "VIC"],
    ["Geelong", -38.1446, 144.3612, "Geelong", "VIC"],
    ["central Sydney", -33.8688, 151.2093, "Sydney", "NSW"],
    ["central Perth", -31.9523, 115.8613, "Perth", "WA"],
  ])("anywhere in Australia (%s): names the suburb", async (_where, lat, lng, suburb, state) => {
    renderBar();
    const panel = openPanel();
    getCurrentPosition.mockImplementation((success) => success(position(lat, lng)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));
    await screen.findByRole("button", { name: `Location: ${suburb}` });
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb, state });
  });

  it("names a suburb with its state when the name alone is Melbourne's (Richmond NSW)", async () => {
    renderBar();
    const panel = openPanel();
    const richmond = findLocality("Richmond NSW");
    if (!richmond) throw new Error("fixture");
    getCurrentPosition.mockImplementation((success) => success(position(richmond.lat + 0.001, richmond.lng - 0.001)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));
    await screen.findByRole("button", { name: "Location: Richmond NSW" });
    expect(within(panel).getByLabelText("Suburb")).toHaveValue("Richmond NSW");
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Location set: Richmond, NSW")).toBe(true);
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "Richmond NSW", state: "NSW" });
  });

  it("clears a stale message when the panel opens again, and when the suburb is typed", () => {
    renderBar();
    const panel = openPanel();
    getCurrentPosition.mockImplementation((_success, failure) => failure(positionError(1)));
    const use = within(panel).getByRole("button", { name: "Use my current location", hidden: true });
    const status = within(panel).getByRole("status", { hidden: true });
    fireEvent.click(use);
    expect(status).not.toBeEmptyDOMElement();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "C" } });
    expect(status).toBeEmptyDOMElement();
    expect(within(panel).getByLabelText("Suburb")).not.toHaveAttribute("aria-describedby");
    fireEvent.click(use);
    expect(status).not.toBeEmptyDOMElement();
    openPanel();
    expect(status).toBeEmptyDOMElement();
  });

  it("keeps “Finding your location…” when the panel reopens mid-request", () => {
    renderBar();
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));
    openPanel();
    expect(within(panel).getByRole("status", { hidden: true })).toHaveTextContent("Finding your location…");
  });

  it("without the Geolocation API: no button, just the typed suburb, and still the privacy link", () => {
    removeGeolocation();
    renderBar();
    const panel = openPanel();
    expect(within(panel).queryByRole("button", { name: "Use my current location", hidden: true })).toBeNull();
    expect(within(panel).getByLabelText("Suburb")).toHaveAttribute("name", "near");
    expect(within(panel).getByRole("link", { name: "How we use your location", hidden: true })).toHaveAttribute("href", "/privacy#location");
  });
});

describe("LocationPicker — the typed suburb and the remembered one", () => {
  it("suggests suburbs starting with what's typed, from two letters, a few at a time; a 16px field of at most 60 characters", async () => {
    renderBar();
    const panel = openPanel();
    const input = within(panel).getByLabelText("Suburb");
    expect(input).toHaveClass("text-base");
    expect(input).toHaveAttribute("maxlength", "60");
    const list = document.getElementById(input.getAttribute("list") ?? "");
    const options = () => [...(list?.querySelectorAll("option") ?? [])].map((option) => option.value);
    fireEvent.change(input, { target: { value: "Fitz" } });
    // "Suburb, STATE", as everywhere a place is shown (owner decision D4).
    await waitFor(() => expect(options().slice(0, 2)).toEqual(["Fitzroy, VIC", "Fitzroy North, VIC"]));
    expect(options().length).toBeLessThanOrEqual(8);
    // A state narrows them, by the names that find them again.
    fireEvent.change(input, { target: { value: "Richmond n" } });
    expect(options()).toEqual(["Richmond, NSW"]);
    // Not a list of all 15,000 places before anything's typed.
    fireEvent.change(input, { target: { value: "F" } });
    expect(options()).toEqual([]);
  });

  it("shows what's typed on the segment", () => {
    renderBar();
    const panel = openPanel();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "Carlton" } });
    expect(screen.getByRole("button", { name: "Location: Carlton" })).toBeInTheDocument();
  });

  it("prefills the remembered suburb after mount (hero, header)", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    renderBar();
    expect(screen.getByRole("button", { name: "Location: Brunswick" })).toBeInTheDocument();
    expect(screen.getByLabelText("Suburb")).toHaveValue("Brunswick");
  });

  it("on /search mirrors the address, not the remembered suburb", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    renderBar("");
    expect(screen.getByRole("button", { name: "Location: Your suburb" })).toBeInTheDocument();
    cleanup();
    renderBar("Carlton");
    expect(screen.getByRole("button", { name: "Location: Carlton" })).toBeInTheDocument();
  });

  it("Anywhere in Australia clears the field and the remembered suburb, says “Anywhere”, and returns focus", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    renderBar();
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Anywhere in Australia", hidden: true }));
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
    expect(within(panel).getByLabelText("Suburb")).toHaveValue("");
    // The explicit choice shows on the button (for this page view), not the "Your suburb" prompt.
    const button = screen.getByRole("button", { name: "Location: Anywhere" });
    expect(button).toHaveTextContent("Anywhere");
    expect(document.activeElement).toBe(button);
    // Typing replaces it; emptying the field again is the prompt, not "Anywhere".
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "Carlton" } });
    expect(screen.getByRole("button", { name: "Location: Carlton" })).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Location: Your suburb" })).toBeInTheDocument();
  });

  it("“Anywhere” lasts only for this page view: a new bar shows the prompt", () => {
    renderBar();
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Anywhere in Australia", hidden: true }));
    expect(screen.getByRole("button", { name: "Location: Anywhere" })).toBeInTheDocument();
    cleanup();
    renderBar();
    expect(screen.getByRole("button", { name: "Location: Your suburb" })).toBeInTheDocument();
  });

  it("on submit: leaves an empty `near` out, and keeps a typed one", () => {
    renderBar();
    const form = screen.getByRole<HTMLFormElement>("search");
    expect([...submittedData(form).keys()]).toEqual(["q"]);
    const panel = openPanel();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "  Carlton " } });
    expect(submittedData(form).get("near")).toBe("Carlton");
  });

  it("searching with the location emptied forgets the remembered suburb, so /search won't bring it back", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    renderBar();
    const form = screen.getByRole<HTMLFormElement>("search");
    const panel = openPanel();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "  " } });
    expect([...submittedData(form).keys()]).toEqual(["q"]);
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  it("remembers a typed suburb the table knows, by its own name, when the search is submitted", async () => {
    renderBar();
    const form = screen.getByRole<HTMLFormElement>("search");
    const panel = openPanel();
    const input = within(panel).getByLabelText("Suburb");
    fireEvent.change(input, { target: { value: "st kilda" } });
    // The suburb table has loaded once the suggestions are there.
    await waitFor(() => expect(document.getElementById(input.getAttribute("list") ?? "")?.querySelector("option")).not.toBeNull());
    submittedData(form);
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "St Kilda", state: "VIC" });
    // A state picks the place, which is remembered by the name that finds it again.
    fireEvent.change(input, { target: { value: "richmond, nsw" } });
    expect(submittedData(form).get("near")).toBe("richmond, nsw");
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "Richmond NSW", state: "NSW" });
  });
});

describe("LocationPicker — closing", () => {
  function focusOut(from: HTMLElement, to: EventTarget | null) {
    fireEvent.focusOut(from, { relatedTarget: to });
  }

  it("closes when focus leaves for somewhere outside the panel and the location button", () => {
    renderBar();
    const panel = openPanel();
    const hidePopover = vi.fn();
    Object.assign(panel, { hidePopover });
    const field = within(panel).getByLabelText("Suburb");
    // Within the panel, back to the location button, or to nothing (a click on the panel's text): stays open.
    focusOut(field, within(panel).getByRole("button", { name: "Anywhere in Australia", hidden: true }));
    focusOut(field, screen.getByRole("button", { name: /^Location: / }));
    focusOut(field, null);
    expect(hidePopover).not.toHaveBeenCalled();
    // Tabbed on to Search: closes.
    focusOut(field, screen.getByRole("button", { name: "Search" }));
    expect(hidePopover).toHaveBeenCalledTimes(1);
  });
});
